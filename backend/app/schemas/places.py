from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, field_validator, Field
from typing import Optional, Any, Literal
from uuid import UUID

# ТЗ-E: модель ценообразования места (хранится строкой, валидируется здесь)
PricingModel = Literal["per_person", "ticketed", "free"]

class PlaceCreate(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    duration_minutes: Optional[int] = None
    tags: Optional[list[str]] = None
    osm_id: Optional[str] = None
    # ТЗ-Meili M2.4: часы работы — без них is_open_now всегда null.
    # Форматы см. services/places/opening.py ({"open","close"} или по дням недели)
    opening_hours: Optional[dict] = None
    # ТЗ-E: цены для авто-оценки бюджета (обычно из сида, но можно руками)
    pricing_model: PricingModel = "free"
    avg_check: Optional[Decimal] = None
    ticket_adult: Optional[Decimal] = None
    ticket_child: Optional[Decimal] = None
    price_currency: Optional[str] = Field(None, min_length=3, max_length=3)

class PlaceUpdate(BaseModel):
    """ТЗ-E: ручное проставление цен (и часов — ТЗ-Meili) на существующее место."""
    pricing_model: Optional[PricingModel] = None
    avg_check: Optional[Decimal] = None
    ticket_adult: Optional[Decimal] = None
    ticket_child: Optional[Decimal] = None
    price_currency: Optional[str] = Field(None, min_length=3, max_length=3)
    description: Optional[str] = None
    duration_minutes: Optional[int] = None
    opening_hours: Optional[dict] = None

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
    pricing_model: PricingModel = "free"
    avg_check: Optional[Decimal] = None
    ticket_adult: Optional[Decimal] = None
    ticket_child: Optional[Decimal] = None
    price_currency: Optional[str] = None

    class Config:
        from_attributes = True

    @field_validator('lat','lon', mode='before')
    @classmethod
    def parse_geometry(cls, v: Any) -> Optional[float]:
        return v


class VisitedPlaceRequest(BaseModel):
    rating: int | None = Field(None, ge=1, le=5)
    # S15: опциональное впечатление
    comment: str | None = None


class VisitedPlaceResponse(BaseModel):
    """S15: моя отметка «посещено» — для бейджей ✓ и вечернего опроса."""
    place_id: UUID
    rating: int | None
    comment: str | None
    visited_at: datetime

    class Config:
        from_attributes = True
