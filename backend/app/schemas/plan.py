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

from pydantic import BaseModel, Field, model_validator

from app.models.enums import TransportMode
from app.schemas.common import MAX_GROUP, MONEY_MAX_DIGITS, Money

# QA: план — граница LLM↔система, и он обходил все входные правила ручек:
# сумма 1e15 из set_budget долетала до Numeric(10,2) уже в executor'е и
# превращалась в «apply_failed» 500 при нажатии «Применить». Те же типы,
# что у API: невалидный план не замораживается, модель чинит его сама.
PositiveMoney = Annotated[Decimal, Field(gt=0, max_digits=MONEY_MAX_DIGITS, decimal_places=2)]


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
    title: str = Field(min_length=1, max_length=200)
    city: Optional[str] = Field(None, max_length=200)
    country: Optional[str] = Field(None, max_length=200)
    adults_count: int = Field(1, ge=1, le=MAX_GROUP)
    children_count: int = Field(0, ge=0, le=MAX_GROUP)
    children_ages: Optional[list[Annotated[int, Field(ge=0, le=17)]]] = None
    transport_default: TransportMode = TransportMode.WALKING
    # диапазон дат -> дни поездки (нужны add_stop.day_index)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    # Ревью: валюта берётся из черновика мастера, но модель может задать её и
    # сама. Координаты города (city_lat/lon) модели недоступны — их executor
    # подставляет из черновика: выдумывать координаты она не должна
    currency: Optional[str] = Field(None, min_length=3, max_length=3)


class AddStopAction(BaseModel):
    """Добавить место в день.

    Ревью: ссылаться можно place_id ИЛИ place_name. UUID модель не держит в
    голове между ходами (результат поиска живёт только внутри своего хода),
    и на просьбу «готов» она принималась их сочинять — вплоть до
    «a1b2c3d4-e5f6-7890-g1h2-…», где букв g/h/i в hex не бывает. Имя она
    помнит прекрасно, а превратить имя в идентификатор — работа системы:
    резолв идёт по базе при заморозке плана (services/meili/plan_refs).
    """
    type: Literal[ActionType.add_stop]
    place_id: Optional[UUID] = None    # реальный id из search_places
    place_name: Optional[str] = None   # либо точное название найденного места
    day_index: Optional[int] = Field(None, ge=0, le=60)
    duration_minutes: Optional[int] = Field(None, ge=5, le=720)
    # цены стопа (M5): точная сумма или диапазон-оценка
    cost_amount: Optional[Money] = None
    cost_min: Optional[Money] = None
    cost_max: Optional[Money] = None
    cost_currency: Optional[str] = Field(None, min_length=3, max_length=3)
    cost_is_estimate: bool = False
    cost_source: Optional[CostSource] = None

    @model_validator(mode="after")
    def _needs_a_reference(self) -> "AddStopAction":
        if self.place_id is None and not (self.place_name or "").strip():
            raise ValueError("укажи place_id или place_name")
        return self


class _StopRef(BaseModel):
    """QA: ссылка на стоп поездки — id ИЛИ название места (+ день).

    Снапшот показывает модели стопы по названиям, id там нет — и «убери
    музей» был обречён на выдуманный stop_id и отказ плана по кругу. Как и с
    place_name: имя → id превращает система (plan_refs) при заморозке.
    """
    stop_id: Optional[UUID] = None
    stop_name: Optional[str] = Field(None, max_length=200)
    day_index: Optional[int] = Field(None, ge=0, le=60)  # уточнение, если имя повторяется

    @model_validator(mode="after")
    def _needs_stop_reference(self):
        if self.stop_id is None and not (self.stop_name or "").strip():
            raise ValueError("укажи stop_id или stop_name (название места из снапшота)")
        return self


class RemoveStopAction(_StopRef):
    type: Literal[ActionType.remove_stop]


class SetBudgetAction(BaseModel):
    type: Literal[ActionType.set_budget]
    amount: PositiveMoney
    currency: str = Field(min_length=3, max_length=3)


class SetStopCostAction(_StopRef):
    type: Literal[ActionType.set_stop_cost]
    amount: Optional[Money] = None
    cost_min: Optional[Money] = None
    cost_max: Optional[Money] = None
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
