"""Схемы статей расходов (S9 WP-A)."""
from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

# 'activity' намеренно отсутствует: активности считаются из стопов
ExpenseCategory = Literal["lodging", "transport", "food", "other"]


class ExpenseCreate(BaseModel):
    day_id: UUID | None = None
    category: ExpenseCategory
    title: str
    amount: Decimal
    # если не задана — берётся валюта поездки; чужая валюта -> 400
    currency: str | None = None


class ExpenseUpdate(BaseModel):
    day_id: UUID | None = None
    category: ExpenseCategory | None = None
    title: str | None = None
    amount: Decimal | None = None


class ExpenseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    day_id: UUID | None
    category: str
    title: str
    amount: Decimal
    currency: str
    created_at: datetime
