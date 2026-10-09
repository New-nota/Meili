"""Снапшот поездки для контекста Meili (ТЗ-Meili M2.1).

Собирается заново из БД на каждом ходе (свежесть) и держится максимально
компактным: у Mistral нет prompt caching, тяжёлый префикс бьёт по стоимости
каждого шага. Факты модель берёт отсюда, не из текста истории (M5.4).
"""
from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.place import Place
from app.models.trip import Trip, TripDay, TripStop
from app.services.budget import compute_budget

EMPTY_SNAPSHOT = "Поездка ещё не создана: пользователь пока только обсуждает планы."


def _group_line(adults: int, children: int, ages: list[int] | None) -> str:
    group = f"Группа: {adults} взр."
    if children:
        group += f" + {children} дет."
        if ages:
            group += f" (возраст: {', '.join(map(str, ages))})"
    return group


def draft_lines(draft: dict) -> list[str]:
    """Черновик мастера создания (S17) словами.

    Ревью: раньше этих фактов у модели не было вовсе — мастер отдавал их одной
    текстовой строкой первого сообщения, и модель их роняла (созданные ею
    поездки выходили с city=NULL и валютой EUR вместо выбранной). Теперь они
    приходят из conversations.draft_json, то есть от системы.
    """
    lines = ["Поездки ещё нет. Пользователь пришёл из мастера создания с черновиком:"]
    if draft.get("title"):
        lines.append(f"Рабочее название: «{draft['title']}»")
    where = ", ".join(filter(None, (draft.get("city"), draft.get("country"))))
    if where:
        lines.append(f"Направление: {where}")
    if draft.get("start_date") and draft.get("end_date"):
        lines.append(f"Даты: {draft['start_date']} — {draft['end_date']}{_nights_note(draft['start_date'], draft['end_date'])}")
    lines.append(_group_line(
        draft.get("adults_count") or 1,
        draft.get("children_count") or 0,
        draft.get("children_ages"),
    ))
    if draft.get("budget_total"):
        lines.append(f"Бюджет: {draft['budget_total']} {draft.get('currency') or ''}".strip())
    elif draft.get("currency"):
        lines.append(f"Валюта: {draft['currency']}")
    lines.append(
        "Эти данные уже собраны — переспрашивать их не нужно; "
        "при create_trip перенеси их как есть."
    )
    return lines


def _nights_note(start, end) -> str:
    """« (2 дн., ночей: 1)». Живой прогон: модель на 17–18 октября посчитала
    отель «на 2 ночи» — число ночей теперь даёт система."""
    try:
        start = date.fromisoformat(str(start))
        end = date.fromisoformat(str(end))
    except ValueError:
        return ""
    nights = (end - start).days
    return f" ({nights + 1} дн., ночей: {nights})" if nights >= 0 else ""


def recent_places_lines(recent: list | None) -> list[str]:
    """Места, найденные в этом диалоге, с их настоящими id.

    Ревью: результат search_places не переживает ход, поэтому на следующем
    ходе («готов» -> propose_plan) модель оставалась без единого реального
    place_id и сочиняла их. Держим найденное на виду — тогда сослаться на
    место можно и через ход.
    """
    if not recent:
        return []
    lines = ["Места, найденные в этом диалоге (place_id брать ТОЛЬКО отсюда"
             " или из свежего search_places):"]
    lines += [f"- {p.get('name') or '?'} — {p.get('id')}" for p in recent]
    return lines


async def build_snapshot(
    db: AsyncSession,
    trip_id: UUID | None,
    draft: dict | None = None,
    recent_places: list | None = None,
) -> str:
    found = recent_places_lines(recent_places)

    if trip_id is None:
        # черновика может не быть (чат открыт «с нуля») — тогда прежний текст
        head = draft_lines(draft) if draft else [EMPTY_SNAPSHOT]
        return "\n".join(head + found)

    trip = (await db.execute(select(Trip).where(Trip.id == trip_id))).scalar_one_or_none()
    if trip is None:
        return EMPTY_SNAPSHOT

    days = (await db.execute(
        select(TripDay).where(TripDay.trip_id == trip_id).order_by(TripDay.position)
    )).scalars().all()
    rows = (await db.execute(
        select(TripStop, Place.name)
        .join(Place, TripStop.place_id == Place.id)
        .where(TripStop.trip_id == trip_id)
        .order_by(TripStop.position)
    )).all()

    # Ревью: раньше в шапке были только название и город. Модель не знала ни
    # дат, ни длительности, ни валюты — и переспрашивала то, что уже в БД.
    where = ", ".join(filter(None, (trip.city, trip.country)))
    lines = [f"Поездка «{trip.title}»" + (f", {where}" if where else "")]
    if trip.start_date and trip.end_date:
        lines.append(
            f"Даты: {trip.start_date} — {trip.end_date}{_nights_note(trip.start_date, trip.end_date)}"
        )
    if not trip.city:
        lines.append(
            "Город не задан — спроси у пользователя и предложи его записать "
            "в поездку, пока не знаешь город, места искать бессмысленно."
        )
    lines.append(_group_line(trip.adults_count, trip.children_count, trip.children_ages))

    # стопы по дням — только названия (компактность)
    by_day: dict = {}
    for stop, place_name in rows:
        by_day.setdefault(stop.day_id, []).append(place_name)
    for day in days:
        names = by_day.pop(day.id, [])
        # QA: day_index рядом с датой — модель путала «День 3» с датой и индексом
        lines.append(f"{day.title or f'День {day.position}'} ({day.date}, day_index={day.position - 1}): "
                     + ("; ".join(names) if names else "пусто"))
    unassigned = [n for names in by_day.values() for n in names]
    if unassigned:
        lines.append("Без дня: " + "; ".join(unassigned))

    # стоимость vs бюджет — тем же compute_budget, что и вкладка «Бюджет»:
    # факт подтверждённой брони важнее оценки, null-стопы не считаются нулём
    budget = await compute_budget(db, trip)
    cost = f"Валюта поездки: {trip.currency}. Стоимость активностей: {budget.activities_total} {trip.currency}"
    if budget.expenses_total:
        cost += f", прочие расходы: {budget.expenses_total} {trip.currency}"
    if budget.budget_total is not None:
        cost += f" при бюджете {budget.budget_total} {trip.currency}"
    lines.append(cost)

    return "\n".join(lines + found)
