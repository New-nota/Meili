"""Логика дней поездки (S8 WP-3): генерация из диапазона дат, автоподстановка
старта дня из финиша предыдущего."""
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.trip import Trip, TripDay, TripStop


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
        select(TripDay).where(TripDay.trip_id == trip.id).order_by(TripDay.day_index)
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

    # переиндексация в два прохода: UNIQUE(trip_id, day_index) не deferrable,
    # прямой сдвиг индексов мог бы столкнуться сам с собой в момент flush
    if existing:
        for offset, day in enumerate(existing.values()):
            day.day_index = 10_000 + offset
        await db.flush()

    # создаём недостающие и проставляем финальные индексы; старт нового
    # дня N (N>0) по умолчанию = финиш дня N-1
    prev_day: TripDay | None = None
    for index, d_date in enumerate(wanted):
        day = existing.get(d_date)
        if day is None:
            day = TripDay(
                trip_id=trip.id,
                date=d_date,
                day_index=index,
                start_location_id=(
                    prev_day.end_location_id if prev_day is not None else None
                ),
            )
            db.add(day)
        else:
            day.day_index = index
        prev_day = day
