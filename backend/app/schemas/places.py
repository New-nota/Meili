from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, field_validator, Field

from app.schemas.common import Money, not_null
from typing import Optional, Any, Literal
from uuid import UUID

# ТЗ-E: модель ценообразования места (хранится строкой, валидируется здесь).
# 'unknown' (ревью) — честный дефолт «цены нет данных», ср. 'free' = вход свободный
PricingModel = Literal["per_person", "ticketed", "free", "unknown"]

# Ревью (атака на API): место с name="" принималось, у остальных строк не
# было потолков — мегабайтный адрес ехал в каждый список стопов и PDF
NAME_MAX, TEXT_MAX, DESCRIPTION_MAX = 300, 500, 5000


def _strip(v):
    return v.strip() if isinstance(v, str) else v


class PlaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=NAME_MAX)
    description: Optional[str] = Field(None, max_length=DESCRIPTION_MAX)
    category: Optional[str] = Field(None, max_length=50)
    address: Optional[str] = Field(None, max_length=TEXT_MAX)
    city: Optional[str] = Field(None, max_length=NAME_MAX)
    country: Optional[str] = Field(None, max_length=NAME_MAX)
    # Ревью: границы координат (заодно отсекают NaN — сравнение с ним всегда False)
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lon: Optional[float] = Field(None, ge=-180, le=180)
    duration_minutes: Optional[int] = Field(None, gt=0, le=24 * 60)
    tags: Optional[list[str]] = Field(None, max_length=50)
    # «node/123» | «way/…» | «relation/…» — по нему get-or-create (S8 WP-2)
    osm_id: Optional[str] = Field(None, max_length=64, pattern=r"^(node|way|relation)/\d+$")
    # ТЗ-Meili M2.4: часы работы — без них is_open_now всегда null.
    # Форматы см. services/places/opening.py ({"open","close"} или по дням недели)
    opening_hours: Optional[dict] = None
    # ТЗ-E: цены для авто-оценки бюджета (обычно из сида, но можно руками)
    pricing_model: PricingModel = "unknown"
    avg_check: Optional[Money] = None
    ticket_adult: Optional[Money] = None
    ticket_child: Optional[Money] = None
    price_currency: Optional[str] = Field(None, min_length=3, max_length=3)

    _strip_name = field_validator("name", "city", "country", "address", mode="before")(_strip)

class PlaceUpdate(BaseModel):
    """ТЗ-E: ручное проставление цен (и часов — ТЗ-Meili) на существующее место."""
    pricing_model: Optional[PricingModel] = None
    avg_check: Optional[Money] = None
    ticket_adult: Optional[Money] = None
    ticket_child: Optional[Money] = None
    price_currency: Optional[str] = Field(None, min_length=3, max_length=3)
    description: Optional[str] = None
    duration_minutes: Optional[int] = Field(None, gt=0, le=24 * 60)
    opening_hours: Optional[dict] = None

    # QA: pricing_model — NOT NULL (дефолт 'unknown'); null ронял flush
    _nn = field_validator("pricing_model")(not_null)

class PlaceResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str]
    category: Optional[str]
    address: Optional[str]
    city: Optional[str]
    country: Optional[str]
    lat: Optional[float] = None
    lon:  Optional[float] = None
    rating: Optional[float]
    duration_minutes: Optional[int]
    tags: Optional[list[str]]
    osm_id: Optional[str]
    is_verified: bool
    opening_hours: Optional[dict] = None  # ТЗ-Meili M2.4
    # ТЗ-E: цены отдаются наружу — UI показывает примерную стоимость
    pricing_model: PricingModel = "unknown"
    avg_check: Optional[Decimal] = None
    ticket_adult: Optional[Decimal] = None
    ticket_child: Optional[Decimal] = None
    price_currency: Optional[str] = None
    # этап B (2ГИС): источник цены, число отзывов, «номер от» (только показ)
    rating_count: Optional[int] = None
    price_source: Optional[Literal["osm", "2gis", "manual"]] = None
    lodging_price_from: Optional[Decimal] = None

    class Config:
        from_attributes = True

    @field_validator('lat','lon', mode='before')
    @classmethod
    def parse_geometry(cls, v: Any) -> Optional[float]:
        return v


class VisitedPlaceRequest(BaseModel):
    rating: int | None = Field(None, ge=1, le=5)
    # S15: опциональное впечатление
    comment: str | None = Field(None, max_length=2000)


class VisitedPlaceResponse(BaseModel):
    """S15: моя отметка «посещено» — для бейджей ✓ и вечернего опроса."""
    place_id: UUID
    rating: int | None
    comment: str | None
    visited_at: datetime

    class Config:
        from_attributes = True
