"""Снапшот поездки для контекста Meili (ТЗ-Meili M2.1).

Собирается заново из БД на каждом ходе (свежесть) и держится максимально
компактным: у Mistral нет prompt caching, тяжёлый префикс бьёт по стоимости
каждого шага. Факты модель берёт отсюда, не из текста истории (M5.4).
"""
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.place import Place
from app.models.trip import Trip, TripDay, TripStop
from app.services.budget import compute_budget

EMPTY_SNAPSHOT = "Поездка ещё не создана: пользователь пока только обсуждает планы."


async def build_snapshot(db: AsyncSession, trip_id: UUID | None) -> str:
    if trip_id is None:
        return EMPTY_SNAPSHOT

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

    lines = [f"Поездка «{trip.title}»" + (f", {trip.city}" if trip.city else "")]

    group = f"Группа: {trip.adults_count} взр."
    if trip.children_count:
        group += f" + {trip.children_count} дет."
        if trip.children_ages:
            group += f" (возраст: {', '.join(map(str, trip.children_ages))})"
    lines.append(group)

    # стопы по дням — только названия (компактность)
    by_day: dict = {}
    for stop, place_name in rows:
        by_day.setdefault(stop.day_id, []).append(place_name)
    for day in days:
        names = by_day.pop(day.id, [])
        lines.append(f"{day.title or f'День {day.position}'} ({day.date}): "
                     + ("; ".join(names) if names else "пусто"))
    unassigned = [n for names in by_day.values() for n in names]
    if unassigned:
        lines.append("Без дня: " + "; ".join(unassigned))

    # стоимость vs бюджет — тем же compute_budget, что и вкладка «Бюджет»:
    # факт подтверждённой брони важнее оценки, null-стопы не считаются нулём
    budget = await compute_budget(db, trip)
    cost = f"Стоимость активностей: {budget.activities_total} {trip.currency}"
    if budget.expenses_total:
        cost += f", прочие расходы: {budget.expenses_total} {trip.currency}"
    if budget.budget_total is not None:
        cost += f" при бюджете {budget.budget_total} {trip.currency}"
    lines.append(cost)

    return "\n".join(lines)
