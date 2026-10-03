"""Сервис стопов: общая логика api/stops.py и executor'а Meili (ТЗ-Meili M4.2).

Вынесено из роутера, чтобы executor маппил actions 1:1 на сервисы, а не
дублировал бизнес-логику. Никаких commit — транзакцией управляет вызывающий.
"""
from datetime import time

from geoalchemy2.shape import to_shape
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import DEFAULT_TRANSPORT
from app.models.place import Place
from app.models.trip import Trip, TripDay, TripStop
from app.services.budget_estimate import estimate_stop_cost
from app.services.places.geo import in_region

# S16: длительность визита, если её нет ни в запросе, ни у места
DEFAULT_DURATION_MINUTES = 60


class StopError(Exception):
    """Доменная ошибка стопа (машинный код) — вызывающий конвертирует в 4xx."""


async def add_stop(
    db: AsyncSession,
    trip: Trip,
    place: Place,
    day: TripDay,
    visit_time: time | None = None,
    duration_minutes: int | None = None,
    transport_to_next: str | None = DEFAULT_TRANSPORT.value,
    notes: str | None = None,
) -> TripStop:
    """Стоп в хвост дня; авто-оценка стоимости из цен места (ТЗ-E) — сразу.

    S16: стоп всегда принадлежит дню (дата берётся с day.date), длительность
    подставляется из места, а нет у места — 60 мин; duration_is_custom=false,
    пока юзер не задал время руками.
    """
    # QA: место вне зоны тайлов ломает весь день — маршрут не строится,
    # оптимизация отвечает «вне покрытия». Отсекаем при добавлении (общая
    # точка для ручки стопов и Meili-executor'а), а не на полпути.
    if place.location is not None:
        point = to_shape(place.location)
        if not in_region(point.y, point.x):
            raise StopError("place_out_of_coverage")

    # QA: два параллельных добавления в один день (двойной клик, Meili +
    # ручное добавление) читали один и тот же max и получали дубль позиции.
    # Блокировка строки дня сериализует «хвост дня» до конца транзакции.
    await db.execute(select(TripDay.id).where(TripDay.id == day.id).with_for_update())
    max_position = (await db.execute(
        select(func.max(TripStop.position)).where(TripStop.day_id == day.id)
    )).scalar() or 0

    is_custom = duration_minutes is not None
    if duration_minutes is None:
        duration_minutes = place.duration_minutes or DEFAULT_DURATION_MINUTES

    stop = TripStop(
        trip_id=trip.id,
        place_id=place.id,
        day_id=day.id,
        position=max_position + 1,
        visit_time=visit_time,
        duration_minutes=duration_minutes,
        duration_is_custom=is_custom,
        transport_to_next=transport_to_next,
        notes=notes,
        estimated_cost=estimate_stop_cost(
            place, trip.adults_count, trip.children_count, trip.currency
        ),
    )
    db.add(stop)
    await db.flush()
    return stop


def clear_cost_range(stop: TripStop) -> None:
    """Смена источника суммы (manual/auto) гасит диапазон-оценку Meili:
    UI приоритизирует cost_min/max, иначе показывался бы протухший «≈ min–max»."""
    stop.cost_min = None
    stop.cost_max = None
    stop.cost_is_estimate = False


def set_manual_cost_source(stop: TripStop) -> None:
    """ТЗ-E: юзер ввёл сумму руками — движок авто-оценок её больше не трогает."""
    stop.cost_source = "manual"
    clear_cost_range(stop)


def reset_cost_to_auto(stop: TripStop, trip: Trip, place: Place) -> None:
    """«Вернуть авто»: сброс ручной суммы/диапазона + пересчёт из цен места."""
    stop.cost_source = "auto"
    stop.estimated_cost = estimate_stop_cost(
        place, trip.adults_count, trip.children_count, trip.currency
    )
    clear_cost_range(stop)


async def remove_stop(db: AsyncSession, stop: TripStop) -> None:
    """Удалить стоп; хвост позиций смыкается в рамках ЕГО дня.

    S16: позиции по-дневные (add_stop кладёт в хвост дня), поэтому и смыкать
    надо внутри дня — иначе чужие дни уезжали бы на единицу.
    """
    deleted_position = stop.position
    day_id = stop.day_id
    await db.delete(stop)
    remaining = await db.execute(
        select(TripStop).where(
            TripStop.day_id == day_id, TripStop.position > deleted_position
        )
    )
    for s in remaining.scalars().all():
        s.position -= 1
    await db.flush()
