"""Схемы мульти-дня (S8 WP-3): локации поездки и дни.

S16: у дня появились имя и 1-based position. Подпись «День N» тут НЕ живёт —
её рисует фронт из position (единственный источник истины формата).
"""
from datetime import date, time
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

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


def _blank_title_is_none(v: str | None) -> str | None:
    """S16: пустое имя (в т.ч. из пробелов) = день не переименован."""
    if v is None:
        return None
    return v.strip() or None


class TripDayRename(BaseModel):
    """S16 §1.5: переименование дня. Пустая строка = сброс к «День N»."""
    title: str | None = Field(default=None, max_length=120)

    _norm_title = field_validator("title")(_blank_title_is_none)


class TripDayUpdate(BaseModel):
    # S16: имя дня правится тем же PATCH, что старт/финиш и рамки времени
    title: str | None = Field(default=None, max_length=120)
    start_location_id: UUID | None = None
    end_location_id: UUID | None = None
    start_time: time | None = None
    end_time: time | None = None

    _norm_title = field_validator("title")(_blank_title_is_none)


class TripDaysReorder(BaseModel):
    # S16 §1.5: полный набор id дней поездки в новом порядке
    day_ids: list[UUID] = Field(min_length=1)


class TripDayResponse(BaseModel):
    id: UUID
    date: date
    position: int          # S16: 1-based
    title: str | None      # S16: None -> фронт рисует «День {position}»
    start_location: TripLocationResponse | None
    end_location: TripLocationResponse | None
    start_time: time
    end_time: time
    stops: list[StopResponse]
    stops_count: int
