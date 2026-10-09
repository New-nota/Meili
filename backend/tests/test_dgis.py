"""Этап B: парсер и сопоставление 2ГИС. Фикстура — по формату справочника
catalog.api.2gis.com/3.0/items (живого ключа на момент написания не было)."""
import json
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from app.core.config import settings
from app.services.providers import dgis

ITEMS = json.loads((Path(__file__).parent / "fixtures" / "dgis_items.json").read_text())


def test_parse_item_takes_rating_hours_and_avg_check():
    found = dgis.parse_item(ITEMS["result"]["items"][0])
    assert found.provider_id == "70000001023456789"
    assert found.rating == Decimal("4.60") and found.rating_count == 231
    assert found.avg_check == Decimal("1750.00") and found.currency == "RUB"  # середина 1500–2000
    assert found.opening_hours["fr"] == [["12:00", "01:00"]]
    assert found.lodging_price_from is None


@pytest.mark.parametrize("texts, expected", [
    (["Средний счёт до 500 ₽"], (Decimal("500.00"), None, "RUB")),
    (["Номер от 3 500 ₽ за ночь"], (None, Decimal("3500.00"), "RUB")),
    (["Средний чек 4000–6000 тенге"], (Decimal("5000.00"), None, "KZT")),
    (["Средний счёт 30–50 бел. руб."], (Decimal("40.00"), None, "BYN")),
    (["Средний счёт 1500"], (None, None, None)),     # без валюты — не факт
    (["Wi-Fi", "Парковка"], (None, None, None)),
])
def test_price_attributes(texts, expected):
    assert dgis.parse_price_attributes(texts) == expected


def test_schedule_24x7_and_empty():
    assert dgis.parse_schedule({"is_24x7": True})["su"] == [["00:00", "24:00"]]
    assert dgis.parse_schedule({}) is None
    assert dgis.parse_schedule({"Mon": {"working_hours": []}}) is None


def test_rating_without_reviews_is_noise():
    found = dgis.parse_item({"id": 1, "reviews": {"general_rating": 5.0, "general_review_count": 0}})
    assert found.rating is None and found.rating_count is None


def test_match_needs_similar_name_and_close_point():
    items = ITEMS["result"]["items"]
    # OSM «Рыбный клуб» ↔ 2ГИС «Рыбный клуб, ресторан» — вхождение имени
    assert dgis.best_match("Рыбный клуб", 54.7059, 20.5132, items)["id"] == "70000001023456789"
    # то же имя, но в 2 км — другое заведение
    assert dgis.best_match("Рыбный клуб", 54.725, 20.513, items) is None
    # рядом, но не похоже по имени
    assert dgis.best_match("Кафе Марципан", 54.7059, 20.5132, items) is None


async def test_search_near_sends_point_lon_lat_and_key(monkeypatch):
    monkeypatch.setattr(settings, "DGIS_API_KEY", "k")
    seen = []

    def handler(request):
        seen.append(request.url)
        return httpx.Response(200, json=ITEMS)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        items = await dgis.search_near(client, "Рыбный клуб", 54.7, 20.5)
    assert len(items) == 2
    assert seen[0].params["point"] == "20.5,54.7"   # у 2ГИС долгота первой
    assert seen[0].params["key"] == "k" and "items.attribute_groups" in seen[0].params["fields"]


async def test_search_near_404_is_empty_and_5xx_is_unavailable():
    async def run(response):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: response)) as client:
            return await dgis.search_near(client, "x", 54.7, 20.5)

    assert await run(httpx.Response(200, json={"meta": {"code": 404}})) == []
    with pytest.raises(dgis.DgisUnavailable):
        await run(httpx.Response(503))
