from pydantic import BaseModel, field_validator
from typing import Optional, Any
from uuid import UUID

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

    class Config:
        from_attributes = True
    
    @field_validator('lat','lon', mode='before')
    @classmethod
    def parse_geometry(cls, v: Any) -> Optional[float]:
        return v
    

