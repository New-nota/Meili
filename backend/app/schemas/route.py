"""Схемы маршрута дня по перегонам (S16 §1.6)."""
from uuid import UUID

from pydantic import BaseModel


class RouteLeg(BaseModel):
    from_stop_id: UUID | None   # None = старт из точки отправления дня
    to_stop_id: UUID | None     # None = финиш
    duration_seconds: int
    distance_meters: int
    costing: str                # значение TransportMode, не costing Valhalla
    geometry: str               # encoded polyline


class RouteRead(BaseModel):
    day_id: UUID
    legs: list[RouteLeg]
    total_duration_seconds: int
    total_distance_meters: int
