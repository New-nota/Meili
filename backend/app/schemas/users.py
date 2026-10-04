"""Схемы профиля пользователя (S9 WP-D)."""
from datetime import datetime
from uuid import UUID

from typing import Annotated

from pydantic import BaseModel, Field, field_validator

from app.schemas.auth import _password_fits_bcrypt


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
    # QA: false = хранилище (R2) не настроено — кнопка аватара выключена
    # заранее, а не падает 501 уже после выбора файла
    avatar_upload_enabled: bool = False


class UserProfileUpdate(BaseModel):
    # QA: потолки — колонки безразмерные, а имя рисуется везде
    name: str | None = Field(None, max_length=100)
    home_city: str | None = Field(None, max_length=100)
    travel_style: list[Annotated[str, Field(max_length=40)]] | None = Field(None, max_length=20)

    @field_validator("name", "home_city")
    @classmethod
    def _blank_is_none(cls, v: str | None) -> str | None:
        v = v.strip() if v is not None else None
        return v or None
    # avatar_url меняется только через POST /users/me/avatar


class PasswordChange(BaseModel):
    old_password: str
    # Ревью: те же правила, что и при регистрации (8+ символов, кап bcrypt) —
    # раньше сюда пролезал пароль любой длины, и bcrypt молча резал его до 72 байт
    new_password: str = Field(min_length=8)

    _pw_len = field_validator("new_password")(_password_fits_bcrypt)


class AvatarResponse(BaseModel):
    avatar_url: str
