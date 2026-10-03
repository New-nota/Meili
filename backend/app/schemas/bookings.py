import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import Money


class BookingCreate(BaseModel):
    trip_stop_id: uuid.UUID
    provider: str = Field(min_length=1, max_length=50)
    # намерение пользователя (какой день хочет посетить) — уходит в booking_details
    visit_date: date | None = None


class BookingConfirm(BaseModel):
    """Пользователь вернулся с сайта партнёра и подтверждает бронь."""
    external_id: str | None = Field(None, max_length=128)  # номер брони у провайдера
    amount: Money | None = None
    currency: str | None = Field(None, min_length=3, max_length=3)


class BookingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    trip_stop_id: uuid.UUID
    provider: str
    status: str
    booked_at: datetime
    external_id: str | None = None
    amount: Decimal | None = None
    currency: str | None = None
    deep_link: str | None = None
