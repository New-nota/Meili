"""meili_upgrade: жильё (set_lodging, кнопка «Жильё»), расходы в плане,
принудительный поиск по интенту."""
from app.services.llm.base import LLMEvent
from tests.integration.conftest import D1, D3
from tests.integration.test_meili import (
    _conversation, _freeze_plan, _stream_events, install_fake,
)


async def _trip(client, headers, start=D1, end=D3) -> str:
    r = await client.post("/trips/", json={"title": "Поездка", "start_date": start, "end_date": end},
                          headers=headers)
    return r.json()["id"]


async def _hotel(client, headers, name="Отель Балтика", lat=54.72, lon=20.51) -> str:
    r = await client.post("/places/", json={"name": name, "lat": lat, "lon": lon, "category": "hotel"},
                          headers=headers)
    return r.json()["id"]


async def test_apply_set_lodging_all_days_and_expense(client, auth_headers, monkeypatch):
    trip_id = await _trip(client, auth_headers)
    await _hotel(client, auth_headers)
    plan_args = {
        "actions": [
            # по имени — как add_stop, id найдёт система
            {"type": "set_lodging", "place_name": "Отель Балтика"},
            {"type": "add_expense", "category": "lodging", "title": "Отель, 3 ночи",
             "amount": "300.00", "currency": "EUR"},
        ],
        "summary": "Поселиться",
    }
    plan_id = await _freeze_plan(client, auth_headers, monkeypatch, plan_args, trip_id=trip_id)
    r = await client.post(f"/api/meili/plans/{plan_id}/apply", headers=auth_headers)
    assert r.status_code == 200, r.text

    days = (await client.get(f"/trips/{trip_id}/days", headers=auth_headers)).json()
    assert len(days) == 3
    assert {d["start_location"]["name"] for d in days} == {"Отель Балтика"}
    assert {d["end_location"]["id"] for d in days} == {days[0]["start_location"]["id"]}
    assert days[0]["start_location"]["kind"] == "lodging"
    expenses = (await client.get(f"/trips/{trip_id}/expenses", headers=auth_headers)).json()
    assert [(e["category"], e["amount"]) for e in expenses] == [("lodging", "300.00")]

    # повторное «Применить» — идемпотентно, без второй локации и расхода
    await client.post(f"/api/meili/plans/{plan_id}/apply", headers=auth_headers)
    locations = (await client.get(f"/trips/{trip_id}/locations", headers=auth_headers)).json()
    assert len(locations) == 1
    assert len((await client.get(f"/trips/{trip_id}/expenses", headers=auth_headers)).json()) == 1


async def test_apply_set_lodging_unknown_day_rolls_back(client, auth_headers, monkeypatch):
    trip_id = await _trip(client, auth_headers)
    place_id = await _hotel(client, auth_headers)
    plan_args = {
        "actions": [
            {"type": "add_expense", "category": "lodging", "title": "Отель",
             "amount": "100.00", "currency": "EUR"},
            {"type": "set_lodging", "place_id": place_id, "day_indexes": [0, 9]},
        ],
        "summary": "Поселиться",
    }
    plan_id = await _freeze_plan(client, auth_headers, monkeypatch, plan_args, trip_id=trip_id)
    r = await client.post(f"/api/meili/plans/{plan_id}/apply", headers=auth_headers)
    assert r.status_code == 400 and r.json()["detail"] == "day_not_found"
    # одна транзакция: расход из первого действия тоже откатился
    assert (await client.get(f"/trips/{trip_id}/expenses", headers=auth_headers)).json() == []


async def test_expense_currency_mismatch_is_400(client, auth_headers, monkeypatch):
    trip_id = await _trip(client, auth_headers)
    plan_args = {
        "actions": [{"type": "add_expense", "category": "lodging", "title": "Отель",
                     "amount": "100.00", "currency": "RUB"}],
        "summary": "x",
    }
    plan_id = await _freeze_plan(client, auth_headers, monkeypatch, plan_args, trip_id=trip_id)
    r = await client.post(f"/api/meili/plans/{plan_id}/apply", headers=auth_headers)
    assert r.status_code == 400 and r.json()["detail"] == "currency_mismatch"


async def test_lodging_button_sets_chosen_days(client, auth_headers):
    trip_id = await _trip(client, auth_headers)
    place_id = await _hotel(client, auth_headers)
    days = (await client.get(f"/trips/{trip_id}/days", headers=auth_headers)).json()

    r = await client.post(f"/trips/{trip_id}/lodging", headers=auth_headers,
                          json={"place_id": place_id, "day_ids": [days[1]["id"]], "role": "end"})
    assert r.status_code == 200, r.text
    after = (await client.get(f"/trips/{trip_id}/days", headers=auth_headers)).json()
    assert after[1]["end_location"]["name"] == "Отель Балтика"
    assert after[1]["start_location"] is None and after[0]["end_location"] is None

    # чужая поездка — 404, как у всех ручек поездки
    from tests.integration.conftest import register_and_verify
    other = await register_and_verify(client, "other_lodging@wanderown.dev")
    r = await client.post(f"/trips/{trip_id}/lodging", headers=other, json={"place_id": place_id})
    assert r.status_code in (403, 404)


async def test_lodging_out_of_coverage_is_422(client, auth_headers, kaliningrad_coverage):
    trip_id = await _trip(client, auth_headers)
    place_id = await _hotel(client, auth_headers, name="Hotel Paris", lat=48.86, lon=2.34)
    r = await client.post(f"/trips/{trip_id}/lodging", headers=auth_headers,
                          json={"place_id": place_id})
    assert r.status_code == 422 and r.json()["detail"] == "place_out_of_coverage"


async def test_place_request_forces_tool_on_first_step(client, auth_headers, monkeypatch):
    """«Найди отель» — первый шаг обязан вызвать tool; дальше модель свободна."""
    seen = []
    fake = install_fake(monkeypatch, [
        [LLMEvent(type="tool_call", name="search_places",
                  arguments={"query": "отель"}, id="c1"), LLMEvent(type="end")],
        [LLMEvent(type="token", text="вот"), LLMEvent(type="end")],
    ])
    original = fake.stream

    def spy(messages, tools, model, tool_choice="auto"):
        seen.append(tool_choice)
        return original(messages, tools, model, tool_choice)

    fake.stream = spy
    conv_id = await _conversation(client, auth_headers)
    await _stream_events(client, auth_headers, conv_id, "найди отель в Калининграде")
    assert seen == ["required", "auto"]

    seen.clear()
    install_fake(monkeypatch, [[LLMEvent(type="token", text="ок"), LLMEvent(type="end")]])
    fake2 = __import__("app.services.meili.loop", fromlist=["get_client"]).get_client()
    original2 = fake2.stream
    fake2.stream = lambda m, tools, model, tool_choice="auto": (
        seen.append(tool_choice) or original2(m, tools, model, tool_choice)
    )
    conv_id = await _conversation(client, auth_headers)
    await _stream_events(client, auth_headers, conv_id, "спасибо!")
    assert seen == ["auto"]
