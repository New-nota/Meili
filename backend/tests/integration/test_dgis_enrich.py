"""Этап B: обогащение мест из 2ГИС (фейк вместо живого API)."""
import asyncio
from datetime import datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.place import Place
from app.services.meili.tools.search_places import search_places
from app.services.providers import Enrichment, dgis, enrich
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from tests.integration.conftest import _TEST_ASYNC_URL


class FakeRedis:
    def __init__(self):
        self.data: dict = {}

    async def mget(self, keys):
        return [self.data.get(k) for k in keys]

    async def incrby(self, key, n):
        self.data[key] = int(self.data.get(key, 0)) + n
        return self.data[key]

    async def expire(self, key, ttl):
        pass

    async def setex(self, key, ttl, value):
        self.data[key] = value


@pytest.fixture
async def sessions(client):
    engine = create_async_engine(_TEST_ASYNC_URL)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
def dgis_on(monkeypatch):
    """Ключ есть, Redis — фейк, 2ГИС — словарь «имя → факты»."""
    monkeypatch.setattr(settings, "DGIS_API_KEY", "test")
    monkeypatch.setattr(settings, "DGIS_COVERAGE", [])
    redis = FakeRedis()
    monkeypatch.setattr(enrich, "redis_client", redis)
    known: dict[str, Enrichment] = {}
    calls: list[str] = []

    async def fake_find(client, name, lat, lon, category=None):
        calls.append(name)
        if name == "Медленное кафе":
            await asyncio.sleep(10)
        if name == "Лежит":
            raise dgis.DgisUnavailable("503")
        return known.get(name)

    monkeypatch.setattr(dgis, "find", fake_find)
    return known, calls, redis


async def _place(client, headers, name, category="restaurant", lat=54.7059, lon=20.5133) -> str:
    r = await client.post("/places/", json={"name": name, "lat": lat, "lon": lon, "category": category,
                                           "city": "Калининград"}, headers=headers)
    return r.json()["id"]


def _club(**kw) -> Enrichment:
    return Enrichment(provider="2gis", provider_id=kw.pop("id", "2g-1"), rating=Decimal("4.60"),
                      rating_count=231, avg_check=Decimal("1750.00"), currency="RUB",
                      opening_hours={"mo": [["12:00", "23:00"]]}, **kw)


async def test_search_enriches_and_reports_2gis_facts(client, auth_headers, sessions, dgis_on):
    known, calls, _ = dgis_on
    await _place(client, auth_headers, "Рыбный клуб")
    known["Рыбный клуб"] = _club()
    async with sessions() as db:
        res = await search_places(db, datetime(2026, 10, 12, 13, 0), query="Рыбный клуб")
    hit = res[0]
    assert hit["avg_check"] == "1750.00" and hit["price_currency"] == "RUB"
    assert hit["price_source"] == "2gis" and "по данным 2ГИС" in hit["price"]
    assert hit["rating"] == "4.60" and hit["rating_count"] == 231
    assert hit["is_open_now"] is True  # часы из 2ГИС (понедельник 13:00)

    # повторный поиск — без запроса в 2ГИС (обогащено, свежее 30 дней)
    async with sessions() as db:
        await search_places(db, datetime(2026, 10, 12, 13, 0), query="Рыбный клуб")
    assert calls == ["Рыбный клуб"]


async def test_manual_price_is_never_overwritten(client, auth_headers, sessions, dgis_on):
    known, _, _ = dgis_on
    pid = await _place(client, auth_headers, "Рыбный клуб")
    r = await client.patch(f"/places/{pid}", headers=auth_headers,
                           json={"pricing_model": "per_person", "avg_check": "999.00", "price_currency": "RUB"})
    assert r.json()["price_source"] == "manual"
    known["Рыбный клуб"] = _club()
    async with sessions() as db:
        hit = (await search_places(db, datetime(2026, 10, 12, 13, 0), query="Рыбный клуб"))[0]
    assert hit["avg_check"] == "999.00" and hit["price_source"] == "manual"
    assert hit["rating"] == "4.60"  # рейтинг при этом взяли


async def test_lodging_price_is_shown_not_budgeted(client, auth_headers, sessions, dgis_on):
    known, _, _ = dgis_on
    await _place(client, auth_headers, "Отель Балтика", category="hotel")
    known["Отель Балтика"] = Enrichment(provider="2gis", provider_id="2g-h",
                                        lodging_price_from=Decimal("3500.00"), currency="RUB")
    async with sessions() as db:
        hit = (await search_places(db, datetime(2026, 10, 12, 13, 0), query="Балтика", category="hotel"))[0]
    assert hit["lodging_price_from"] == "3500.00"
    assert "avg_check" not in hit and hit["price"] == "стоимость неизвестна"  # не цена стопа


async def test_slow_and_failing_go_background_miss_is_cached(client, auth_headers, sessions, dgis_on, _no_real_celery):
    known, calls, redis = dgis_on
    slow = await _place(client, auth_headers, "Медленное кафе", category="cafe")
    await _place(client, auth_headers, "Лежит", category="cafe", lat=54.71)
    await _place(client, auth_headers, "Нет в 2ГИС", category="cafe", lat=54.72)
    async with sessions() as db:
        places = list((await db.execute(select(Place))).scalars().all())
        written = await enrich.enrich_places(db, places, budget_s=0.2)
    assert written == 0
    assert [("dgis", [str(i) for i in ids]) for k, ids in _no_real_celery if k == "dgis"] == [("dgis", [slow])]  # не успел — в фон
    assert sum(1 for k in redis.data if k.startswith("dgis:miss:")) == 1  # «нет» — запомнили
    async with sessions() as db:
        lying = (await db.execute(select(Place).where(Place.name == "Лежит"))).scalar_one()
        assert lying.enriched_at is None   # сбой ≠ «нет»: спросим в следующий раз


async def test_daily_limit_caps_requests(client, auth_headers, sessions, dgis_on, monkeypatch):
    _, calls, _ = dgis_on
    monkeypatch.setattr(settings, "DGIS_DAILY_LIMIT", 2)
    for i in range(3):
        await _place(client, auth_headers, f"Кафе {i}", category="cafe", lat=54.70 + i / 100)
    async with sessions() as db:
        places = list((await db.execute(select(Place))).scalars().all())
        await enrich.enrich_places(db, places)
    assert len(calls) == 2


async def test_same_2gis_object_for_osm_duplicates(client, auth_headers, sessions, dgis_on):
    """OSM: одно заведение точкой и контуром — у 2ГИС это один объект. Факты
    получают оба, dgis_id (unique) — один, поиск не падает."""
    known, _, _ = dgis_on
    await _place(client, auth_headers, "Рыбный клуб")
    await _place(client, auth_headers, "Рыбный клуб", lat=54.7060)
    known["Рыбный клуб"] = _club()
    async with sessions() as db:
        places = list((await db.execute(select(Place))).scalars().all())
        assert await enrich.enrich_places(db, places) == 2
    async with sessions() as db:
        rows = (await db.execute(select(Place.dgis_id, Place.avg_check))).all()
    assert sorted(r.dgis_id or "" for r in rows) == ["", "2g-1"]
    assert {r.avg_check for r in rows} == {Decimal("1750.00")}


async def test_without_key_nothing_happens(client, auth_headers, sessions, monkeypatch):
    called = []
    monkeypatch.setattr(dgis, "find", lambda *a: called.append(a))
    await _place(client, auth_headers, "Рыбный клуб")
    async with sessions() as db:
        await search_places(db, datetime(2026, 10, 12, 13, 0), query="Рыбный клуб")
    assert called == []
