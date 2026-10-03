"""Профиль пользователя (S9 WP-D)."""
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import _issue_tokens
from app.core.database import get_db
from app.core.redis import revoke_all_refresh
from app.core.security import get_current_user, hash_password, verify_password
from app.models.social import TripLike, UserVisitedPlace
from app.models.trip import Trip
from app.models.user import User
from app.schemas.places import VisitedPlaceResponse
from app.schemas.trips import TripResponse
from app.schemas.users import (
    AvatarResponse,
    PasswordChange,
    ProfileStats,
    UserProfileResponse,
    UserProfileUpdate,
)
from app.services.storage import StorageError, upload_image
from app.services.storage import is_configured as storage_configured
from app.services.trips import decorate_trip_rows

router = APIRouter(prefix="/users", tags=["users"])


async def _profile_stats(db: AsyncSession, user_id) -> ProfileStats:
    trips_count = (await db.execute(
        select(func.count()).select_from(Trip).where(Trip.user_id == user_id)
    )).scalar_one()
    visited_count = (await db.execute(
        select(func.count()).select_from(UserVisitedPlace)
        .where(UserVisitedPlace.user_id == user_id)
    )).scalar_one()
    likes_given = (await db.execute(
        select(func.count()).select_from(TripLike)
        .where(TripLike.user_id == user_id)
    )).scalar_one()
    # лайки, полученные МОИМИ поездками
    likes_received = (await db.execute(
        select(func.count()).select_from(TripLike)
        .join(Trip, TripLike.trip_id == Trip.id)
        .where(Trip.user_id == user_id)
    )).scalar_one()
    return ProfileStats(
        trips_count=trips_count,
        visited_places_count=visited_count,
        likes_given=likes_given,
        likes_received=likes_received,
    )


def _profile_response(user: User, stats: ProfileStats) -> UserProfileResponse:
    return UserProfileResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        avatar_url=user.avatar_url,
        home_city=user.home_city,
        travel_style=user.travel_style,
        created_at=user.created_at,
        stats=stats,
        has_password=user.password_hash is not None,
        avatar_upload_enabled=storage_configured(),
    )


@router.get("/me", response_model=UserProfileResponse)
async def get_me(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stats = await _profile_stats(db, current_user.id)
    return _profile_response(current_user, stats)


@router.patch("/me", response_model=UserProfileResponse)
async def update_me(
    data: UserProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    await db.commit()
    await db.refresh(current_user)
    stats = await _profile_stats(db, current_user.id)
    return _profile_response(current_user, stats)


@router.post("/me/avatar", response_model=AvatarResponse)
async def upload_avatar(
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ext = (file.filename or "img").rsplit(".", 1)[-1].lower()[:8]
    key = f"avatars/{current_user.id}/{uuid4().hex}.{ext}"
    try:
        url = upload_image(
            file.file, key, file.content_type or "", file.size or 0
        )
    except StorageError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)

    current_user.avatar_url = url
    await db.commit()
    return AvatarResponse(avatar_url=url)


@router.post("/me/password", status_code=204)
async def change_password(
    data: PasswordChange,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # OAuth-only аккаунту менять нечего
    if current_user.password_hash is None:
        raise HTTPException(status_code=400, detail="no_local_password")
    if not verify_password(data.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="wrong_password")
    current_user.password_hash = hash_password(data.new_password)
    await db.commit()
    # QA: смена пароля не выкидывала другие сессии — утёкший refresh жил ещё
    # 30 дней после того, как юзер сменил пароль именно из-за утечки. Гасим
    # все refresh, а этому устройству выдаём свежую куку, чтобы не разлогинить
    await revoke_all_refresh(str(current_user.id))
    await _issue_tokens(response, current_user)


@router.get("/me/trips", response_model=list[TripResponse])
async def my_trips(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Trip).where(Trip.user_id == current_user.id).order_by(Trip.created_at.desc())
    )
    # S16: то же обогащение, что и в GET /trips/ (строка маршрута в профиле)
    return await decorate_trip_rows(db, list(result.scalars().all()))


@router.get("/me/liked-trips", response_model=list[TripResponse])
async def liked_trips(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # публичные поездки, которые пользователь лайкнул
    result = await db.execute(
        select(Trip)
        .join(TripLike, TripLike.trip_id == Trip.id)
        .where(TripLike.user_id == current_user.id, Trip.is_public.is_(True))
        .order_by(Trip.created_at.desc())
    )
    # S16: строке «Понравившиеся» нужны остановки/дни, как и «Моим маршрутам»
    return await decorate_trip_rows(db, list(result.scalars().all()))


@router.get("/me/visited-places", response_model=list[VisitedPlaceResponse])
async def visited_places(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # S15: мои отметки «посещено» — бейджи ✓ в днях и дедуп вечернего опроса
    result = await db.execute(
        select(UserVisitedPlace).where(UserVisitedPlace.user_id == current_user.id)
    )
    return result.scalars().all()
