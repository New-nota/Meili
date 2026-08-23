from decimal import Decimal
from pydantic import BaseModel, Field
from typing import Optional, Literal
from uuid import UUID
from datetime import time

from app.models.enums import DEFAULT_TRANSPORT, TransportMode

class StopCreate(BaseModel):
    place_id: UUID
    day_id: UUID                   # S16: стоп всегда принадлежит дню
    visit_time: Optional[time] = None
    duration_minutes: Optional[int] = None
    transport_to_next: Optional[TransportMode] = DEFAULT_TRANSPORT
    notes: Optional[str] = None

class StopResponse(BaseModel):
    id: UUID
    trip_id: UUID
    place_id: UUID
    day_id: UUID                   # S16
    position: int
    visit_time: Optional[time]
    duration_minutes: int          # S16: есть всегда (из места, иначе 60)
    duration_is_custom: bool = False  # S16: false -> UI рисует «≈»
    transport_to_next: Optional[str]
    notes: Optional[str]
    is_booked: bool = False
    priority: int = 0                 # S8 WP-4
    estimated_cost: Optional[Decimal] = None  # S9 WP-A
    # ТЗ-E: auto|manual; ТЗ-Meili добавляет viator|price_level|estimate
    cost_source: str = "auto"
    # ТЗ-Meili M4.1: диапазон-оценка, помеченная как оценка (рисуется с ≈)
    cost_min: Optional[Decimal] = None
    cost_max: Optional[Decimal] = None
    cost_is_estimate: bool = False
    included_in_route: bool = True    # S8 WP-4: false = «не влезло в день»
    place_name: Optional[str] = None
    place_lat: Optional[float] = None
    place_lon: Optional[float] = None
    place_address: Optional[str] = None
    # ТЗ-E: UI различает «Бесплатно» (free) и «цена не указана» (null)
    place_pricing_model: Optional[str] = None
    class Config:
        from_attributes = True
    
class StopUpdate(BaseModel):
    day_id: Optional[UUID] = None  # S8 WP-3: перенос стопа между днями
    visit_time: Optional[time] = None
    # S16: 5..720 мин; непустое значение -> сервер ставит duration_is_custom
    duration_minutes: Optional[int] = Field(None, ge=5, le=720)
    transport_to_next: Optional[TransportMode] = None
    notes: Optional[str] = None
    priority: Optional[int] = Field(None, ge=0, le=2)  # S8 WP-4
    estimated_cost: Optional[Decimal] = None  # S9 WP-A: ручной ввод -> cost_source=manual
    # ТЗ-E: cost_source='auto' в запросе = «вернуть авто» (сброс + пересчёт)
    cost_source: Optional[Literal["auto", "manual"]] = None