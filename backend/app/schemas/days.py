"""Схемы мульти-дня (S8 WP-3): локации поездки и дни.

S16: у дня появились имя и 1-based position. Подпись «День N» тут НЕ живёт —
её рисует фронт из position (единственный источник истины формата).
"""
from datetime import date, time
from uuid import UUID

from app.models.enums import TransportMode

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.common import WallTime, not_null

from app.schemas.stops import StopResponse


# Ревью: координаты приходили голым float — внутрь БД уезжали и NaN
# (падал ST/asyncpg -> 500), и «lat: 999», после чего день молча не
# маршрутизировался. Границы заодно отсекают NaN: любое сравнение с ним False.
Latitude = Annotated[float, Field(ge=-90, le=90)]
Longitude = Annotated[float, Field(ge=-180, le=180)]

class TripLocationCreate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    address: str | None = None
    lat: Latitude
    lon: Longitude
    kind: Literal["lodging", "address", "station", "custom"] = "lodging"


class LodgingSet(BaseModel):
    """meili_upgrade: кнопка «Жильё» на карточке места в чате."""
    place_id: UUID
    day_ids: list[UUID] | None = Field(default=None, max_length=61)  # None — все дни
    role: Literal["start", "end", "both"] = "both"


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
    # QA: WallTime — aware-время («10:00+03:00», число секунд) падало на
    # сравнении с naive ниже TypeError'ом (500)
    start_time: WallTime | None = None
    end_time: WallTime | None = None
    # от старта до первой точки; null — «как у первой точки»
    start_transport: TransportMode | None = None

    _norm_title = field_validator("title")(_blank_title_is_none)
    # рамки дня — NOT NULL (дефолт 09:00–21:00): «сбросить» null'ом нельзя
    _nn = field_validator("start_time", "end_time")(not_null)

    @model_validator(mode="after")
    def _time_frame_ordered(self) -> "TripDayUpdate":
        # Ревью: рамки дня принимались в любом порядке. «22:00–06:00» давал
        # отрицательную длину дня, а селективная оптимизация считает бюджет
        # как max(end - start, 0) -> 0 секунд и честно отвечала
        # must_visit_over_budget на совершенно нормальном дне.
        if (
            self.start_time is not None
            and self.end_time is not None
            and self.end_time <= self.start_time
        ):
            raise ValueError("end_time must be later than start_time")
        return self


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
    start_transport: str | None = None
    stops: list[StopResponse]
    stops_count: int
