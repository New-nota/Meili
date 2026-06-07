from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
from sqlalchemy.dialects.postgresql import insert as pg_insert
from datetime import datetime

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.place import Place
from app.models.user import User
from app.schemas.places import PlaceCreate, PlaceResponse, VisitedPlaceRequest
from app.services.places import create_place, place_to_dict
from app.services.overpass import search_places_overpass
from app.models.social import UserVisitedPlace


router = APIRouter(prefix="/places", tags=["places"])
@router.post("/", response_model=PlaceResponse)
async def add_place(
    data: PlaceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # кастомное место вручную
    return await create_place(data, db, user_id=current_user.id)

@router.get("/{place_id}", response_model=PlaceResponse)
async def get_place(
    place_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user), # нужна авторизация хоть объект не нужен
):
    result = await db.execute(select(Place).where(Place.id == place_id))
    place = result.scalar_one_or_none()
    if not place:
        raise HTTPException(status_code=404, detail="Place not found")
    return place_to_dict(place)

@router.get("/", response_model=list[PlaceResponse])
async def search_places(
    city: str = Query(None),
    category: str = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # поиск по городу и категории пока из дб
    query = select(Place)
    if city:
        query = query.where(Place.city == city)
    if category:
        query = query.where(Place.category == category)
    result = await db.execute(query)
    places = result.scalars().all()
    return [place_to_dict(p) for p in places]

@router.get("/search/nearby", response_model=list[dict])
async def search_nearby(
    lat: float = Query(...),
    lon: float = Query(...),
    radius: int = Query(1000), # дефолт 1 км
    category: str = Query("landmark"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # поиск мест рядом с координатами через Overpass api кэш хранится 24ч в Redis
    places = await search_places_overpass(lat, lon, radius, category)
    return places

@router.post("/{place_id}/visited", status_code=204)
async def mark_visited(
    place_id: UUID,
    data: VisitedPlaceRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    mark = pg_insert(UserVisitedPlace).values(
        user_id=current_user.id, place_id=place_id, rating=data.rating, visited_at=datetime.utcnow()
    ).on_conflict_do_update(
        index_elements=['user_id', 'place_id'],# по этой паре смотрим конфликт 
        set_={'rating': data.rating, 'visited_at': datetime.utcnow() }
    )
    await db.execute(mark)
    await db.commit()

