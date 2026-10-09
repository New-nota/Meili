"""Внешние источники фактов о местах (этап B).

Место в каталоге — из OSM: координаты и имя есть, а цены, рейтинга и часто
часов нет. Провайдер по месту находит СВОЙ объект и отдаёт факты о нём
(`Enrichment`). Сейчас провайдер один — 2ГИС (dgis.py); Google Places встанет
рядом, когда будет чем платить (у него хранить можно только place_id — см.
ТЗ-разбор этапа B, поэтому интерфейс не предполагает записи в БД сам по себе:
что сохранять, решает enrich.py).
"""
from dataclasses import dataclass, field
from decimal import Decimal


@dataclass
class Enrichment:
    provider: str                           # '2gis'
    provider_id: str
    rating: Decimal | None = None
    rating_count: int | None = None
    opening_hours: dict | None = None       # наш формат 2 (по дням недели)
    avg_check: Decimal | None = None        # средний счёт на человека
    lodging_price_from: Decimal | None = None
    currency: str | None = None             # валюта сумм выше; нет — суммы не пишем
    raw_attributes: list[str] = field(default_factory=list)  # для пробы/отладки
