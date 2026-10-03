"""Логика поездок: дни (S8 WP-3) и обогащение строк для профиля (S16)."""
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.trip import Trip, TripDay, TripStop
from app.schemas.trips import MAX_TRIP_DAYS


async def decorate_trip_rows(db: AsyncSession, trips: list[Trip]) -> list[Trip]:
    """S16 §2.2: добить строки поездок полями для профиля/Discover.

    stops_count — одной группировкой (без N+1); is_draft — поездка без дат;
    planned_total считает тот же compute_budget, что и вкладка «Бюджет»,
    чтобы правило «факт брони важнее оценки» не дублировалось.
    """
    from app.services.budget import compute_budget  # поздний импорт: цикл

    if not trips:
        return trips
    counts = dict((await db.execute(
        select(TripStop.trip_id, func.count())
        .where(TripStop.trip_id.in_([t.id for t in trips]))
        .group_by(TripStop.trip_id)
    )).all())
    for trip in trips:
        trip.stops_count = counts.get(trip.id, 0)
        trip.is_draft = trip.start_date is None or trip.end_date is None
        trip.planned_total = (await compute_budget(db, trip)).planned_total
    return trips


class DayError(Exception):
    """Доменная ошибка дней — роутер конвертирует в HTTP."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


async def sync_trip_days(db: AsyncSession, trip: Trip) -> None:
    """Привести trip_days в соответствие диапазону start_date..end_date.

    Недостающие дни создаются (start подставляется из финиша предыдущего),
    дни вне диапазона удаляются, но только пустые: день со стопами -> 409.
    Вызывающий отвечает за commit.

    QA: какой старый день на какую дату встаёт.
    - Длина та же ИЛИ новые даты вообще не пересекаются со старыми — это
      ПЕРЕНОС поездки: дни едут целиком (стопы, имя, локации) по порядку.
      Раньше «едем на неделю позже» упиралось в 409 day_has_stops на первом
      же заполненном дне — перенести спланированную поездку было нельзя.
    - Иначе — растянули/сжали края: день остаётся на своей дате (как было).
    Уникальности (trip, date) и (trip, position) DEFERRABLE INITIALLY
    DEFERRED (S16), так что даты переставляются прямо, без танцев.
    """
    if trip.start_date is None or trip.end_date is None:
        return
    if trip.end_date < trip.start_date:
        raise DayError("invalid_date_range")

    n_days = (trip.end_date - trip.start_date).days + 1
    # Ревью: кап живёт ЗДЕСЬ, а не только в TripCreate. Мимо схемы создания
    # ходят ещё двое — PATCH /trips/{id} и create_trip-action Meili-executor'а,
    # и через них «2026-01-01..2126-01-01» одним запросом нагенерил бы десятки
    # тысяч trip_days в одной транзакции. Одно место — все вызывающие покрыты.
    if n_days > MAX_TRIP_DAYS:
        raise DayError("trip_too_long")
    wanted = [trip.start_date + timedelta(days=i) for i in range(n_days)]

    result = await db.execute(
        select(TripDay).where(TripDay.trip_id == trip.id).order_by(TripDay.position)
    )
    old_days = list(result.scalars().all())
    overlap = {d.date for d in old_days} & set(wanted)
    if old_days and (len(old_days) == n_days or not overlap):
        # перенос: i-й день по порядку -> i-я новая дата
        target = {day.id: wanted[i] for i, day in enumerate(old_days) if i < n_days}
    else:
        # края: день остаётся на своей дате
        target = {day.id: day.date for day in old_days if day.date in overlap}

    # дни без новой даты: пустые удаляем, с непустыми — 409
    existing: dict = {}
    for day in old_days:
        if day.id in target:
            day.date = target[day.id]
            existing[day.date] = day
            continue
        stops = await db.execute(
            select(TripStop.id).where(TripStop.day_id == day.id).limit(1)
        )
        if stops.scalar_one_or_none() is not None:
            # машинный код: текст локализует фронт (S9 WP-C)
            raise DayError("day_has_stops", status_code=409)
        await db.delete(day)

    # S16: uq_trip_days_trip_position теперь DEFERRABLE — позиции можно
    # переставлять прямо, проверка уникальности отложена до commit
    # создаём недостающие и проставляем финальные позиции (1-based); старт
    # нового дня N (N>1) по умолчанию = финиш дня N-1
    prev_day: TripDay | None = None
    for index, d_date in enumerate(wanted):
        day = existing.get(d_date)
        if day is None:
            day = TripDay(
                trip_id=trip.id,
                date=d_date,
                position=index + 1,
                start_location_id=(
                    prev_day.end_location_id if prev_day is not None else None
                ),
            )
            db.add(day)
        else:
            day.position = index + 1
        prev_day = day
