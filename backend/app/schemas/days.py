"""Схемы мульти-дня (S8 WP-3): локации поездки и дни."""
from datetime import date, time
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.schemas.stops import StopResponse


class TripLocationCreate(BaseModel):
    name: str | None = None
    address: str | None = None
    lat: float
    lon: float
    kind: str = "lodging"  # 'lodging' | 'address' | 'station' | 'custom'


class TripLocationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str | None
    address: str | None
    lat: float
    lon: float
    kind: str


class TripDayUpdate(BaseModel):
    start_location_id: UUID | None = None
    end_location_id: UUID | None = None
    start_time: time | None = None
    end_time: time | None = None


class TripDayResponse(BaseModel):
    id: UUID
    date: date
    day_index: int
    start_location: TripLocationResponse | None
    end_location: TripLocationResponse | None
    start_time: time
    end_time: time
    stops: list[StopResponse]
