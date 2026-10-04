from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
from sqlalchemy.dialects.postgresql import insert as pg_insert
from datetime import datetime

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.place import Place
from app.models.user import User
from app.schemas.places import PlaceCreate, PlaceResponse, PlaceUpdate, VisitedPlaceRequest
from app.services.places import create_place, place_to_dict
from app.services.overpass import CATEGORY_TO_OSM, search_places_overpass
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

@router.patch("/{place_id}", response_model=PlaceResponse)
async def update_place(
    place_id: UUID,
    data: PlaceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # ТЗ-E: ручное проставление цен (реальный сид 2GIS — отдельная задача).
    # Авто-оценки существующих стопов НЕ пересчитываются — для этого есть
    # POST /trips/{id}/recompute-estimates
    #
    # Ревью (broken access control): places — ОБЩИЙ каталог, а ручка правила
    # любое место любым залогиненным юзером. Через неё чужие цены улетали в
    # чужой бюджет (recompute считает по place), а описание подменялось всем.
    # Правим только свои места (created_by); сидовые POI (created_by IS NULL)
    # правит сид-скрипт, до появления админ-роли.
    result = await db.execute(select(Place).where(Place.id == place_id))
    place = result.scalar_one_or_none()
    if not place:
        raise HTTPException(status_code=404, detail="Place not found")
    if place.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="place_not_yours")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(place, field, value)
    await db.commit()
    await db.refresh(place)
    return place_to_dict(place)

@router.get("/", response_model=list[PlaceResponse])
async def search_places(
    city: str = Query(None, max_length=300),
    category: str = Query(None, max_length=50),
    # ревью (профиль): без лимита ручка отдавала весь каталог — 19,5 тыс. мест,
    # 8 МБ JSON одним ответом любому залогиненному (нагрузка + скрейпинг)
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0, le=100_000),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = select(Place)
    if city:
        query = query.where(Place.city == city)
    if category:
        query = query.where(Place.category == category)
    # стабильный порядок — иначе страницы перекрываются
    query = query.order_by(Place.name, Place.id).limit(limit).offset(offset)
    result = await db.execute(query)
    places = result.scalars().all()
    return [place_to_dict(p) for p in places]

@router.get("/search/nearby", response_model=list[dict])
async def search_nearby(
    # QA: без границ lat=1e308 уходил в Overpass и возвращался 400 → 500 у нас
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    # Ревью: кап радиуса — Overpass просит щадить, а без границы один
    # запрос тянул POI по половине области (и грел наш кэш мусором)
    radius: int = Query(1000, ge=1, le=50_000), # дефолт 1 км
    category: str = Query("landmark"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # поиск мест рядом с координатами через Overpass api кэш хранится 24ч в Redis
    # QA: неизвестная категория молча превращалась в landmark, но ключ кэша
    # брался по сырой строке — любой мусор плодил копии одного ответа в Redis
    if category not in CATEGORY_TO_OSM:
        raise HTTPException(status_code=422, detail="unknown_category")
    places = await search_places_overpass(lat, lon, radius, category)
    return places

@router.post("/{place_id}/visited", status_code=204)
async def mark_visited(
    place_id: UUID,
    data: VisitedPlaceRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Ревью: без этой проверки несуществующий place_id ронял FK-констрейнт
    # уже внутри INSERT — наружу уходило 500 вместо честного 404
    exists = await db.execute(select(Place.id).where(Place.id == place_id))
    if exists.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Place not found")

    mark = pg_insert(UserVisitedPlace).values(
        user_id=current_user.id, place_id=place_id, rating=data.rating,
        comment=data.comment, visited_at=datetime.utcnow()
    ).on_conflict_do_update(
        index_elements=['user_id', 'place_id'],# по этой паре смотрим конфликт
        set_={'rating': data.rating, 'comment': data.comment, 'visited_at': datetime.utcnow()}
    )
    await db.execute(mark)
    await db.commit()


@router.delete("/{place_id}/visited", status_code=204)
async def unmark_visited(
    place_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # S15: снять отметку «посещено» (вместе с оценкой и комментарием)
    result = await db.execute(
        sql_delete(UserVisitedPlace).where(
            UserVisitedPlace.user_id == current_user.id,
            UserVisitedPlace.place_id == place_id,
        )
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Visited mark not found")

