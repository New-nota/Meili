from decimal import Decimal
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, Literal
from uuid import UUID
from datetime import datetime, date, time

from app.schemas.days import TripDayResponse

# S11: валюты мастера создания (одна на поездку, конвертаций нет)
Currency = Literal["RUB", "USD", "EUR", "CNY"]
# S11: мягкий кап длины поездки (60 дней) — иначе нагенерим сотни trip_days
MAX_TRIP_DAYS = 60


class TripCreate(BaseModel):
    title: str = Field(min_length=1)
    description: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    # S11: центр карты по выбранному городу
    city_lat: Optional[float] = None
    city_lon: Optional[float] = None
    transport_default: str = "walking"
    adults_count: int = Field(default=1, ge=1)          # S11: минимум 1 взрослый
    children_count: int = Field(default=0, ge=0)
    children_ages: Optional[list[int]] = None
    start_address: Optional[str] = None
    start_lat: Optional[float] = None
    start_lon: Optional[float] = None
    start_time: Optional[time] = None
    # S8 WP-3: диапазон дат -> автогенерация trip_days
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    # S11: бюджет опционален, валюта — из мастера
    budget_total: Optional[Decimal] = None
    currency: Optional[Currency] = None

    @field_validator("children_ages")
    @classmethod
    def _ages_range(cls, v: Optional[list[int]]) -> Optional[list[int]]:
        # S11: возраста детей 0–17 (с 18 — взрослый тариф)
        if v is not None and any(a < 0 or a > 17 for a in v):
            raise ValueError("children_ages must be within 0..17")
        return v

    @model_validator(mode="after")
    def _check_wizard(self) -> "TripCreate":
        # S11: даты обязательны в мастере; допускаем пустые (старый код без дат)
        if self.start_date or self.end_date:
            if not (self.start_date and self.end_date):
                raise ValueError("both start_date and end_date required")
            if self.end_date < self.start_date:
                raise ValueError("end_date must be >= start_date")
            if (self.end_date - self.start_date).days + 1 > MAX_TRIP_DAYS:
                raise ValueError(f"trip longer than {MAX_TRIP_DAYS} days")
            if self.start_date < date.today():
                raise ValueError("start_date must not be in the past")
        # число возрастов должно совпадать с числом детей, если возраста заданы
        if self.children_ages is not None and len(self.children_ages) != self.children_count:
            raise ValueError("children_ages length must equal children_count")
        return self

class TripUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    city_lat: Optional[float] = None
    city_lon: Optional[float] = None
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
    # S9 WP-A: бюджет
    budget_total: Optional[Decimal] = None
    currency: Optional[str] = None

class TripResponse(BaseModel):
    id: UUID
    title: str
    description: Optional[str]
    city: Optional[str]
    country: Optional[str]
    city_lat: Optional[float] = None
    city_lon: Optional[float] = None
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
    budget_total: Optional[Decimal] = None
    currency: str = "EUR"
    # S13: лайкнул ли текущий юзер эту поездку (для ❤ в превью); проставляется
    # только в GET /{trip_id}, в остальных ответах остаётся дефолтным
    liked_by_me: bool = False
    # S16: сумма остановок по всем дням (строка маршрута в профиле)
    stops_count: int = 0
    # S16: «запланировано» (compute_budget) — бюджет в строке профиля
    planned_total: Optional[Decimal] = None
    # S16: черновик — поездка без дат; статус вычисляет фронт (tripStatus.ts)
    is_draft: bool = False
    # S16 §2.4: «нравится N путешественникам» на карточке рекомендации
    likes_count: int = 0

    class Config:
        from_attributes = True


class TripDetailResponse(TripResponse):
    """S16 §1.4: карточка поездки — дни с вложенными остановками.

    Плоского списка stops больше нет: остановка живёт внутри своего дня,
    дни отсортированы по position.
    """
    days: list[TripDayResponse] = []