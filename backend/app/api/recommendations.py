from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.recommendations import recommended_places, recommend_trips
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
    trips = await recommend_trips(db, user_id=str(current_user.id), city=city, limit=limit)
    return trips