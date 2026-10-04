"""Авто-оценка стоимости стопа из цен места (ТЗ-E).

Место несёт цену -> стоп считает сумму по группе -> сумма втекает в бюджет
как «Запланировано» (services/budget.py уже агрегирует estimated_cost).

Правила: деньги только Decimal; нет данных -> None (не 0, цену не выдумываем);
валютный mismatch с поездкой -> None (FX вне ТЗ); manual-стопы не трогаем.
"""
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.place import Place
from app.models.trip import Trip, TripStop

TWO_PLACES = Decimal("0.01")


def estimate_stop_cost(
    place: Place, adults: int, children: int, trip_currency: str | None = None,
) -> Decimal | None:
    """Оценка стоимости визита группы. None = оценить нельзя.

    free -> 0.00; per_person -> avg_check * (взрослые + дети, полные головы);
    ticketed -> ticket_adult * взрослые + (ticket_child or 0) * дети.
    Детские льготы/порции — фаза 2.
    """
    if place.pricing_model == "free":
        return Decimal("0.00")

    # валюта места задана и не совпадает с валютой поездки — не оцениваем
    if (
        trip_currency is not None
        and place.price_currency is not None
        and place.price_currency.upper() != trip_currency.upper()
    ):
        return None

    if place.pricing_model == "per_person":
        if place.avg_check is None:
            return None
        total = Decimal(place.avg_check) * (adults + children)
    elif place.pricing_model == "ticketed":
        if place.ticket_adult is None:
            return None
        child_price = Decimal(place.ticket_child) if place.ticket_child is not None else Decimal("0")
        total = Decimal(place.ticket_adult) * adults + child_price * children
    else:
        # неизвестная модель — не выдумываем
        return None

    return total.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


async def recompute_auto_stops(db: AsyncSession, trip: Trip) -> int:
    """Пересчитать estimated_cost всех auto-стопов поездки. Без commit —
    вызывающий сам решает, когда фиксировать. Возвращает число обновлённых."""
    rows = (await db.execute(
        select(TripStop, Place)
        .join(Place, TripStop.place_id == Place.id)
        .where(TripStop.trip_id == trip.id, TripStop.cost_source == "auto")
    )).all()

    updated = 0
    for stop, place in rows:
        cost = estimate_stop_cost(
            place, trip.adults_count, trip.children_count, trip.currency
        )
        if stop.estimated_cost != cost:
            stop.estimated_cost = cost  # None пишется как NULL, не 0
            updated += 1
    return updated
