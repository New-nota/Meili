"""S8 WP-4: selective TSP через API — бюджет, must-visit, возврат в full."""
from app.services import optimizer as optimizer_module


async def _fake_matrix_600(locations, costing="pedestrian"):
    n = len(locations)
    return [[0 if i == j else 600 for j in range(n)] for i in range(n)]


async def _setup_day_with_stops(client, headers, monkeypatch, durations):
    """Поездка с одним днём, локациями и стопами заданной длительности."""
    monkeypatch.setattr(optimizer_module, "get_time_matrix", _fake_matrix_600)

    r = await client.post(
        "/trips/",
        json={"title": "Selective", "start_date": "2026-08-01", "end_date": "2026-08-01"},
        headers=headers,
    )
    trip = r.json()
    day = (await client.get(f"/trips/{trip['id']}/days", headers=headers)).json()[0]

    start = await client.post(
        f"/trips/{trip['id']}/locations",
        json={"name": "Отель", "lat": 54.70, "lon": 20.45},
        headers=headers,
    )
    end = await client.post(
        f"/trips/{trip['id']}/locations",
        json={"name": "Вокзал", "lat": 54.74, "lon": 20.55},
        headers=headers,
    )
    await client.patch(
        f"/trips/{trip['id']}/days/{day['id']}",
        json={
            "start_location_id": start.json()["id"],
            "end_location_id": end.json()["id"],
        },
        headers=headers,
    )

    stop_ids = []
    for i, dur in enumerate(durations):
        p = await client.post(
            "/places/",
            json={"name": f"Место {i}", "lat": 54.71 + i * 0.01, "lon": 20.47},
            headers=headers,
        )
        s = await client.post(
            f"/trips/{trip['id']}/stops",
            json={"place_id": p.json()["id"], "day_id": day["id"], "duration_minutes": dur},
            headers=headers,
        )
        stop_ids.append(s.json()["id"])
    return trip["id"], day["id"], stop_ids


async def test_selective_fits_budget_and_marks_dropped(client, auth_headers, monkeypatch):
    # 3 стопа по 30 мин; дорога 10 мин; бюджет 60 мин вмещает один стоп
    trip_id, day_id, stop_ids = await _setup_day_with_stops(
        client, auth_headers, monkeypatch, [30, 30, 30]
    )
    r = await client.post(
        f"/trips/{trip_id}/days/{day_id}/optimize",
        json={"mode": "selective", "time_budget_minutes": 60},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["ordered_stop_ids"]) == 1
    assert len(body["dropped_stop_ids"]) == 2

    # исключённые помечены included_in_route=false
    stops = (await client.get(f"/trips/{trip_id}/stops", headers=auth_headers)).json()
    included = [s for s in stops if s["included_in_route"]]
    excluded = [s for s in stops if not s["included_in_route"]]
    assert len(included) == 1 and len(excluded) == 2


async def test_must_visit_always_in_route(client, auth_headers, monkeypatch):
    trip_id, day_id, stop_ids = await _setup_day_with_stops(
        client, auth_headers, monkeypatch, [30, 30, 30]
    )
    # второй стоп — обязательный
    r = await client.patch(
        f"/trips/{trip_id}/stops/{stop_ids[1]}",
        json={"priority": 2},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    r = await client.post(
        f"/trips/{trip_id}/days/{day_id}/optimize",
        json={"mode": "selective", "time_budget_minutes": 60},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert stop_ids[1] in r.json()["ordered_stop_ids"]


async def test_must_visit_over_budget_409_and_untouched(client, auth_headers, monkeypatch):
    trip_id, day_id, stop_ids = await _setup_day_with_stops(
        client, auth_headers, monkeypatch, [30, 30]
    )
    for sid in stop_ids:
        await client.patch(
            f"/trips/{trip_id}/stops/{sid}", json={"priority": 2}, headers=auth_headers
        )

    r = await client.post(
        f"/trips/{trip_id}/days/{day_id}/optimize",
        json={"mode": "selective", "time_budget_minutes": 45},
        headers=auth_headers,
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "must_visit_over_budget"

    # стопы не перезаписаны: все по-прежнему included
    stops = (await client.get(f"/trips/{trip_id}/stops", headers=auth_headers)).json()
    assert all(s["included_in_route"] for s in stops)


async def test_full_mode_returns_dropped_stops(client, auth_headers, monkeypatch):
    trip_id, day_id, _ = await _setup_day_with_stops(
        client, auth_headers, monkeypatch, [30, 30, 30]
    )
    # сначала селективный прогон выкидывает часть
    r = await client.post(
        f"/trips/{trip_id}/days/{day_id}/optimize",
        json={"mode": "selective", "time_budget_minutes": 60},
        headers=auth_headers,
    )
    assert len(r.json()["dropped_stop_ids"]) > 0

    # полный прогон возвращает всех в маршрут
    r = await client.post(
        f"/trips/{trip_id}/days/{day_id}/optimize",
        json={"mode": "full"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["dropped_stop_ids"] == []
    stops = (await client.get(f"/trips/{trip_id}/stops", headers=auth_headers)).json()
    assert all(s["included_in_route"] for s in stops)


async def test_selective_default_budget_is_day_length(client, auth_headers, monkeypatch):
    """Без time_budget_minutes бюджет = end_time - start_time (09:00–21:00 = 12ч)."""
    trip_id, day_id, _ = await _setup_day_with_stops(
        client, auth_headers, monkeypatch, [30, 30, 30]
    )
    r = await client.post(
        f"/trips/{trip_id}/days/{day_id}/optimize",
        json={"mode": "selective"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    # 12 часов хватает на всё — ничего не выброшено
    assert r.json()["dropped_stop_ids"] == []
