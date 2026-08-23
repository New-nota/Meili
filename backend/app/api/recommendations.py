from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.social import TripLike
from app.models.user import User
from app.services.recommendations import recommended_places, recommend_trips
from app.services.trips import decorate_trip_rows
from app.services.places import place_to_dict
from app.schemas.trips import TripResponse

router = APIRouter(prefix="/recommendations", tags=["recommendations"])

@router.get("/places")
async def get_place_recommendations(
    city: str | None = Query(None),
    adults: int = Query(1, ge=1),
    children: int= Query(0, ge=0),
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    places = await recommended_places(
        db, user_id=str(current_user.id), city=city, children=children, limit=limit,)
    return [place_to_dict(p) for p in places]

@router.get("/trips", response_model=list[TripResponse])
async def get_trip_recommendations(
    city: str | None = Query(None),
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    trips = list(await recommend_trips(
        db, user_id=str(current_user.id), city=city, limit=limit
    ))
    # S16 §2.4: карточке нужны число остановок, сколько людей лайкнуло и
    # моё состояние ❤ — считаем группировкой, без N+1
    ids = [t.id for t in trips] or [None]
    likes = dict((await db.execute(
        select(TripLike.trip_id, func.count())
        .where(TripLike.trip_id.in_(ids)).group_by(TripLike.trip_id)
    )).all())
    mine = {row[0] for row in (await db.execute(
        select(TripLike.trip_id).where(
            TripLike.trip_id.in_(ids), TripLike.user_id == current_user.id
        )
    )).all()}
    for trip in trips:
        trip.likes_count = likes.get(trip.id, 0)
        trip.liked_by_me = trip.id in mine
    # остальное (stops_count, is_draft, planned_total) — общий сервис
    return await decorate_trip_rows(db, trips)