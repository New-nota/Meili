"""ProposedPlan — граница LLM↔система (ТЗ-Meili M3.1, §0-инвариант).

Всё, что модель предлагает записать, проходит через эту схему: закрытый enum
действий + discriminated union. Невалидный тип или недостающие поля —
ValidationError, план не создаётся. Деньги — Decimal (правило 1.5).
"""
from datetime import date
from decimal import Decimal
from enum import Enum
from typing import Annotated, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field


class ActionType(str, Enum):
    create_trip = "create_trip"
    add_stop = "add_stop"
    remove_stop = "remove_stop"
    set_budget = "set_budget"
    set_stop_cost = "set_stop_cost"
    optimize = "optimize"


# 'viator' | 'price_level' | 'estimate' | 'manual' — источник цены (M5.1);
# 'auto' зарезервирован движком авто-оценок ТЗ-E и модели недоступен
CostSource = Literal["viator", "price_level", "estimate", "manual"]


class CreateTripAction(BaseModel):
    type: Literal[ActionType.create_trip]
    title: str
    city: Optional[str] = None
    country: Optional[str] = None
    adults_count: int = Field(1, ge=1)
    children_count: int = Field(0, ge=0)
    children_ages: Optional[list[int]] = None
    transport_default: str = "walking"
    # диапазон дат -> дни поездки (нужны add_stop.day_index)
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class AddStopAction(BaseModel):
    type: Literal[ActionType.add_stop]
    place_id: UUID              # только реальные места из search_places
    day_index: Optional[int] = Field(None, ge=0)
    duration_minutes: Optional[int] = Field(None, gt=0)
    # цены стопа (M5): точная сумма или диапазон-оценка
    cost_amount: Optional[Decimal] = None
    cost_min: Optional[Decimal] = None
    cost_max: Optional[Decimal] = None
    cost_currency: Optional[str] = Field(None, min_length=3, max_length=3)
    cost_is_estimate: bool = False
    cost_source: Optional[CostSource] = None


class RemoveStopAction(BaseModel):
    type: Literal[ActionType.remove_stop]
    stop_id: UUID


class SetBudgetAction(BaseModel):
    type: Literal[ActionType.set_budget]
    amount: Decimal = Field(gt=0)
    currency: str = Field(min_length=3, max_length=3)


class SetStopCostAction(BaseModel):
    type: Literal[ActionType.set_stop_cost]
    stop_id: UUID
    amount: Optional[Decimal] = None
    cost_min: Optional[Decimal] = None
    cost_max: Optional[Decimal] = None
    currency: str = Field(min_length=3, max_length=3)
    is_estimate: bool = False
    source: CostSource = "estimate"


class OptimizeAction(BaseModel):
    type: Literal[ActionType.optimize]


Action = Annotated[
    Union[
        CreateTripAction, AddStopAction, RemoveStopAction,
        SetBudgetAction, SetStopCostAction, OptimizeAction,
    ],
    Field(discriminator="type"),
]


class ProposedPlan(BaseModel):
    actions: list[Action] = Field(min_length=1)
    summary: str  # человекочитаемое описание для карточки превью
