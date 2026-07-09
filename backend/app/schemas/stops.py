from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import date, time

class StopCreate(BaseModel):
    place_id: UUID
    day_id: Optional[UUID] = None  # S8 WP-3: привязка к дню
    visit_date: Optional[date] = None
    visit_time: Optional[time] = None
    duration_minutes: Optional[int] = None
    transport_to_next: Optional[str]= "walking"
    notes: Optional[str] = None

class StopResponse(BaseModel):
    id: UUID
    trip_id: UUID
    place_id: UUID
    day_id: Optional[UUID] = None  # S8 WP-3
    position: int
    visit_date: Optional[date]
    visit_time: Optional[time]
    duration_minutes: Optional[int]
    transport_to_next: Optional[str]
    notes: Optional[str]
    is_booked: bool = False
    place_name: Optional[str] = None
    place_lat: Optional[float] = None
    place_lon: Optional[float] = None
    place_address: Optional[str] = None
    class Config:
        from_attributes = True
    
class StopReorder(BaseModel):
    stops_ids: list[UUID]

class StopUpdate(BaseModel):
    day_id: Optional[UUID] = None  # S8 WP-3: перенос стопа между днями
    visit_date: Optional[date] = None
    visit_time: Optional[time] = None
    duration_minutes: Optional[int] = None
    transport_to_next: Optional[str] = None
    notes: Optional[str] = None