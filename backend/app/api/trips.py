from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sql_delete
from uuid import UUID
from sqlalchemy.exc import IntegrityError

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.trip import Trip, TripStop
from app.models.user import User
from app.schemas.trips import TripCreate, TripUpdate, TripResponse
from app.models.social import TripLike
from app.services.trips import DayError, sync_trip_days

router = APIRouter(prefix="/trips", tags=["trips"])

@router.get("/", response_model=list[TripResponse])
async def get_my_trips(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Trip).where(Trip.user_id == current_user.id)
    )
    return result.scalars().all()

@router.post("/", response_model=TripResponse, status_code=status.HTTP_201_CREATED)
async def create_trip(
    data: TripCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    trip = Trip(user_id=current_user.id, **data.model_dump())
    db.add(trip)
    await db.flush()
    # диапазон дат задан -> генерируем trip_days (S8 WP-3)
    try:
        await sync_trip_days(db, trip)
    except DayError as e:
        await db.rollback()
        raise HTTPException(status_code=e.status_code, detail=str(e))
    await db.commit()
    await db.refresh(trip)
    return trip

@router.get("/{trip_id}", response_model=TripResponse)
async def get_trip(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.user_id == current_user.id)
    )
    trip = result.scalar_one_or_none()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return trip

@router.put("/{trip_id}", response_model=TripResponse)
@router.patch("/{trip_id}", response_model=TripResponse)
async def update_trip(
    trip_id: UUID,
    data: TripUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.user_id == current_user.id)
    )
    trip = result.scalar_one_or_none()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(trip, field, value)

    # изменение диапазона дат -> пересинхронизация дней (S8 WP-3)
    if "start_date" in updates or "end_date" in updates:
        try:
            await sync_trip_days(db, trip)
        except DayError as e:
            await db.rollback()
            raise HTTPException(status_code=e.status_code, detail=str(e))

    await db.commit()
    await db.refresh(trip)
    return trip

@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trip(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.user_id == current_user.id)
    )
    trip = result.scalar_one_or_none()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    await db.delete(trip)
    await db.commit()

@router.post("/{trip_id}/like", status_code=204)
async def like_trip(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    like = TripLike(user_id=current_user.id, trip_id=trip_id)
    db.add(like)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
       
@router.delete("/{trip_id}/like", status_code=204)
async def unlike_trip(
    trip_id:UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    unlike = sql_delete(TripLike).where(TripLike.user_id==current_user.id, TripLike.trip_id==trip_id)
    res = await db.execute(unlike)
    await db.commit()
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Like not found")
    
@router.post("/{trip_id}/clone", response_model=TripResponse)
async def clone_trip(trip_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user), ):
    source = (
        await db.execute(select(Trip).where(Trip.id == UUID(trip_id)))
    ).scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    
    if not source.is_public and source.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot clone a private trip")
    
    new_trip = Trip(
        user_id=current_user.id, title=f"{source.title} (копия)", description=source.description,
        city=source.city, country=source.country, is_public=False, adults_count=source.adults_count,
        children_count=source.children_count, children_ages=source.children_ages, transport_default=source.transport_default,
        start_address=source.start_address, start_lat=source.start_lat, start_lon=source.start_lon, start_time=source.start_time,
    )
    db.add(new_trip)
    await db.flush()

    stops = (
        await db.execute(select(TripStop).where(TripStop.trip_id == source.id).order_by(TripStop.position))
        ).scalars().all()

    for new_pos, s in enumerate(stops):
        db.add(TripStop(
            trip_id=new_trip.id, place_id=s.place_id, position=new_pos, visit_date=s.visit_date,
            visit_time=s.visit_time, duration_minutes=s.duration_minutes, transport_to_next=s.transport_to_next,
            notes=s.notes, is_booked=False, booking_ref=None,
        ))
    await db.commit()
    await db.refresh(new_trip)
    return new_trip
    