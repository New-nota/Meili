from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update as sql_update
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.trip import Trip, TripStop
from app.models.user import User
from app.services.optimizer import optimize_trip_stops

router = APIRouter(tags=["optimize"])

@router.post("/trips/{trip_id}/optimize")
async def optimize_trip(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.user_id == current_user.id)
    )
    trip = result.scalar_one_or_none()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    
    result = await db.execute(
        select(TripStop).where(TripStop.trip_id == trip_id).options(selectinload(TripStop.place)).order_by(TripStop.position)
    )
    stops = result.scalars().all()
    if len(stops) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 stops to optimize")
    
    optimal_order = await optimize_trip_stops(stops, trip)

    for new_pos, stop_id in enumerate(optimal_order):
        await db.execute(sql_update(TripStop).where(TripStop.id == stop_id).values(position=new_pos))
    await db.commit()

    return {"optimized_order": optimal_order}