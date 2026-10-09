"""Живой прогон «Свидание в Москве»: суммы на группу, потолок цены, карточки
только названных мест, имя в плане — в городе поездки, режим старта дня."""
from datetime import datetime
from decimal import Decimal

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.place import Place
from app.services.llm.base import LLMEvent
from app.services.meili.loop import named_cards
from app.services.meili.tools.search_places import GroupCtx, search_places
from tests.integration.conftest import _TEST_ASYNC_URL, D1, D2
from tests.integration.test_meili import _freeze_plan, _stream_events, install_fake

MOSCOW = (55.7558, 37.6173)
KALININGRAD = (54.7104, 20.5114)


@pytest.fixture
async def sessions(client):
    engine = create_async_engine(_TEST_ASYNC_URL)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def _place(client, headers, name, category, at=MOSCOW, dlat=0.0, **prices) -> str:
    r = await client.post("/places/", headers=headers, json={
        "name": name, "category": category, "lat": at[0] + dlat, "lon": at[1], "city": "Москва"})
    pid = r.json()["id"]
    if prices:
        await client.patch(f"/places/{pid}", headers=headers, json=prices)
    return pid


async def test_group_cost_and_price_ceiling(client, auth_headers, sessions):
    await _place(client, auth_headers, "Хинкальная", "restaurant",
                 pricing_model="per_person", avg_check="1100.00", price_currency="RUB")
    cheap = await _place(client, auth_headers, "Славянка", "hotel", dlat=0.001)
    rich = await _place(client, auth_headers, "Four Seasons", "hotel", dlat=0.002)
    async with sessions() as db:
        await db.execute(update(Place).where(Place.id == cheap).values(
            lodging_price_from=Decimal("3240"), price_currency="RUB"))
        await db.execute(update(Place).where(Place.id == rich).values(
            lodging_price_from=Decimal("50000"), price_currency="RUB"))
        await db.commit()
    group = GroupCtx(adults=2, currency="RUB", nights=1)
    async with sessions() as db:
        food = await search_places(db, datetime(2026, 10, 17, 19), query="Хинкальная", group=group)
        hotels = await search_places(db, datetime(2026, 10, 17, 19), query="отель",
                                     category="hotel", max_price=5000, group=group)
    assert food[0]["cost_for_group"] == "2200.00" and food[0]["group_size"] == 2
    # «на отель 5000» — Four Seasons от 50 000 в выдачу не попадает
    assert [h["name"] for h in hotels] == ["Славянка"]
    assert hotels[0]["lodging_total_from"] == "3240.00" and hotels[0]["nights"] == 1


def test_cards_only_for_named_places_in_order():
    cards = [{"place_id": str(i), "name": n} for i, n in enumerate(
        ["Surf Coffee", "Барбос", "Хинкальная", "Surf Coffee", "Блюм"])]
    answer = "Утром — «Хинкальная», вечером кофе в Surf Coffee."
    assert [c["place_id"] for c in named_cards(cards, answer)] == ["2", "0"]


async def test_plan_name_resolves_in_trip_city_not_elsewhere(client, auth_headers, sessions, monkeypatch):
    """Живой прогон: «Славянка» из московского поиска в плане стала
    калининградской — резолв имени шёл по всей базе."""
    await _place(client, auth_headers, "Славянка", "hotel", at=KALININGRAD)
    moscow_id = await _place(client, auth_headers, "Славянка", "hotel")
    trip = await client.post("/trips/", headers=auth_headers, json={
        "title": "Свидание", "start_date": D1, "end_date": D2, "city": "Москва",
        "city_lat": MOSCOW[0], "city_lon": MOSCOW[1], "currency": "RUB"})
    trip_id = trip.json()["id"]
    plan_id = await _freeze_plan(client, auth_headers, monkeypatch, {
        "actions": [{"type": "set_lodging", "place_name": "Славянка"}], "summary": "x"}, trip_id=trip_id)
    from app.models.meili_plan import MeiliPlan
    async with sessions() as db:
        plan = await db.get(MeiliPlan, __import__("uuid").UUID(plan_id))
    assert plan.plan_json["actions"][0]["place_id"] == moscow_id


async def test_model_cost_ignored_when_place_has_price(client, auth_headers, monkeypatch):
    """Модель писала cost_amount=400 (чек НА ОДНОГО) как сумму стопа на двоих."""
    pid = await _place(client, auth_headers, "Surf Coffee", "cafe",
                       pricing_model="per_person", avg_check="400.00", price_currency="RUB")
    trip = await client.post("/trips/", headers=auth_headers, json={
        "title": "Свидание", "start_date": D1, "end_date": D1, "adults_count": 2, "currency": "RUB"})
    trip_id = trip.json()["id"]
    plan_id = await _freeze_plan(client, auth_headers, monkeypatch, {"actions": [
        {"type": "add_stop", "place_id": pid, "day_index": 0, "cost_amount": "400", "cost_currency": "RUB"},
    ], "summary": "x"}, trip_id=trip_id)
    assert (await client.post(f"/api/meili/plans/{plan_id}/apply", headers=auth_headers)).status_code == 200
    stop = (await client.get(f"/trips/{trip_id}/stops", headers=auth_headers)).json()[0]
    assert stop["estimated_cost"] == "800.00" and stop["cost_source"] == "auto"


