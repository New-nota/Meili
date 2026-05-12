from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime

class TripCreate(BaseModel):
    title: str
    description: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    transport_default: str = "walking"
    adults_count: int = 1
    children_count: int = 0
    children_ages: Optional[list[int]] = None

class TripUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    transport_default: Optional[str] = None
    adults_count: Optional[int] = None
    children_count: Optional[int] = None
    children_ages: Optional[list[int]] = None

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

    class Config:
        from_attributes = True