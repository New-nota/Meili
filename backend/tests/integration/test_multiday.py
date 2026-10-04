"""S8 WP-3: мульти-день — генерация дней, локации, перенос стопов,
per-day оптимизация (Valhalla замокан)."""
from tests.integration.conftest import D1, D2, D3
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
        client, auth_headers, start_date=D1, end_date=D3
    )
    r = await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)
    days = r.json()
    assert [d["date"] for d in days] == [D1, D2, D3]
    assert [d["position"] for d in days] == [1, 2, 3]
    assert all(d["start_time"] == "09:00:00" for d in days)  # дефолт


async def test_extend_range_adds_tail_days_with_start_from_prev_end(client, auth_headers):
    trip = await _make_trip(
        client, auth_headers, start_date=D1, end_date=D1
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
        f"/trips/{trip['id']}", json={"end_date": D2}, headers=auth_headers
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
        client, auth_headers, start_date=D1, end_date=D2
    )
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    await _make_place_and_stop(
        client, auth_headers, trip["id"], days[1]["id"], "Собор", 54.7068, 20.5118
    )
    # пытаемся убрать день 2, в котором есть стоп
    r = await client.put(
        f"/trips/{trip['id']}", json={"end_date": D1}, headers=auth_headers
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "day_has_stops"


async def test_move_stop_between_days(client, auth_headers):
    """S16: дата стопа = дата его дня, отдельного visit_date больше нет."""
    trip = await _make_trip(
        client, auth_headers, start_date=D1, end_date=D2
    )
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    stop_id = await _make_place_and_stop(
        client, auth_headers, trip["id"], days[0]["id"], "Музей", 54.7142, 20.4989
    )

    r = await client.get(f"/trips/{trip['id']}/stops", headers=auth_headers)
    stop = next(s for s in r.json() if s["id"] == stop_id)
    assert stop["day_id"] == days[0]["id"]
    assert "visit_date" not in stop

    # перенос в день 2 через PATCH
    r = await client.patch(
        f"/trips/{trip['id']}/stops/{stop_id}",
        json={"day_id": days[1]["id"]},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["day_id"] == days[1]["id"]

    # стоп уехал в день 2 — дата берётся с него
    after = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    assert [s["id"] for s in after[0]["stops"]] == []
    assert [s["id"] for s in after[1]["stops"]] == [stop_id]
    assert after[1]["date"] == D2


async def test_day_optimize_start_and_end_fixed(client, auth_headers, monkeypatch):
    """Оптимизация дня: путь от старта к финишу, депо не переставляются."""
    async def fake_matrix(locations, costing="pedestrian"):
        n = len(locations)
        return [[0 if i == j else abs(i - j) * 100 for j in range(n)] for i in range(n)]

    monkeypatch.setattr(optimizer_module, "get_time_matrix", fake_matrix)

    trip = await _make_trip(
        client, auth_headers, start_date=D1, end_date=D1
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


async def test_day_optimize_without_locations_is_open_path(client, auth_headers, monkeypatch):
    """QA: без старта/финиша день оптимизируется как открытый путь (раньше 400
    day_locations_missing — кнопка «Оптимизировать» отказывала на ровном месте)."""
    calls = []

    async def fake_matrix(locations, costing="pedestrian"):
        calls.append(len(locations))
        # точки на прямой: X(0) — Y(1) — Z(2); выгодный путь X→Y→Z или Z→Y→X
        n = len(locations)
        return [[abs(i - j) * 100 for j in range(n)] for i in range(n)]

    monkeypatch.setattr(optimizer_module, "get_time_matrix", fake_matrix)
    trip = await _make_trip(
        client, auth_headers, start_date=D1, end_date=D1
    )
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    x = await _make_place_and_stop(client, auth_headers, trip["id"], days[0]["id"], "X", 54.71, 20.47)
    z = await _make_place_and_stop(client, auth_headers, trip["id"], days[0]["id"], "Z", 54.73, 20.49)
    y = await _make_place_and_stop(client, auth_headers, trip["id"], days[0]["id"], "Y", 54.72, 20.48)
    r = await client.post(
        f"/trips/{trip['id']}/days/{days[0]['id']}/optimize",
        json={"mode": "full"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    # в Valhalla ушли только реальные точки — виртуальные депо не запрашиваются
    assert calls == [3]
    order = r.json()["ordered_stop_ids"]
    # матрица построена в порядке позиций X, Z, Y -> «прямая» X(0) Z(1) Y(2)
    assert order in ([x, z, y], [y, z, x])
    stops = (await client.get(f"/trips/{trip['id']}/stops", headers=auth_headers)).json()
    assert sorted(s["position"] for s in stops) == [1, 2, 3]


async def test_day_out_of_coverage_422(client, auth_headers, monkeypatch, kaliningrad_coverage):
    async def fake_matrix(locations, costing="pedestrian"):
        n = len(locations)
        m = [[0 if i == j else 10 for j in range(n)] for i in range(n)]
        for j in range(1, n):
            m[0][j] = 9999  # старт никого не достигает (вне тайлов)
        return m

    monkeypatch.setattr(optimizer_module, "get_time_matrix", fake_matrix)

    trip = await _make_trip(
        client, auth_headers, start_date=D1, end_date=D1
    )
    day = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()[0]
    # старт в Париже, финиш в Бордо — вне покрытия (тайлы только области)
    start = await _add_location(client, auth_headers, trip["id"], "Париж", 48.85, 2.35)
    end = await _add_location(client, auth_headers, trip["id"], "Бордо", 44.84, -0.58)
    await client.patch(
        f"/trips/{trip['id']}/days/{day['id']}",
        json={"start_location_id": start["id"], "end_location_id": end["id"]},
        headers=auth_headers,
    )
    # QA: стоп вне области теперь не добавить вовсе (place_out_of_coverage),
    # поэтому сам стоп — в Калининграде, а вне покрытия остаются депо дня
    await _make_place_and_stop(client, auth_headers, trip["id"], day["id"], "Собор", 54.7065, 20.5110)

    r = await client.post(
        f"/trips/{trip['id']}/days/{day['id']}/optimize",
        json={"mode": "full"},
        headers=auth_headers,
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "day_out_of_coverage"


async def test_stop_outside_region_rejected_upfront(client, auth_headers, kaliningrad_coverage):
    """QA: место вне зоны тайлов ломало маршрут всего дня «на полпути» —
    теперь отказ сразу при добавлении. Зона — из ROUTING_COVERAGE."""
    trip = await _make_trip(client, auth_headers, start_date=D1, end_date=D1)
    day = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()[0]
    place = (await client.post(
        "/places/", json={"name": "Лувр", "lat": 48.86, "lon": 2.34}, headers=auth_headers
    )).json()
    r = await client.post(
        f"/trips/{trip['id']}/stops",
        json={"place_id": place["id"], "day_id": day["id"]}, headers=auth_headers,
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "place_out_of_coverage"


async def test_delete_location_used_by_day_409(client, auth_headers):
    trip = await _make_trip(
        client, auth_headers, start_date=D1, end_date=D1
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


async def test_reorder_days_rotates_content_keeping_calendar(client, auth_headers):
    """S16 §1.5: переставляется содержимое дней, даты остаются по возрастанию.

    День сохраняет идентичность (имя и стопы едут с ним), меняются только
    его position и date из отсортированного пула.
    """
    trip = await _make_trip(
        client, auth_headers, start_date=D1, end_date=D3
    )
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    # у каждого дня своё имя, время старта и стоп — чтобы отследить переезд
    times = ["08:00", "10:00", "12:00"]
    names = ["A", "B", "C"]
    for d, tm, nm in zip(days, times, names):
        await client.patch(
            f"/trips/{trip['id']}/days/{d['id']}",
            json={"start_time": tm, "title": f"День {nm}"}, headers=auth_headers,
        )
        await _make_place_and_stop(
            client, auth_headers, trip["id"], d["id"], nm, 54.71, 20.51
        )

    # тащим день C в начало: новый порядок [C, A, B]
    new_order = [days[2]["id"], days[0]["id"], days[1]["id"]]
    r = await client.post(
        f"/trips/{trip['id']}/days/reorder",
        json={"day_ids": new_order}, headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    # ответ — дни в новом порядке
    assert [d["title"] for d in r.json()] == ["День C", "День A", "День B"]

    after = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    # календарь не поехал: даты по возрастанию, позиции 1..3
    assert [d["date"] for d in after] == [D1, D2, D3]
    assert [d["position"] for d in after] == [1, 2, 3]
    # содержимое прокрутилось: C→08-01, A→08-02, B→08-03 (имя, стопы, время)
    assert [d["title"] for d in after] == ["День C", "День A", "День B"]
    assert [d["stops"][0]["place_name"] for d in after] == ["C", "A", "B"]
    assert [d["start_time"] for d in after] == ["12:00:00", "08:00:00", "10:00:00"]


async def test_reorder_days_rejects_non_permutation(client, auth_headers):
    trip = await _make_trip(
        client, auth_headers, start_date=D1, end_date=D2
    )
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    # не хватает одного дня -> 422, данные не меняются
    r = await client.post(
        f"/trips/{trip['id']}/days/reorder",
        json={"day_ids": [days[0]["id"]]}, headers=auth_headers,
    )
    assert r.status_code == 422, r.text
    after = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    assert [d["id"] for d in after] == [d["id"] for d in days]
    assert [d["position"] for d in after] == [1, 2]


async def test_rename_day_and_reset_to_default(client, auth_headers):
    """S16 §1.5: имя дня правится PATCH'ем, пустая строка сбрасывает в NULL."""
    trip = await _make_trip(
        client, auth_headers, start_date=D1, end_date=D1
    )
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    assert days[0]["title"] is None   # «День N» рисует фронт, в БД пусто

    r = await client.patch(
        f"/trips/{trip['id']}/days/{days[0]['id']}",
        json={"title": "Остров Канта"}, headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Остров Канта"

    # строка из пробелов = сброс к дефолтной подписи
    r = await client.patch(
        f"/trips/{trip['id']}/days/{days[0]['id']}",
        json={"title": "   "}, headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["title"] is None


async def test_rename_foreign_day_is_404(client, auth_headers):
    from tests.integration.conftest import register_and_verify

    trip = await _make_trip(
        client, auth_headers, start_date=D1, end_date=D1
    )
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    other = await register_and_verify(client, "day_thief@wanderown.dev")
    r = await client.patch(
        f"/trips/{trip['id']}/days/{days[0]['id']}",
        json={"title": "Моё теперь"}, headers=other,
    )
    assert r.status_code == 404
