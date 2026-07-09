"""Локации и дни поездки (S8 WP-3)."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.stops import get_trip_or_404, stop_to_dict
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.place import Place
from app.models.trip import TripDay, TripLocation, TripStop
from app.models.user import User
from app.schemas.days import (
    TripDayResponse,
    TripDayUpdate,
    TripLocationCreate,
    TripLocationResponse,
)

router = APIRouter(prefix="/trips", tags=["days"])

COORD_EPS = 1e-6  # локации с одинаковыми координатами считаем одной


# --- Локации -----------------------------------------------------------------

@router.get("/{trip_id}/locations", response_model=list[TripLocationResponse])
async def list_locations(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_trip_or_404(trip_id, current_user.id, db)
    result = await db.execute(
        select(TripLocation)
        .where(TripLocation.trip_id == trip_id)
        .order_by(TripLocation.created_at)
    )
    return result.scalars().all()


@router.post("/{trip_id}/locations", response_model=TripLocationResponse)
async def add_location(
    trip_id: UUID,
    data: TripLocationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_trip_or_404(trip_id, current_user.id, db)
    # повторный выбор того же места (те же координаты) не плодит записи
    result = await db.execute(
        select(TripLocation).where(
            TripLocation.trip_id == trip_id,
            TripLocation.lat.between(data.lat - COORD_EPS, data.lat + COORD_EPS),
            TripLocation.lon.between(data.lon - COORD_EPS, data.lon + COORD_EPS),
        )
    )
    existing = result.scalars().first()
    if existing is not None:
        return existing

    location = TripLocation(trip_id=trip_id, **data.model_dump())
    db.add(location)
    await db.commit()
    await db.refresh(location)
    return location


@router.delete("/{trip_id}/locations/{loc_id}", status_code=204)
async def delete_location(
    trip_id: UUID,
    loc_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_trip_or_404(trip_id, current_user.id, db)
    result = await db.execute(
        select(TripLocation).where(
            TripLocation.id == loc_id, TripLocation.trip_id == trip_id
        )
    )
    location = result.scalar_one_or_none()
    if location is None:
        raise HTTPException(status_code=404, detail="Location not found")

    used = await db.execute(
        select(TripDay.id).where(
            TripDay.trip_id == trip_id,
            or_(
                TripDay.start_location_id == loc_id,
                TripDay.end_location_id == loc_id,
            ),
        ).limit(1)
    )
    if used.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409, detail="Локация используется днём поездки"
        )
    await db.delete(location)
    await db.commit()


# --- Дни ----------------------------------------------------------------------

async def _day_or_404(db: AsyncSession, trip_id: UUID, day_id: UUID) -> TripDay:
    result = await db.execute(
        select(TripDay)
        .where(TripDay.id == day_id, TripDay.trip_id == trip_id)
        .options(
            selectinload(TripDay.start_location),
            selectinload(TripDay.end_location),
        )
    )
    day = result.scalar_one_or_none()
    if day is None:
        raise HTTPException(status_code=404, detail="Day not found")
    return day


async def _day_to_response(db: AsyncSession, day: TripDay) -> dict:
    stops_result = await db.execute(
        select(TripStop, Place)
        .join(Place, TripStop.place_id == Place.id)
        .where(TripStop.day_id == day.id)
        .order_by(TripStop.position)
    )
    return {
        "id": day.id,
        "date": day.date,
        "day_index": day.day_index,
        "start_location": day.start_location,
        "end_location": day.end_location,
        "start_time": day.start_time,
        "end_time": day.end_time,
        "stops": [stop_to_dict(s, p) for s, p in stops_result.all()],
    }


@router.get("/{trip_id}/days", response_model=list[TripDayResponse])
async def list_days(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_trip_or_404(trip_id, current_user.id, db)
    result = await db.execute(
        select(TripDay)
        .where(TripDay.trip_id == trip_id)
        .order_by(TripDay.day_index)
        .options(
            selectinload(TripDay.start_location),
            selectinload(TripDay.end_location),
        )
    )
    return [await _day_to_response(db, d) for d in result.scalars().all()]


@router.patch("/{trip_id}/days/{day_id}", response_model=TripDayResponse)
async def update_day(
    trip_id: UUID,
    day_id: UUID,
    data: TripDayUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_trip_or_404(trip_id, current_user.id, db)
    day = await _day_or_404(db, trip_id, day_id)

    updates = data.model_dump(exclude_unset=True)
    # локации должны принадлежать этой же поездке
    for field in ("start_location_id", "end_location_id"):
        loc_id = updates.get(field)
        if loc_id is not None:
            check = await db.execute(
                select(TripLocation.id).where(
                    TripLocation.id == loc_id, TripLocation.trip_id == trip_id
                )
            )
            if check.scalar_one_or_none() is None:
                raise HTTPException(
                    status_code=404, detail=f"Location for {field} not found"
                )
    for field, value in updates.items():
        setattr(day, field, value)
    await db.commit()
    day = await _day_or_404(db, trip_id, day_id)  # перечитать с relations
    return await _day_to_response(db, day)
