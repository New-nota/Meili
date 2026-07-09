from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from uuid import UUID
from pydantic import BaseModel
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.trip import Trip, TripStop, TripDay
from app.models.place import Place
from app.models.user import User
from app.schemas.stops import StopCreate, StopResponse, StopReorder, StopUpdate
from geoalchemy2.shape import to_shape

router = APIRouter(prefix="/trips", tags=["stops"])

def stop_to_dict(stop: TripStop, place: Place = None) -> dict:
    result = {
        "id": stop.id,
        "trip_id": stop.trip_id,
        "place_id": stop.place_id,
        "day_id": stop.day_id,
        "position": stop.position,
        "visit_date": stop.visit_date,
        "visit_time": stop.visit_time,
        "duration_minutes": stop.duration_minutes,
        "transport_to_next": stop.transport_to_next,
        "notes": stop.notes,
        "is_booked": stop.is_booked,
        "place_name": None,
        "place_lat": None,
        "place_lon": None,
        "place_address": None,
    }
    if place:
        result["place_name"] = place.name
        result["place_address"] = place.address
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

@router.get("/{trip_id}/stops", response_model=list[StopResponse])
async def get_stops(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # все остановки отсортированные по позициям
    await get_trip_or_404(trip_id, current_user.id, db)
    result = await db.execute(
        select(TripStop, Place).join(Place, TripStop.place_id == Place.id).where(TripStop.trip_id == trip_id).order_by(TripStop.position)
    )
    rows = result.all()
    return [stop_to_dict(stop, place) for stop, place in rows]

@router.post("/{trip_id}/stops", response_model=StopResponse)
async def add_stop(
    trip_id: UUID,
    data: StopCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # add stop to visit list
    await get_trip_or_404(trip_id, current_user.id, db)
    place_result = await db.execute(select(Place).where(Place.id == data.place_id))
    place = place_result.scalar_one_or_none()
    if not place:
        raise HTTPException(status_code=404, detail="Place not found")

    # S8 WP-3: привязка к дню — visit_date зеркалит дату дня,
    # позиция считается в хвост этого дня
    visit_date = data.visit_date
    if data.day_id is not None:
        day_result = await db.execute(
            select(TripDay).where(TripDay.id == data.day_id, TripDay.trip_id == trip_id)
        )
        day = day_result.scalar_one_or_none()
        if day is None:
            raise HTTPException(status_code=404, detail="Day not found")
        visit_date = day.date

    position_scope = (
        TripStop.day_id == data.day_id
        if data.day_id is not None
        else TripStop.trip_id == trip_id
    )
    max_result = await db.execute(
        select(func.max(TripStop.position)).where(position_scope)
    )
    max_position = max_result.scalar() or 0 # в случае если в поездку еще ничего не добавили
    next_position = max_position + 1
    stop = TripStop(
        trip_id=trip_id,
        place_id=data.place_id,
        day_id=data.day_id,
        position=next_position,
        visit_date=visit_date,
        visit_time=data.visit_time,
        duration_minutes=data.duration_minutes,
        transport_to_next=data.transport_to_next,
        notes=data.notes,
    )
    db.add(stop)
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
    await get_trip_or_404(trip_id, current_user.id, db)
    result = await db.execute(
        select(TripStop).where(TripStop.id == stop_id, TripStop.trip_id == trip_id)
    )
    stop = result.scalar_one_or_none()
    if not stop:
        raise HTTPException(status_code=404, detail="Stop not found")

    updates = data.model_dump(exclude_unset=True)

    # перенос стопа в другой день: позиция в хвост целевого дня,
    # исходный день смыкается, visit_date = дата нового дня
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
        stop.visit_date = day.date

        if old_day_id is not None:
            remaining = await db.execute(
                select(TripStop).where(
                    TripStop.day_id == old_day_id, TripStop.position > old_position
                )
            )
            for s in remaining.scalars().all():
                s.position -= 1

    for field, value in updates.items():
        setattr(stop, field, value)
    await db.commit()
    await db.refresh(stop)
    place_result = await db.execute(select(Place).where(Place.id == stop.place_id))
    return stop_to_dict(stop, place_result.scalar_one_or_none())

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
    deleted_position = stop.position
    await db.delete(stop)
    remaining = await db.execute(
        select(TripStop).where(TripStop.trip_id == trip_id, TripStop.position > deleted_position)
    )
    for s in remaining.scalars().all():
        s.position -= 1
    
    await db.commit()

class ReorderRequest(BaseModel):
    stop_ids: list[str]

@router.post("/{trip_id}/stops/reorder", status_code=204)
async def reorder_stops(
    trip_id: str,
    body: ReorderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.user_id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Trip not found")
    for new_pos, stop_id in enumerate(body.stop_ids):
        result = await db.execute(
            select(TripStop).where(TripStop.id == stop_id, TripStop.trip_id == trip_id)
        )
        stop = result.scalar_one_or_none()
        if stop:
            stop.position = new_pos
    await db.commit()
    # status_code=204: ответ без тела