from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID
from pydantic import BaseModel, Field
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.trip import Trip, TripStop, TripDay
from app.models.booking import Booking
from app.models.place import Place
from app.models.user import User
from app.schemas.stops import StopCreate, StopResponse, StopUpdate
from app.services import stops as stops_service
from geoalchemy2.shape import to_shape

router = APIRouter(prefix="/trips", tags=["stops"])

async def booked_amounts(db: AsyncSession, stop_ids: list) -> dict:
    """QA: факт подтверждённой брони по стопам (stop_id -> сумма).

    Бюджет считал «факт брони важнее оценки», а строка стопа, панель и PDF
    показывали оценку: забронировал за 1200, в маршруте висит «350». Одним
    запросом на список — без N+1.
    """
    if not stop_ids:
        return {}
    rows = (await db.execute(
        select(Booking.trip_stop_id, Booking.amount).where(
            Booking.trip_stop_id.in_(stop_ids),
            Booking.status == "confirmed",
            Booking.amount.is_not(None),
        )
    )).all()
    return {stop_id: amount for stop_id, amount in rows}


def stop_to_dict(stop: TripStop, place: Place = None, booked_amount=None) -> dict:
    result = {
        "id": stop.id,
        "trip_id": stop.trip_id,
        "place_id": stop.place_id,
        "day_id": stop.day_id,
        "position": stop.position,
        "visit_time": stop.visit_time,
        "duration_minutes": stop.duration_minutes,
        # S16: false -> UI рисует «≈» (подставлено из места)
        "duration_is_custom": stop.duration_is_custom,
        "transport_to_next": stop.transport_to_next,
        "notes": stop.notes,
        "is_booked": stop.is_booked,
        "booked_amount": booked_amount,
        "priority": stop.priority,
        "estimated_cost": stop.estimated_cost,
        "cost_source": stop.cost_source,
        "cost_min": stop.cost_min,
        "cost_max": stop.cost_max,
        "cost_is_estimate": stop.cost_is_estimate,
        "included_in_route": stop.included_in_route,
        "place_name": None,
        "place_lat": None,
        "place_lon": None,
        "place_address": None,
        "place_pricing_model": None,
    }
    if place:
        result["place_name"] = place.name
        result["place_address"] = place.address
        result["place_pricing_model"] = place.pricing_model
        if place.location:
            point = to_shape(place.location)
            result["place_lon"] = point.x
            result["place_lat"] = point.y

    return result

async def get_trip_or_404(trip_id: UUID, user_id: UUID, db: AsyncSession) -> Trip:
    result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.user_id == user_id)
    )
    trip = result.scalar_one_or_none()
    if not trip:
        raise HTTPException(status_code=404, detail="trip not found")
    return trip


async def get_trip_readable(trip_id: UUID, user_id: UUID, db: AsyncSession) -> Trip:
    """S13: чтение для превью — владелец ИЛИ публичная поездка.

    Только для GET-ручек (превью чужой поездки). Мутации по-прежнему через
    owner-only get_trip_or_404. Приватная чужая — 404, как и раньше.
    """
    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if not trip or (trip.user_id != user_id and not trip.is_public):
        raise HTTPException(status_code=404, detail="trip not found")
    return trip

