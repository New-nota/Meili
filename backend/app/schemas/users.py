"""Схемы профиля пользователя (S9 WP-D)."""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ProfileStats(BaseModel):
    trips_count: int
    visited_places_count: int
    likes_given: int
    likes_received: int


class UserProfileResponse(BaseModel):
    id: UUID
    email: str
    name: str | None
    avatar_url: str | None
    home_city: str | None
    travel_style: list[str] | None
    created_at: datetime
    stats: ProfileStats
    # false = OAuth-only аккаунт, блок смены пароля не показывается
    has_password: bool


class UserProfileUpdate(BaseModel):
    name: str | None = None
    home_city: str | None = None
    travel_style: list[str] | None = None
    # avatar_url меняется только через POST /users/me/avatar


class PasswordChange(BaseModel):
    old_password: str
    new_password: str


class AvatarResponse(BaseModel):
    avatar_url: str
