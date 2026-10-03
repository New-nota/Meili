"""Схемы статей расходов (S9 WP-A)."""
from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import Money, not_null

# 'activity' намеренно отсутствует: активности считаются из стопов
ExpenseCategory = Literal["lodging", "transport", "food", "other"]


def _strip(v):
    # «   » проходил min_length=1 и давал статью без названия
    return v.strip() if isinstance(v, str) else v


class ExpenseCreate(BaseModel):
    day_id: UUID | None = None
    category: ExpenseCategory
    title: str = Field(min_length=1, max_length=200)
    amount: Money

    _strip_title = field_validator("title", mode="before")(_strip)
    # если не задана — берётся валюта поездки; чужая валюта -> 400
    currency: str | None = None


class ExpenseUpdate(BaseModel):
    day_id: UUID | None = None
    category: ExpenseCategory | None = None
    title: str | None = Field(None, min_length=1, max_length=200)
    amount: Money | None = None

    _strip_title = field_validator("title", mode="before")(_strip)
    # QA: null в NOT NULL-колонки ронял flush (500)
    _nn = field_validator("category", "title", "amount")(not_null)


class ExpenseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    day_id: UUID | None
    category: str
    title: str
    amount: Decimal
    currency: str
    created_at: datetime
