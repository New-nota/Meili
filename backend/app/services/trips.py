"""Логика поездок: дни (S8 WP-3) и обогащение строк для профиля (S16)."""
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.trip import Trip, TripDay, TripStop


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
    """
    if trip.start_date is None or trip.end_date is None:
        return
    if trip.end_date < trip.start_date:
        raise DayError("invalid_date_range")

    n_days = (trip.end_date - trip.start_date).days + 1
    wanted = [trip.start_date + timedelta(days=i) for i in range(n_days)]

    result = await db.execute(
        select(TripDay).where(TripDay.trip_id == trip.id).order_by(TripDay.position)
    )
    existing = {d.date: d for d in result.scalars().all()}

    # дни вне нового диапазона: пустые удаляем, с непустыми — 409
    for d_date, day in list(existing.items()):
        if d_date not in wanted:
            stops = await db.execute(
                select(TripStop.id).where(TripStop.day_id == day.id).limit(1)
            )
            if stops.scalar_one_or_none() is not None:
                # машинный код: текст локализует фронт (S9 WP-C)
                raise DayError("day_has_stops", status_code=409)
            await db.delete(day)
            del existing[d_date]

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
