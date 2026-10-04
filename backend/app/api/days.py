"""Локации и дни поездки (S8 WP-3)."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.stops import booked_amounts, get_trip_or_404, get_trip_readable, stop_to_dict
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.place import Place
from app.models.trip import TripDay, TripLocation, TripStop
from app.models.user import User
from app.schemas.days import (
    TripDayResponse,
    TripDaysReorder,
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
    trip = await get_trip_readable(trip_id, current_user.id, db)  # S13: и для превью
    # QA: отели/адреса автора — не для зрителя превью (пустой список, а не
    # 404: превью грузит дни и локации одним Promise.all)
    if trip.user_id != current_user.id:
        return []
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
            status_code=409, detail="location_in_use"
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


async def day_to_response(db: AsyncSession, day: TripDay, owner: bool = True) -> dict:
    """День со стопами внутри (S16). Публичный: им же собирает GET /trips/{id}.

    QA: owner=False — превью чужой публичной поездки. Старт/финиш дня (отель,
    дом) и факт броней — личное: UI превью их и так не рисует (S13 Q9), но
    API отдавал любому залогиненному.
    """
    stops_result = await db.execute(
        select(TripStop, Place)
        .join(Place, TripStop.place_id == Place.id)
        .where(TripStop.day_id == day.id)
        .order_by(TripStop.position)
    )
    rows = stops_result.all()
    booked = await booked_amounts(db, [s.id for s, _ in rows]) if owner else {}
    stops = [stop_to_dict(s, p, booked.get(s.id)) for s, p in rows]
    return {
        "id": day.id,
        "date": day.date,
        "position": day.position,   # S16: 1-based
        "title": day.title,         # S16: None -> фронт рисует «День N»
        "start_location": day.start_location if owner else None,
        "end_location": day.end_location if owner else None,
        "start_time": day.start_time,
        "end_time": day.end_time,
        "stops": stops,
        "stops_count": len(stops),
    }


@router.get("/{trip_id}/days", response_model=list[TripDayResponse])
async def list_days(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    trip = await get_trip_readable(trip_id, current_user.id, db)  # S13: и для превью
    result = await db.execute(
        select(TripDay)
        .where(TripDay.trip_id == trip_id)
        .order_by(TripDay.position)
        .options(
            selectinload(TripDay.start_location),
            selectinload(TripDay.end_location),
        )
    )
    owner = trip.user_id == current_user.id
    return [await day_to_response(db, d, owner) for d in result.scalars().all()]


@router.post("/{trip_id}/days/reorder", response_model=list[TripDayResponse])
async def reorder_days(
    trip_id: UUID,
    body: TripDaysReorder,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """S16 §1.5: перестановка дней.

    Переставляется СОДЕРЖИМОЕ дней, а даты остаются отсортированными по
    возрастанию: день (со своим названием и стопами) сохраняет идентичность,
    ему присваивается новая позиция и новая дата из отсортированного пула.

    Уникальности (trip_id, date) и (trip_id, position) — DEFERRABLE, поэтому
    промежуточные состояния внутри транзакции разрешены.
    """
    await get_trip_or_404(trip_id, current_user.id, db)
    days = (await db.execute(
        select(TripDay)
        .where(TripDay.trip_id == trip_id)
        .order_by(TripDay.position)
        .options(
            selectinload(TripDay.start_location),
            selectinload(TripDay.end_location),
        )
    )).scalars().all()
    by_id = {d.id: d for d in days}
    if len(body.day_ids) != len(days) or set(body.day_ids) != set(by_id):
        raise HTTPException(
            status_code=422, detail="day_ids must be a permutation of trip days"
        )

    dates = sorted(d.date for d in days)      # пул дат, порядок не меняется
    for i, day_id in enumerate(body.day_ids):
        day = by_id[day_id]
        day.position = i + 1
        day.date = dates[i]
    await db.commit()

    ordered = sorted(days, key=lambda d: d.position)
    return [await day_to_response(db, d) for d in ordered]




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
    return await day_to_response(db, day)