@router.get("/{trip_id}/stops", response_model=list[StopResponse])
async def get_stops(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # все остановки отсортированные по позициям (S13: и для превью — readable)
    trip = await get_trip_readable(trip_id, current_user.id, db)
    result = await db.execute(
        select(TripStop, Place).join(Place, TripStop.place_id == Place.id).where(TripStop.trip_id == trip_id).order_by(TripStop.position)
    )
    rows = result.all()
    # QA: факт броней автора зрителю превью не показываем
    booked = (await booked_amounts(db, [stop.id for stop, _ in rows])
              if trip.user_id == current_user.id else {})
    return [stop_to_dict(stop, place, booked.get(stop.id)) for stop, place in rows]

@router.post("/{trip_id}/stops", response_model=StopResponse)
async def add_stop(
    trip_id: UUID,
    data: StopCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # add stop to visit list
    trip = await get_trip_or_404(trip_id, current_user.id, db)
    place_result = await db.execute(select(Place).where(Place.id == data.place_id))
    place = place_result.scalar_one_or_none()
    if not place:
        raise HTTPException(status_code=404, detail="Place not found")

    # S16: стоп всегда в дне; day_id обязателен (логика — в services/stops)
    day = (await db.execute(
        select(TripDay).where(TripDay.id == data.day_id, TripDay.trip_id == trip_id)
    )).scalar_one_or_none()
    if day is None:
        raise HTTPException(status_code=404, detail="Day not found")

    try:
        stop = await stops_service.add_stop(
            db, trip, place,
            day=day,
            visit_time=data.visit_time,
            duration_minutes=data.duration_minutes,
            transport_to_next=data.transport_to_next,
            notes=data.notes,
        )
    except stops_service.StopError as e:
        raise HTTPException(status_code=422, detail=str(e))
    await db.commit()
    await db.refresh(stop)
    return stop_to_dict(stop, place)

@router.put("/{trip_id}/stops/{stop_id}", response_model=StopResponse)
@router.patch("/{trip_id}/stops/{stop_id}", response_model=StopResponse)
async def update_stop(
    trip_id: UUID,
    stop_id: UUID,
    data: StopUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # частичное обновление: дата/время визита, транспорт, заметки,
    # перенос между днями (S8 WP-3)
    trip = await get_trip_or_404(trip_id, current_user.id, db)
    result = await db.execute(
        select(TripStop).where(TripStop.id == stop_id, TripStop.trip_id == trip_id)
    )
    stop = result.scalar_one_or_none()
    if not stop:
        raise HTTPException(status_code=404, detail="Stop not found")

    updates = data.model_dump(exclude_unset=True)

    # перенос стопа в другой день: позиция в хвост целевого дня,
    # исходный день смыкается (дата стопа = дата его дня, S16)
    new_day_id = updates.pop("day_id", None)
    if new_day_id is not None and new_day_id != stop.day_id:
        day_result = await db.execute(
            select(TripDay).where(TripDay.id == new_day_id, TripDay.trip_id == trip_id)
        )
        day = day_result.scalar_one_or_none()
        if day is None:
            raise HTTPException(status_code=404, detail="Day not found")

        old_day_id, old_position = stop.day_id, stop.position
        max_result = await db.execute(
            select(func.max(TripStop.position)).where(TripStop.day_id == new_day_id)
        )
        stop.day_id = new_day_id
        stop.position = (max_result.scalar() or 0) + 1
        # QA: «не влезло» — вердикт оптимизации СТАРОГО дня; в новом дне стоп
        # обычный, иначе он висел бы там зачёркнутым без всякого прогона
        stop.included_in_route = True

        remaining = await db.execute(
            select(TripStop).where(
                TripStop.day_id == old_day_id, TripStop.position > old_position
            )
        )
        for s in remaining.scalars().all():
            s.position -= 1

    # S16: время на точке задано руками -> «≈» больше не показываем.
    # Флагом управляет только сервер, из API его не выставить.
    if updates.get("duration_minutes") is not None:
        stop.duration_is_custom = True

    # ТЗ-E: источник суммы (логика в services/stops — общая с Meili-executor).
    # Пришёл estimated_cost -> manual; cost_source='auto' -> «вернуть авто».
    # Место читаем один раз: нужно и авто-пересчёту, и ответу stop_to_dict
    place = (await db.execute(
        select(Place).where(Place.id == stop.place_id)
    )).scalar_one_or_none()
    cost_source = updates.pop("cost_source", None)
    if cost_source == "auto":
        updates.pop("estimated_cost", None)  # авто-режим игнорирует ручную сумму
        stops_service.reset_cost_to_auto(stop, trip, place)
    elif "estimated_cost" in updates or cost_source == "manual":
        stops_service.set_manual_cost_source(stop)

    # возврат в маршрут: стоп встаёт в хвост ВКЛЮЧЁННЫХ (выкинутые живут
    # после них — position NOT NULL, семантику несёт флаг, см. optimizer)
    if updates.get("included_in_route") is True and not stop.included_in_route:
        included = (await db.execute(
            select(TripStop).where(
                TripStop.day_id == stop.day_id,
                TripStop.id != stop.id,
            ).order_by(TripStop.position)
        )).scalars().all()
        ordered = [s for s in included if s.included_in_route] + [stop] + [
            s for s in included if not s.included_in_route
        ]
        for position, s in enumerate(ordered, start=1):
            s.position = position

    for field, value in updates.items():
        setattr(stop, field, value)
    await db.commit()
    await db.refresh(stop)
    booked = await booked_amounts(db, [stop.id])
    return stop_to_dict(stop, place, booked.get(stop.id))

@router.delete("/{trip_id}/stops/{stop_id}", status_code=204)
async def remove_stop(
    trip_id: UUID,
    stop_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # удаляем и переназначаем позиции у оставшихся
    await get_trip_or_404(trip_id, current_user.id, db)
    result = await db.execute(
        select(TripStop).where(TripStop.id == stop_id, TripStop.trip_id == trip_id)
    )
    stop = result.scalar_one_or_none()
    if not stop:
        raise HTTPException(status_code=404, detail="Stop not found")
    await stops_service.remove_stop(db, stop)
    await db.commit()

class ReorderRequest(BaseModel):
    # QA: был list[str] — «test» долетал до SQL как uuid-параметр (500)
    stop_ids: list[UUID] = Field(min_length=1)

@router.post("/{trip_id}/stops/reorder", status_code=204)
async def reorder_stops(
    trip_id: UUID,
    body: ReorderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Порядок стопов ВНУТРИ одного дня (S16: позиции по-дневные).

    Ревью, две правки:
    1. trip_id был `str` — asyncpg давился нечисловым UUID и отдавал 500;
       теперь путь типизирован, кривой id это 422.
    2. позиции раздавались сквозной нумерацией по всему присланному списку,
       поэтому список из стопов РАЗНЫХ дней переписывал позиции обоих дней
       одним счётчиком (0,1,2… поперёк дней) и ломал порядок. Нумеруем в
       рамках дня — семантика позиции та же, что у add_stop/remove_stop.
    """
    await get_trip_or_404(trip_id, current_user.id, db)
    # один запрос вместо N: чужие/несуществующие id просто игнорируются
    sent = (await db.execute(
        select(TripStop).where(
            TripStop.id.in_(body.stop_ids), TripStop.trip_id == trip_id
        )
    )).scalars().all()
    by_id = {s.id: s for s in sent}
    # QA: перенумеровываем ВЕСЬ день, а не только присланные стопы. Раньше
    # частичный список ([C, B] из A,B,C) давал C=0, B=1 и оставлял A=1 —
    # дубль позиции и плавающий порядок; плюс нумерация была 0-based, а
    # add_stop/remove_stop живут в 1-based. Теперь: присланные — в заданном
    # порядке, неприсланные стопы дня — следом в прежнем порядке, 1..n.
    order: dict[UUID, list[TripStop]] = {}
    for stop_id in dict.fromkeys(body.stop_ids):  # дубли id — по первому вхождению
        stop = by_id.get(stop_id)
        if stop is not None:
            order.setdefault(stop.day_id, []).append(stop)
    for day_id, head in order.items():
        rest = (await db.execute(
            select(TripStop)
            .where(TripStop.day_id == day_id, TripStop.id.not_in([s.id for s in head]))
            .order_by(TripStop.position)
        )).scalars().all()
        for position, stop in enumerate([*head, *rest], start=1):
            stop.position = position
    await db.commit()
    # status_code=204: ответ без тела