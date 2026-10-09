"""Ценовой гибрид (ТЗ-Meili M5.1).

Есть реальный источник — берём его (is_estimate=false). Нет — система честно
говорит «данных нет»: модель может дать только ДИАПАЗОН-оценку (cost_min/max,
source='estimate', is_estimate=true), которая рисуется с «≈» и не пишется в БД
молча — только через «Применить».

Реальные источники в этом приложении: цены мест ТЗ-E (avg_check / билеты /
free) и категория price_level из OSM. Viator/Booking — deep-link без цен,
поэтому источником цены не являются; source='viator' зарезервирован на будущее.
"""
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel

from app.models.place import Place


class PriceInfo(BaseModel):
    source: Literal["price_level", "estimate"]
    is_estimate: bool
    amount: Optional[Decimal] = None       # реальная цена: билет взрослый / средний чек
    amount_child: Optional[Decimal] = None
    currency: Optional[str] = None
    price_level: Optional[int] = None      # категория 1–4, если только она и есть
    label: str                             # человекочитаемая метка для модели/UI


async def resolve_price(place: Place) -> PriceInfo:
    # ТЗ-E: точные цены места — реальный источник
    if place.pricing_model == "free":
        return PriceInfo(source="price_level", is_estimate=False,
                         amount=Decimal("0.00"), label="бесплатно")
    if place.pricing_model == "per_person" and place.avg_check is not None:
        return PriceInfo(
            source="price_level", is_estimate=False,
            amount=Decimal(place.avg_check), currency=place.price_currency,
            label=f"средний чек {place.avg_check} {place.price_currency or ''}".strip()
            + (" (по данным 2ГИС)" if place.price_source == "2gis" else ""),
        )
    if place.pricing_model == "ticketed" and place.ticket_adult is not None:
        label = f"билет {place.ticket_adult}"
        if place.ticket_child is not None:
            label += f", детский {place.ticket_child}"
        return PriceInfo(
            source="price_level", is_estimate=False,
            amount=Decimal(place.ticket_adult),
            amount_child=Decimal(place.ticket_child) if place.ticket_child is not None else None,
            currency=place.price_currency,
            label=f"{label} {place.price_currency or ''}".strip(),
        )
    # категория цен OSM: реальный источник без абсолютной суммы
    if place.price_level is not None:
        return PriceInfo(
            source="price_level", is_estimate=False, price_level=place.price_level,
            label="цена: " + "₽" * max(1, min(4, place.price_level)),
        )
    # источника нет: только диапазон-оценка от модели (в плане, не в БД).
    # Ревью: метка — ДАННЫЕ, а не инструкция. Прежний текст читался как
    # подсказка «оцени диапазоном», и модель на нём умудрялась дописать
    # паркам «бесплатные». Теперь поле говорит ровно одно: суммы нет.
    # Что с этим делать — сказано в системном промпте.
    return PriceInfo(
        source="estimate", is_estimate=True,
        label="стоимость неизвестна",
    )
