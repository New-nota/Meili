"""Pydantic-схемы диалога Meili (ТЗ-Meili M1.2)."""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import MAX_GROUP, Money

# QA: потолок реплики — длиннее это уже не вопрос, а вставка простыни,
# которая съедает окно контекста и деньги на токены
MAX_MESSAGE_CHARS = 4000


class TripDraftIn(BaseModel):
    """Черновик мастера создания (S17): что пользователь уже выбрал.

    Ревью: раньше эти факты уезжали в модель одной текстовой строкой первого
    сообщения — и терялись. Теперь их принимает система: снапшот показывает их
    модели, executor берёт из них координаты города и валюту при create_trip.
    Валидация зеркалит TripCreate — черновик рано или поздно станет поездкой.
    """
    title: Optional[str] = Field(None, max_length=200)
    city: Optional[str] = Field(None, max_length=200)
    country: Optional[str] = Field(None, max_length=200)
    city_lat: Optional[float] = Field(None, ge=-90, le=90)
    city_lon: Optional[float] = Field(None, ge=-180, le=180)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    adults_count: Optional[int] = Field(None, ge=1, le=MAX_GROUP)
    children_count: Optional[int] = Field(None, ge=0, le=MAX_GROUP)
    children_ages: Optional[list[int]] = Field(None, max_length=MAX_GROUP)
    budget_total: Optional[Money] = None
    currency: Optional[str] = Field(None, min_length=3, max_length=3)


class ConversationRead(BaseModel):
    id: UUID
    trip_id: Optional[UUID]
    title: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MessageRead(BaseModel):
    id: UUID
    role: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


class UserMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    # M2.2: таймзона клиента для current_time в контексте (опционально)
    client_tz: Optional[str] = Field(None, max_length=64)

    @field_validator("content")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        # «   » — не сообщение: модель отвечала на пустоту, а ход стоил денег
        if not v.strip():
            raise ValueError("content must not be blank")
        return v.strip()


class PlanRead(BaseModel):
    id: UUID
    conversation_id: UUID
    plan_json: dict
    status: str
    created_at: datetime
    applied_at: Optional[datetime]

    class Config:
        from_attributes = True
