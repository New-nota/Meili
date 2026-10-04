from decimal import Decimal
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, Literal
from uuid import UUID
from datetime import datetime, date, time

from app.models.enums import TransportMode
from app.schemas.common import MAX_GROUP, Money, WallTime, not_null
from app.schemas.days import TripDayResponse

# S11: валюты мастера создания (одна на поездку, конвертаций нет)
Currency = Literal["RUB", "USD", "EUR", "CNY"]
# S11: мягкий кап длины поездки (60 дней) — иначе нагенерим сотни trip_days
MAX_TRIP_DAYS = 60
# QA: потолки свободного текста — колонки безразмерные, но мегабайтный title
# потом едет в каждый список поездок, PDF и контекст Meili
TITLE_MAX = 200
SHORT_TEXT_MAX = 200
DESCRIPTION_MAX = 5000


def _strip_title(v):
    # «   » проходил min_length=1 и рисовал в списке пустую карточку
    return v.strip() if isinstance(v, str) else v


class TripCreate(BaseModel):
    title: str = Field(min_length=1, max_length=TITLE_MAX)
    description: Optional[str] = Field(None, max_length=DESCRIPTION_MAX)
    city: Optional[str] = Field(None, max_length=SHORT_TEXT_MAX)
    country: Optional[str] = Field(None, max_length=SHORT_TEXT_MAX)
    # S11: центр карты по выбранному городу
    city_lat: Optional[float] = Field(None, ge=-90, le=90)
    city_lon: Optional[float] = Field(None, ge=-180, le=180)
    # QA: был голый str — «test» сохранялся и потом не матчился ни с одним
    # costing'ом Valhalla
    transport_default: TransportMode = TransportMode.WALKING
    adults_count: int = Field(default=1, ge=1, le=MAX_GROUP)   # S11: минимум 1 взрослый
    children_count: int = Field(default=0, ge=0, le=MAX_GROUP)
    children_ages: Optional[list[int]] = None
    start_address: Optional[str] = Field(None, max_length=SHORT_TEXT_MAX)
    start_lat: Optional[float] = Field(None, ge=-90, le=90)
    start_lon: Optional[float] = Field(None, ge=-180, le=180)
    start_time: Optional[WallTime] = None
    # S8 WP-3: диапазон дат -> автогенерация trip_days
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    # S11: бюджет опционален, валюта — из мастера.
    # QA: в create не было даже ge=0 (в update был) — отрицательный бюджет
    # и переполнение Numeric(10,2) проходили через мастер
    budget_total: Optional[Money] = None
    currency: Optional[Currency] = None

    _strip = field_validator("title", mode="before")(_strip_title)

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
    """Ревью: раньше схема была голой — PATCH пролезал мимо всех правил,
    которые TripCreate уже держал. Отсюда жили три бага:
    отрицательная группа (`adults_count: -5` — и «👥 -8» в профиле, и
    отрицательные авто-оценки), currency длиннее varchar(3) (DataError -> 500)
    и диапазон дат без капа (см. MAX_TRIP_DAYS в sync_trip_days).
    """
    title: Optional[str] = Field(None, min_length=1, max_length=TITLE_MAX)
    description: Optional[str] = Field(None, max_length=DESCRIPTION_MAX)
    city: Optional[str] = Field(None, max_length=SHORT_TEXT_MAX)
    country: Optional[str] = Field(None, max_length=SHORT_TEXT_MAX)
    city_lat: Optional[float] = Field(None, ge=-90, le=90)
    city_lon: Optional[float] = Field(None, ge=-180, le=180)
    transport_default: Optional[TransportMode] = None
    adults_count: Optional[int] = Field(None, ge=1, le=MAX_GROUP)
    children_count: Optional[int] = Field(None, ge=0, le=MAX_GROUP)
    children_ages: Optional[list[int]] = None
    start_address: Optional[str] = Field(None, max_length=SHORT_TEXT_MAX)
    start_lat: Optional[float] = Field(None, ge=-90, le=90)
    start_lon: Optional[float] = Field(None, ge=-180, le=180)
    start_time: Optional[WallTime] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    # S9: поле существовало в UI с С4, но отсутствовало в схеме — публикация
    # молча отбрасывалась Pydantic'ом
    is_public: Optional[bool] = None
    # S9 WP-A: бюджет
    budget_total: Optional[Money] = None
    currency: Optional[Currency] = None

    _strip = field_validator("title", mode="before")(_strip_title)
    # QA: явный null в NOT NULL-колонку ронял flush (IntegrityError → 500)
    _nn = field_validator(
        "title", "adults_count", "children_count", "currency", "is_public",
    )(not_null)

    @field_validator("children_ages")
    @classmethod
    def _ages_range(cls, v: Optional[list[int]]) -> Optional[list[int]]:
        if v is not None and any(a < 0 or a > 17 for a in v):
            raise ValueError("children_ages must be within 0..17")
        return v

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
    # IANA-таймзона поездки — по координатам города (geo.timezone_at)
    timezone: str = "UTC"
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