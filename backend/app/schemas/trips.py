from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime, date, time

class TripCreate(BaseModel):
    title: str
    description: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    transport_default: str = "walking"
    adults_count: int = 1
    children_count: int = 0
    children_ages: Optional[list[int]] = None
    start_address: Optional[str] = None
    start_lat: Optional[float] = None
    start_lon: Optional[float] = None
    start_time: Optional[time] = None
    # S8 WP-3: диапазон дат -> автогенерация trip_days
    start_date: Optional[date] = None
    end_date: Optional[date] = None

class TripUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    transport_default: Optional[str] = None
    adults_count: Optional[int] = None
    children_count: Optional[int] = None
    children_ages: Optional[list[int]] = None
    start_address: Optional[str] = None
    start_lat: Optional[float] = None
    start_lon: Optional[float] = None
    start_time: Optional[time] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    # S9: поле существовало в UI с С4, но отсутствовало в схеме — публикация
    # молча отбрасывалась Pydantic'ом
    is_public: Optional[bool] = None

class TripResponse(BaseModel):
    id: UUID
    title: str
    description: Optional[str]
    city: Optional[str]
    country: Optional[str]
    transport_default: Optional[str]
    adults_count: int
    children_count:int
    children_ages: Optional[list[int]]
    is_public: bool
    created_at: datetime
    start_address: Optional[str] = None
    start_lat: Optional[float] = None
    start_lon: Optional[float] = None
    start_time: Optional[time] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None

    class Config:
        from_attributes = True