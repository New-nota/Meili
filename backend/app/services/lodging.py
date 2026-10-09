"""Жильё поездки: место-отель -> TripLocation(kind=lodging) старт/финиш дней.

meili_upgrade: общая логика кнопки «Жильё» на карточке места в чате и
действия set_lodging в плане Meili — как services/stops.py для стопов, чтобы
не было двух реализаций. Без commit — транзакцией управляет вызывающий.
"""
from typing import Literal

from geoalchemy2.shape import to_shape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from decimal import Decimal

from app.models.place import Place
from app.models.trip import Trip, TripDay, TripExpense, TripLocation
from app.services.places.geo import in_coverage

COORD_EPS = 1e-6  # как в api/days.add_location: те же координаты — та же локация

LodgingRole = Literal["start", "end", "both"]


class LodgingError(Exception):
    """Доменная ошибка (машинный код) — вызывающий конвертирует в 4xx."""


async def location_for_place(db: AsyncSession, trip: Trip, place: Place) -> TripLocation:
    """Get-or-create локации поездки в точке места."""
    if place.location is None:
        raise LodgingError("place_without_location")
    point = to_shape(place.location)
    # день со стартом вне тайлов не строит маршрут вовсе — как у стопов
    if not in_coverage(point.y, point.x):
        raise LodgingError("place_out_of_coverage")
    existing = (await db.execute(
        select(TripLocation).where(
            TripLocation.trip_id == trip.id,
            TripLocation.lat.between(point.y - COORD_EPS, point.y + COORD_EPS),
            TripLocation.lon.between(point.x - COORD_EPS, point.x + COORD_EPS),
        )
    )).scalars().first()
    if existing is not None:
        return existing
    location = TripLocation(
        trip_id=trip.id, name=place.name, address=place.address,
        lat=point.y, lon=point.x, kind="lodging",
    )
    db.add(location)
    await db.flush()
    return location


async def set_lodging(
    db: AsyncSession,
    trip: Trip,
    place: Place,
    day_positions: list[int] | None = None,   # 1-based; None — все дни
    role: LodgingRole = "both",
) -> tuple[TripLocation, list[TripDay]]:
    """Поселить поездку в место: стартом и/или финишем выбранных дней."""
    location = await location_for_place(db, trip, place)
    stmt = select(TripDay).where(TripDay.trip_id == trip.id).order_by(TripDay.position)
    if day_positions is not None:
        stmt = stmt.where(TripDay.position.in_(day_positions))
    days = list((await db.execute(stmt)).scalars().all())
    if not days or (day_positions is not None and len(days) != len(set(day_positions))):
        raise LodgingError("day_not_found")
    for day in days:
        if role in ("start", "both"):
            day.start_location_id = location.id
        if role in ("end", "both"):
            day.end_location_id = location.id
    return location, days


def lodging_nights(trip: Trip, days: list[TripDay], all_days: bool) -> int:
    """Ночей проживания: на всю поездку — ночи поездки, на часть дней — по дню
    на ночь, но не больше ночей поездки (последний день — уезжаем)."""
    if not (trip.start_date and trip.end_date):
        return 0
    trip_nights = (trip.end_date - trip.start_date).days
    return trip_nights if all_days else min(len(days), trip_nights)


async def estimate_lodging_expense(
    db: AsyncSession, trip: Trip, place: Place, nights: int,
) -> TripExpense | None:
    """Статья проживания-оценка: «номер от N» (2ГИС) × ночи (без commit).

    Живой прогон: поселили в отель — а в бюджете ноль. «От N» — нижняя
    граница, поэтому статья помечена is_estimate (UI рисует «≈», правка суммы
    руками снимает пометку). Повторное заселение в то же место обновляет свою
    оценку, а не плодит статьи; ручную сумму (is_estimate=false) не трогаем.
    """
    if place.lodging_price_from is None or nights <= 0:
        return None
    if place.price_currency and place.price_currency.upper() != (trip.currency or "").upper():
        return None  # одна валюта на поездку, конвертаций нет
    amount = (Decimal(place.lodging_price_from) * nights).quantize(Decimal("0.01"))
    existing = (await db.execute(
        select(TripExpense).where(
            TripExpense.trip_id == trip.id, TripExpense.category == "lodging",
            TripExpense.title == place.name,
        )
    )).scalars().first()
    if existing is not None:
        if existing.is_estimate:
            existing.amount = amount
        return existing
    expense = TripExpense(
        trip_id=trip.id, category="lodging", title=place.name,
        amount=amount, currency=trip.currency, is_estimate=True,
    )
    db.add(expense)
    return expense
