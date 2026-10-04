"""Схемы оптимизации дня (S8 WP-3/WP-4)."""
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class OptimizeRequest(BaseModel):
    mode: Literal["full", "selective"] = "full"
    # бюджет селективного прогона; None -> end_time - start_time дня (WP-4)
    time_budget_minutes: int | None = Field(None, ge=1, le=24 * 60)


class OptimizeResponse(BaseModel):
    ordered_stop_ids: list[UUID]
    dropped_stop_ids: list[UUID] = []
