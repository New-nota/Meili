"""Сервис без привязки к Калининграду: покрытие из конфига, таймзона по
городу, Meili в чужом городе и автозаполнение каталога из OSM."""
import json

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.place import Place
from app.services.llm.base import LLMEvent
from app.services.places import catalog
from app.services.places.catalog import CityRef, ensure_city_catalog
from tests.integration.conftest import _TEST_ASYNC_URL, D1
from tests.integration.test_meili import _conversation, _stream_events, install_fake

PARIS = {"city": "Paris", "city_lat": 48.8566, "city_lon": 2.3522}


async def _paris_trip(client, headers) -> dict:
    r = await client.post(
        "/trips/", json={"title": "Париж", "start_date": D1, "end_date": D1, **PARIS},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_stop_anywhere_when_coverage_is_world(client, auth_headers):
    trip = await _paris_trip(client, auth_headers)
    day = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()[0]
    place = (await client.post(
        "/places/", json={"name": "Лувр", "lat": 48.8606, "lon": 2.3376}, headers=auth_headers,
    )).json()
    r = await client.post(
        f"/trips/{trip['id']}/stops",
        json={"place_id": place["id"], "day_id": day["id"]}, headers=auth_headers,
    )
    assert r.status_code == 200, r.text


async def test_meta_exposes_coverage(client, kaliningrad_coverage):
    r = await client.get("/meta")
    assert r.json() == {"routing_coverage": [[54.30, 19.60, 55.35, 23.05]]}


async def test_trip_timezone_follows_city(client, auth_headers):
    trip = await _paris_trip(client, auth_headers)
    assert trip["timezone"] == "Europe/Paris"
    r = await client.patch(
        f"/trips/{trip['id']}", json={"city": "Tokyo", "city_lat": 35.68, "city_lon": 139.69},
        headers=auth_headers,
    )
    assert r.json()["timezone"] == "Asia/Tokyo"
    # без координат города — нейтральный UTC, а не Калининград
    r = await client.post("/trips/", json={"title": "Где-то"}, headers=auth_headers)
    assert r.json()["timezone"] == "UTC"


async def test_meili_finds_places_of_foreign_city(client, auth_headers, monkeypatch):
    """Модель пишет «Париж», у мест из OSM город «Paris» — город находит
    геокодер, места — радиус от центра. Калининград в ответ не попадает."""
    for body in (
        {"name": "Лувр", "lat": 48.8606, "lon": 2.3376, "category": "museum", "city": "Paris"},
        {"name": "Орсе", "lat": 48.8600, "lon": 2.3266, "category": "museum"},  # без города
        {"name": "Музей янтаря", "lat": 54.7194, "lon": 20.5242, "category": "museum",
         "city": "Калининград"},
    ):
        assert (await client.post("/places/", json=body, headers=auth_headers)).status_code == 200

    async def fake_geocode(name):
        return CityRef("Paris", 48.8566, 2.3522, 10_000) if name.strip().lower() == "париж" else None

    monkeypatch.setattr(catalog, "geocode_city", fake_geocode)
    fake = install_fake(monkeypatch, [
        [LLMEvent(type="tool_call", name="search_places",
                  arguments={"query": "музей", "city": "Париж"}, id="c1"),
         LLMEvent(type="end")],
        [LLMEvent(type="token", text="ок"), LLMEvent(type="end")],
    ])
    conv_id = await _conversation(client, auth_headers)
    await _stream_events(client, auth_headers, conv_id, "музеи в Париже")
    tool_msg = [m for m in fake.calls[1]["messages"] if m.get("role") == "tool"][-1]
    names = {p["name"] for p in json.loads(tool_msg["content"])}
    assert names == {"Лувр", "Орсе"}


async def test_landmark_is_searched_within_city(client, auth_headers, monkeypatch):
    """«кафе у собора» в Париже не должно привязаться к собору в Калининграде."""
    for body in (
        {"name": "Кафедральный собор", "lat": 54.7065, "lon": 20.5110, "city": "Калининград"},
        {"name": "Кафе у собора", "lat": 54.7060, "lon": 20.5120, "category": "cafe",
         "city": "Калининград"},
    ):
        await client.post("/places/", json=body, headers=auth_headers)

    async def fake_geocode(name):
        return CityRef("Paris", 48.8566, 2.3522, 10_000)

    monkeypatch.setattr(catalog, "geocode_city", fake_geocode)
    fake = install_fake(monkeypatch, [
        [LLMEvent(type="tool_call", name="search_places", arguments={
            "query": "кафе", "city": "Париж", "near_place": "Кафедральный собор"}, id="c1"),
         LLMEvent(type="end")],
        [LLMEvent(type="token", text="ок"), LLMEvent(type="end")],
    ])
    conv_id = await _conversation(client, auth_headers)
    await _stream_events(client, auth_headers, conv_id)
    tool_msg = [m for m in fake.calls[1]["messages"] if m.get("role") == "tool"][-1]
    assert "Кафе у собора" not in tool_msg["content"]


class FakeRedis:
    def __init__(self):
        self.data = {}

    async def exists(self, key):
        return int(key in self.data)

    async def setex(self, key, ttl, value):
        self.data[key] = value

    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self.data:
            return None
        self.data[key] = value
        return True

    async def delete(self, key):
        self.data.pop(key, None)


async def test_city_catalog_autofill_is_idempotent(client, monkeypatch):
    """Пустой город — один запрос в Overpass, места в каталоге с городом;
    повтор — ни запроса, ни дублей."""
    engine = create_async_engine(_TEST_ASYNC_URL)
    monkeypatch.setattr(catalog, "session_factory", async_sessionmaker(engine, expire_on_commit=False))
    monkeypatch.setattr(catalog, "redis_client", FakeRedis())
    fetches = []

    async def fake_fetch(lat, lon, radius):
        fetches.append(radius)
        return [
            {"osm_id": "node/1", "name": "Opera House", "lat": -33.8568, "lon": 151.2153,
             "address": "", "city": None, "category": "theatre"},
            {"osm_id": "way/2", "name": "Royal Botanic Garden", "lat": -33.8642, "lon": 151.2166,
             "address": "Mrs Macquaries Rd", "city": "Sydney", "category": "park"},
        ], True

    monkeypatch.setattr(catalog, "_fetch_area", fake_fetch)
    sydney = CityRef("Сидней", -33.8688, 151.2093, 20_000)
    try:
        assert await ensure_city_catalog(sydney) == 2
        assert fetches == [catalog.MAX_FETCH_RADIUS_M]  # агломерацию целиком не тянем
        assert await ensure_city_catalog(sydney) == 0   # метка области
        assert len(fetches) == 1
        async with engine.connect() as conn:
            rows = (await conn.execute(
                select(Place.name, Place.city, Place.category).order_by(Place.name)
            )).all()
            assert [tuple(r) for r in rows] == [
                ("Opera House", "Сидней", "theatre"),  # addr:city нет — город запроса
                ("Royal Botanic Garden", "Sydney", "park"),
            ]
            assert (await conn.execute(select(func.count()).select_from(Place))).scalar() == 2
    finally:
        await engine.dispose()
