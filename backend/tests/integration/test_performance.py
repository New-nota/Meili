"""Ревью (профиль): регрессии производительности, которые тесты на
корректность не ловят.

- N+1: GET /trips/{id} и /days делали по два SQL-запроса на КАЖДЫЙ день —
  поездка на 10 дней открывалась 27 запросами. Число запросов не должно
  зависеть от числа дней.
- GET /places/ без лимита отдавал весь каталог (19,5 тыс. мест, 8 МБ).
"""
from contextlib import contextmanager
from datetime import date, timedelta

from sqlalchemy import event
from sqlalchemy.engine import Engine

from tests.integration.conftest import D1


@contextmanager
def count_sql():
    box = {"n": 0}

    def _count(*a, **kw):
        box["n"] += 1

    event.listen(Engine, "before_cursor_execute", _count)
    try:
        yield box
    finally:
        event.remove(Engine, "before_cursor_execute", _count)


async def _trip_with_days(client, headers, n_days: int) -> str:
    end = (date.fromisoformat(D1) + timedelta(days=n_days - 1)).isoformat()
    trip = (await client.post("/trips/", json={"title": f"{n_days}d", "start_date": D1, "end_date": end},
                              headers=headers)).json()
    days = (await client.get(f"/trips/{trip['id']}/days", headers=headers)).json()
    for i, day in enumerate(days):
        place = (await client.post("/places/", json={"name": f"P{i}", "lat": 54.7 + i / 1000, "lon": 20.5},
                                   headers=headers)).json()
        await client.post(f"/trips/{trip['id']}/stops", json={"place_id": place["id"], "day_id": day["id"]},
                          headers=headers)
    return trip["id"]


async def test_trip_and_days_queries_do_not_grow_with_days(client, auth_headers):
    small = await _trip_with_days(client, auth_headers, 2)
    big = await _trip_with_days(client, auth_headers, 8)
    for path in ("/trips/{}", "/trips/{}/days"):
        counts = []
        for trip_id in (small, big):
            with count_sql() as box:
                r = await client.get(path.format(trip_id), headers=auth_headers)
            assert r.status_code == 200, r.text
            counts.append(box["n"])
        assert counts[0] == counts[1], f"{path}: N+1 по дням — {counts[0]} SQL на 2 дня, {counts[1]} на 8"


async def test_places_list_is_paginated(client, auth_headers):
    for i in range(7):
        await client.post("/places/", json={"name": f"Место {i}", "city": "Тестоград"}, headers=auth_headers)
    page = (await client.get("/places/?city=Тестоград&limit=3", headers=auth_headers)).json()
    rest = (await client.get("/places/?city=Тестоград&limit=3&offset=3", headers=auth_headers)).json()
    assert len(page) == 3 and len(rest) == 3
    assert not {p["id"] for p in page} & {p["id"] for p in rest}  # страницы не перекрываются
    r = await client.get("/places/?limit=100000", headers=auth_headers)
    assert r.status_code == 422  # потолок, а не «весь каталог»


async def test_meili_does_not_hold_db_connection_while_model_thinks(client, auth_headers, monkeypatch):
    """Ход Meili держал соединение из пула всё время генерации модели —
    десятки секунд; пятнадцать параллельных чатов выбирали пул целиком, и
    вставало всё API. Пока модель «думает», соединений у хода быть не должно."""
    from sqlalchemy import event as sa_event
    from sqlalchemy.pool import Pool

    from app.services.llm.base import LLMEvent
    from tests.integration.test_meili import _conversation, _stream_events, install_fake

    checked_out = {"n": 0}

    def _out(*a):
        checked_out["n"] += 1

    def _in(*a):
        checked_out["n"] -= 1

    seen_during_llm: list[int] = []
    fake = install_fake(monkeypatch, [])

    async def stream(messages, tools, model):
        seen_during_llm.append(checked_out["n"])
        for e in (LLMEvent(type="token", text="ок"), LLMEvent(type="end")):
            yield e

    fake.stream = stream
    conv_id = await _conversation(client, auth_headers)
    sa_event.listen(Pool, "checkout", _out)
    sa_event.listen(Pool, "checkin", _in)
    try:
        await _stream_events(client, auth_headers, conv_id)
    finally:
        sa_event.remove(Pool, "checkout", _out)
        sa_event.remove(Pool, "checkin", _in)
    assert seen_during_llm and all(n <= 0 for n in seen_during_llm), seen_during_llm
