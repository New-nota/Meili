import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

class BookingCreate(BaseModel):
    provider: str

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
    