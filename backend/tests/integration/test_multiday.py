"""S8 WP-3: мульти-день — генерация дней, локации, перенос стопов,
per-day оптимизация (Valhalla замокан)."""
from app.services import optimizer as optimizer_module


async def _make_trip(client, headers, **extra) -> dict:
    r = await client.post(
        "/trips/",
        json={"title": "Мульти-день", "city": "Калининград", **extra},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _add_location(client, headers, trip_id, name, lat, lon) -> dict:
    r = await client.post(
        f"/trips/{trip_id}/locations",
        json={"name": name, "lat": lat, "lon": lon},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


async def _make_place_and_stop(client, headers, trip_id, day_id, name, lat, lon) -> str:
    r = await client.post(
        "/places/", json={"name": name, "lat": lat, "lon": lon}, headers=headers
    )
    place_id = r.json()["id"]
    r = await client.post(
        f"/trips/{trip_id}/stops",
        json={"place_id": place_id, "day_id": day_id},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def test_days_generated_from_date_range(client, auth_headers):
    trip = await _make_trip(
        client, auth_headers, start_date="2026-08-01", end_date="2026-08-03"
    )
    r = await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)
    days = r.json()
    assert [d["date"] for d in days] == ["2026-08-01", "2026-08-02", "2026-08-03"]
    assert [d["day_index"] for d in days] == [0, 1, 2]
    assert all(d["start_time"] == "09:00:00" for d in days)  # дефолт


async def test_extend_range_adds_tail_days_with_start_from_prev_end(client, auth_headers):
    trip = await _make_trip(
        client, auth_headers, start_date="2026-08-01", end_date="2026-08-01"
    )
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    hotel = await _add_location(client, auth_headers, trip["id"], "Отель", 54.71, 20.51)

    # финиш дня 0 = отель
    r = await client.patch(
        f"/trips/{trip['id']}/days/{days[0]['id']}",
        json={"end_location_id": hotel["id"]},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    # расширяем диапазон -> день 1 создаётся со стартом = финиш дня 0
    r = await client.put(
        f"/trips/{trip['id']}", json={"end_date": "2026-08-02"}, headers=auth_headers
    )
    assert r.status_code == 200, r.text
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    assert len(days) == 2
    assert days[1]["start_location"]["id"] == hotel["id"]  # автоподстановка


async def test_same_location_not_duplicated(client, auth_headers):
    trip = await _make_trip(client, auth_headers)
    loc1 = await _add_location(client, auth_headers, trip["id"], "Отель", 54.71, 20.51)
    loc2 = await _add_location(client, auth_headers, trip["id"], "Отель", 54.71, 20.51)
    assert loc1["id"] == loc2["id"]  # повторный выбор того же отеля


async def test_shrink_range_with_stops_blocked_409(client, auth_headers):
    trip = await _make_trip(
        client, auth_headers, start_date="2026-08-01", end_date="2026-08-02"
    )
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    await _make_place_and_stop(
        client, auth_headers, trip["id"], days[1]["id"], "Собор", 54.7068, 20.5118
    )
    # пытаемся убрать день 2, в котором есть стоп
    r = await client.put(
        f"/trips/{trip['id']}", json={"end_date": "2026-08-01"}, headers=auth_headers
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "day_has_stops"


async def test_move_stop_between_days_updates_visit_date(client, auth_headers):
    trip = await _make_trip(
        client, auth_headers, start_date="2026-08-01", end_date="2026-08-02"
    )
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    stop_id = await _make_place_and_stop(
        client, auth_headers, trip["id"], days[0]["id"], "Музей", 54.7142, 20.4989
    )

    # стоп в дне 0, visit_date = дата дня 0
    r = await client.get(f"/trips/{trip['id']}/stops", headers=auth_headers)
    stop = next(s for s in r.json() if s["id"] == stop_id)
    assert stop["visit_date"] == "2026-08-01"

    # перенос в день 1 через PATCH
    r = await client.patch(
        f"/trips/{trip['id']}/stops/{stop_id}",
        json={"day_id": days[1]["id"]},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    moved = r.json()
    assert moved["day_id"] == days[1]["id"]
    assert moved["visit_date"] == "2026-08-02"  # зеркало даты нового дня


async def test_day_optimize_start_and_end_fixed(client, auth_headers, monkeypatch):
    """Оптимизация дня: путь от старта к финишу, депо не переставляются."""
    async def fake_matrix(locations, costing="pedestrian"):
        n = len(locations)
        return [[0 if i == j else abs(i - j) * 100 for j in range(n)] for i in range(n)]

    monkeypatch.setattr(optimizer_module, "get_time_matrix", fake_matrix)

    trip = await _make_trip(
        client, auth_headers, start_date="2026-08-01", end_date="2026-08-01"
    )
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    day = days[0]

    start = await _add_location(client, auth_headers, trip["id"], "Отель", 54.70, 20.45)
    end = await _add_location(client, auth_headers, trip["id"], "Вокзал", 54.74, 20.55)
    await client.patch(
        f"/trips/{trip['id']}/days/{day['id']}",
        json={"start_location_id": start["id"], "end_location_id": end["id"]},
        headers=auth_headers,
    )

    s1 = await _make_place_and_stop(client, auth_headers, trip["id"], day["id"], "A", 54.71, 20.47)
    s2 = await _make_place_and_stop(client, auth_headers, trip["id"], day["id"], "B", 54.72, 20.49)

    r = await client.post(
        f"/trips/{trip['id']}/days/{day['id']}/optimize",
        json={"mode": "full"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert sorted(body["ordered_stop_ids"]) == sorted([s1, s2])
    assert body["dropped_stop_ids"] == []


async def test_day_optimize_without_locations_400(client, auth_headers):
    trip = await _make_trip(
        client, auth_headers, start_date="2026-08-01", end_date="2026-08-01"
    )
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    await _make_place_and_stop(
        client, auth_headers, trip["id"], days[0]["id"], "X", 54.71, 20.47
    )
    r = await client.post(
        f"/trips/{trip['id']}/days/{days[0]['id']}/optimize",
        json={"mode": "full"},
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "day_locations_missing"


async def test_day_out_of_coverage_422(client, auth_headers, monkeypatch):
    async def fake_matrix(locations, costing="pedestrian"):
        n = len(locations)
        m = [[0 if i == j else 10 for j in range(n)] for i in range(n)]
        for j in range(1, n):
            m[0][j] = 9999  # старт никого не достигает (вне тайлов)
        return m

    monkeypatch.setattr(optimizer_module, "get_time_matrix", fake_matrix)

    trip = await _make_trip(
        client, auth_headers, start_date="2026-08-01", end_date="2026-08-01"
    )
    day = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()[0]
    # старт в Париже, финиш в Бордо — вне покрытия Калининграда
    start = await _add_location(client, auth_headers, trip["id"], "Париж", 48.85, 2.35)
    end = await _add_location(client, auth_headers, trip["id"], "Бордо", 44.84, -0.58)
    await client.patch(
        f"/trips/{trip['id']}/days/{day['id']}",
        json={"start_location_id": start["id"], "end_location_id": end["id"]},
        headers=auth_headers,
    )
    await _make_place_and_stop(client, auth_headers, trip["id"], day["id"], "Лувр", 48.86, 2.34)

    r = await client.post(
        f"/trips/{trip['id']}/days/{day['id']}/optimize",
        json={"mode": "full"},
        headers=auth_headers,
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "day_out_of_coverage"


async def test_delete_location_used_by_day_409(client, auth_headers):
    trip = await _make_trip(
        client, auth_headers, start_date="2026-08-01", end_date="2026-08-01"
    )
    day = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()[0]
    loc = await _add_location(client, auth_headers, trip["id"], "Отель", 54.71, 20.51)
    await client.patch(
        f"/trips/{trip['id']}/days/{day['id']}",
        json={"start_location_id": loc["id"]},
        headers=auth_headers,
    )
    r = await client.delete(
        f"/trips/{trip['id']}/locations/{loc['id']}", headers=auth_headers
    )
    assert r.status_code == 409