async def test_search_gets_group_from_draft(client, auth_headers, monkeypatch):
    """Группа и ночи для сумм — из черновика мастера, не из аргументов модели."""
    await _place(client, auth_headers, "Хинкальная", "restaurant",
                 pricing_model="per_person", avg_check="1100.00", price_currency="RUB")
    fake = install_fake(monkeypatch, [
        [LLMEvent(type="tool_call", name="search_places", arguments={"query": "Хинкальная"}, id="c1"),
         LLMEvent(type="end")],
        [LLMEvent(type="token", text="Хинкальная"), LLMEvent(type="end")],
    ])
    r = await client.post("/api/meili/conversations", headers=auth_headers, json={
        "city": "Москва", "adults_count": 2, "currency": "RUB",
        "start_date": "2026-10-17", "end_date": "2026-10-18"})
    events = await _stream_events(client, auth_headers, r.json()["id"], "где поесть")
    cards = [d for e, d in events if e == "places"][0]["places"]
    assert cards[0]["cost_for_group"] == "2200.00"
    system = fake.calls[0]["messages"][0]["content"]
    assert "ночей: 1" in system


async def test_start_transport_drives_first_leg(client, auth_headers):
    trip = await client.post("/trips/", headers=auth_headers, json={
        "title": "x", "start_date": D1, "end_date": D1})
    trip_id = trip.json()["id"]
    day = (await client.get(f"/trips/{trip_id}/days", headers=auth_headers)).json()[0]
    loc = (await client.post(f"/trips/{trip_id}/locations", headers=auth_headers,
                             json={"name": "Отель", "lat": 55.75, "lon": 37.60})).json()
    pid = await _place(client, auth_headers, "Музей", "museum")
    await client.post(f"/trips/{trip_id}/stops", headers=auth_headers, json={"place_id": pid, "day_id": day["id"]})
    r = await client.patch(f"/trips/{trip_id}/days/{day['id']}", headers=auth_headers,
                           json={"start_location_id": loc["id"], "start_transport": "driving"})
    assert r.status_code == 200 and r.json()["start_transport"] == "driving"
    route = (await client.get(f"/trips/{trip_id}/route?day_id={day['id']}", headers=auth_headers)).json()
    first = [leg for leg in route["legs"] if leg["from_stop_id"] is None][0]
    assert first["costing"] == "driving"
    bad = await client.patch(f"/trips/{trip_id}/days/{day['id']}", headers=auth_headers,
                             json={"start_transport": "teleport"})
    assert bad.status_code == 422


async def test_day_start_time_editable_and_ordered(client, auth_headers):
    """Живой прогон: день всегда начинался в 09:00 — менять было нечем."""
    trip = await client.post("/trips/", headers=auth_headers, json={
        "title": "x", "start_date": D1, "end_date": D1})
    trip_id = trip.json()["id"]
    day = (await client.get(f"/trips/{trip_id}/days", headers=auth_headers)).json()[0]
    r = await client.patch(f"/trips/{trip_id}/days/{day['id']}", headers=auth_headers,
                           json={"start_time": "12:30:00"})
    assert r.status_code == 200 and r.json()["start_time"] == "12:30:00"
    # одно поле — сверяется с сохранённым концом (21:00)
    bad = await client.patch(f"/trips/{trip_id}/days/{day['id']}", headers=auth_headers,
                             json={"start_time": "22:00:00"})
    assert bad.status_code == 422 and bad.json()["detail"] == "day_time_order"


def test_lodging_gate_rules():
    """Не просили жильё — отели не ищем; просили без бюджета — спросить."""
    from app.services.meili.loop import lodging_gate

    assert "blocked" in lodging_gate(["куда сходить с девушкой?"], {"category": "hotel"})
    ask = lodging_gate(["и отель найди"], {"category": "hotel"})
    assert "ask_user" in ask
    assert lodging_gate(["отель до 11000 за ночь"], {"category": "hotel", "max_price": 11000}) is None
    # живой прогон: «а отель подбери» — модель сама придумала 3000–8000
    assert "ask_user" in lodging_gate(["а отель подбери"],
                                      {"category": "hotel", "min_price": 3000, "max_price": 8000})
    assert lodging_gate(["отель подбери", "до 11к за ночь"], {"category": "hotel", "max_price": 11000}) is None
    assert lodging_gate(["жильё от 5 тыс до 11 000"],
                        {"category": "hotel", "min_price": 5000, "max_price": 11000, }) is None


async def test_hotel_range_priced_first_expensive_on_top(client, auth_headers, sessions, monkeypatch):
    """Живой прогон: «отель до 11 000» — а в выдаче только 3000–5500: цену
    знали у горстки отелей. Известные в диапазоне — первыми, дороже — выше."""
    from app.services.meili.tools import search_places as sp

    queued = []

    async def fake_queue(db, category, lat, lon, radius):
        queued.append(category)
        return 0

    monkeypatch.setattr(sp, "queue_area_enrichment", fake_queue)
    prices = {"Бонжур": 3000, "Брайтон": 5500, "Арбат Хаус": 9800, "Four Seasons": 50000, "Хостел": 900}
    async with sessions() as db:
        for i, (name, price) in enumerate(prices.items()):
            pid = await _place(client, auth_headers, name, "hotel", dlat=i / 1000)
            await db.execute(update(Place).where(Place.id == pid).values(
                lodging_price_from=Decimal(price), price_currency="RUB"))
        await _place(client, auth_headers, "Без цены", "hotel", dlat=0.009)
        await db.commit()
    group = GroupCtx(adults=2, currency="RUB", nights=1)
    async with sessions() as db:
        res = await search_places(db, datetime(2026, 10, 17, 19), query="отель", category="hotel",
                                  near={"lat": MOSCOW[0], "lon": MOSCOW[1]}, radius=3000,
                                  max_price=11000, min_price=3000, group=group)
    names = [r["name"] for r in res]
    assert names[:3] == ["Арбат Хаус", "Брайтон", "Бонжур"]   # дороже — выше
    assert "Four Seasons" not in names and "Хостел" not in names  # вне диапазона
    assert names[-1] == "Без цены"                                # неизвестная — в хвост
    assert queued == ["hotel"]                                    # цены района — фоном
