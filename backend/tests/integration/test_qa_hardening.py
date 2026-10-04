"""QA-прогон: фаззинг всех ручек + ручное тестирование UI.

Каждый тест — класс падений, найденный злыми payload'ами (500 вместо 4xx)
или поломка сценария «на полпути». Чинилось общим правилом, поэтому и
проверяем по одному представителю на правило.
"""
from tests.integration.conftest import future_date, register_and_verify


async def _trip(client, headers, **extra) -> dict:
    body = {
        "title": "QA", "city": "Калининград",
        "start_date": future_date(5), "end_date": future_date(7),
        "currency": "RUB", **extra,
    }
    r = await client.post("/trips/", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def _stop(client, headers, trip_id, day_id, name="Собор") -> dict:
    place = (await client.post(
        "/places/", json={"name": name, "lat": 54.7, "lon": 20.5}, headers=headers
    )).json()
    r = await client.post(
        f"/trips/{trip_id}/stops",
        json={"place_id": place["id"], "day_id": day_id}, headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


# --- общий обработчик ошибок БД (main.py) -------------------------------------

async def test_nul_byte_in_any_string_is_422_not_500(client, auth_headers):
    r = await client.post(
        "/trips/", json={"title": "bad\u0000title", "city": "x"}, headers=auth_headers
    )
    assert r.status_code == 422, r.text
    r = await client.get("/places/", params={"city": "x\u0000"}, headers=auth_headers)
    assert r.status_code == 422, r.text
    r = await client.patch("/users/me", json={"name": "a\u0000b"}, headers=auth_headers)
    assert r.status_code == 422, r.text


# --- деньги / группа / время --------------------------------------------------

async def test_money_overflow_and_negative_rejected(client, auth_headers):
    for bad in ("1000000000000", "-5", "10.001"):
        r = await client.post(
            "/trips/", json={"title": "x", "budget_total": bad}, headers=auth_headers
        )
        assert r.status_code == 422, (bad, r.text)
    trip = await _trip(client, auth_headers)
    r = await client.post(
        f"/trips/{trip['id']}/expenses",
        json={"category": "food", "title": "x", "amount": "1e12"}, headers=auth_headers,
    )
    assert r.status_code == 422, r.text


async def test_group_size_capped(client, auth_headers):
    r = await client.post(
        "/trips/", json={"title": "x", "adults_count": 10**9}, headers=auth_headers
    )
    assert r.status_code == 422


async def test_aware_time_on_day_frame_is_accepted_as_wall_time(client, auth_headers):
    trip = await _trip(client, auth_headers)
    day = trip and (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()[0]
    r = await client.patch(
        f"/trips/{trip['id']}/days/{day['id']}",
        json={"start_time": "10:00+03:00", "end_time": "18:00:00"}, headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["start_time"] == "10:00:00"


# --- PATCH: явный null в NOT NULL ---------------------------------------------

async def test_explicit_null_in_not_null_fields_is_422(client, auth_headers):
    trip = await _trip(client, auth_headers)
    for field in ("title", "adults_count", "currency"):
        r = await client.patch(
            f"/trips/{trip['id']}", json={field: None}, headers=auth_headers
        )
        assert r.status_code == 422, (field, r.text)
    # а «не прислал» по-прежнему значит «не трогать»
    r = await client.patch(
        f"/trips/{trip['id']}", json={"description": "ok"}, headers=auth_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "QA"


async def test_children_ages_checked_against_final_state(client, auth_headers):
    trip = await _trip(client, auth_headers, children_count=1, children_ages=[7])
    r = await client.patch(
        f"/trips/{trip['id']}", json={"children_count": 3}, headers=auth_headers
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "children_ages_mismatch"
    r = await client.patch(
        f"/trips/{trip['id']}",
        json={"children_count": 2, "children_ages": [7, 3]}, headers=auth_headers,
    )
    assert r.status_code == 200, r.text


async def test_dates_cannot_be_erased_from_trip_with_days(client, auth_headers):
    trip = await _trip(client, auth_headers)
    r = await client.patch(
        f"/trips/{trip['id']}",
        json={"start_date": None, "end_date": None}, headers=auth_headers,
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "dates_required"


# --- перенос поездки на другие даты -------------------------------------------

async def test_shifting_trip_moves_days_with_their_stops(client, auth_headers):
    """Раньше «едем на неделю позже» = 409 day_has_stops на первом же дне."""
    trip = await _trip(client, auth_headers)  # D5..D7
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    first = await _stop(client, auth_headers, trip["id"], days[0]["id"], "Собор")
    last = await _stop(client, auth_headers, trip["id"], days[2]["id"], "Маяк")

    # та же длина, сдвиг на 1 день (с пересечением) и на 10 (без него)
    for shift in (6, 16):
        r = await client.patch(
            f"/trips/{trip['id']}",
            json={"start_date": future_date(shift), "end_date": future_date(shift + 2)},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        moved = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
        assert [d["date"] for d in moved] == [future_date(shift + i) for i in range(3)]
        assert [s["id"] for s in moved[0]["stops"]] == [first["id"]]
        assert [s["id"] for s in moved[2]["stops"]] == [last["id"]]


async def test_extending_trip_keeps_days_on_their_dates(client, auth_headers):
    trip = await _trip(client, auth_headers)  # D5..D7
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    stop = await _stop(client, auth_headers, trip["id"], days[0]["id"])
    r = await client.patch(
        f"/trips/{trip['id']}", json={"start_date": future_date(4)}, headers=auth_headers
    )
    assert r.status_code == 200, r.text
    after = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    assert len(after) == 4
    assert after[0]["stops"] == []                       # новый день в начале
    assert [s["id"] for s in after[1]["stops"]] == [stop["id"]]
    assert after[1]["date"] == future_date(5)


# --- владение -----------------------------------------------------------------

async def test_expense_cannot_be_moved_to_foreign_day(client, auth_headers):
    mine = await _trip(client, auth_headers)
    exp = (await client.post(
        f"/trips/{mine['id']}/expenses",
        json={"category": "food", "title": "x", "amount": "10"}, headers=auth_headers,
    )).json()
    other_headers = await register_and_verify(client, "qa.other@wanderown.dev")
    foreign = await _trip(client, other_headers)
    foreign_day = (await client.get(
        f"/trips/{foreign['id']}/days", headers=other_headers
    )).json()[0]
    r = await client.patch(
        f"/trips/{mine['id']}/expenses/{exp['id']}",
        json={"day_id": foreign_day["id"]}, headers=auth_headers,
    )
    assert r.status_code == 404, r.text


# --- экспорт .ics -------------------------------------------------------------

async def test_ics_chains_stops_instead_of_stacking_at_day_start(client, auth_headers, monkeypatch):
    """Раньше все стопы дня без visit_time стартовали в start_time дня."""
    from app.services import export_ics

    async def fake_legs(points):
        return [{"duration_seconds": 30 * 60} for _ in range(len(points) - 1)]

    monkeypatch.setattr(export_ics, "route_legs", fake_legs)
    trip = await _trip(client, auth_headers)
    day = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()[0]
    await _stop(client, auth_headers, trip["id"], day["id"], "A")   # 60 мин по умолчанию
    await _stop(client, auth_headers, trip["id"], day["id"], "B")
    r = await client.get(f"/trips/{trip['id']}/export/ics", headers=auth_headers)
    assert r.status_code == 200, r.text
    starts = sorted(
        line.split(":", 1)[1] for line in r.text.splitlines() if line.startswith("DTSTART")
    )
    # 09:00 Калининград = 07:00Z; второй: +60 мин визита +30 мин дороги
    assert [s[-7:] for s in starts] == ["070000Z", "083000Z"], starts


# --- смена пароля гасит чужие сессии ------------------------------------------

async def test_password_change_revokes_other_sessions_keeps_current(client):
    email = "qa.pwd@wanderown.dev"
    await register_and_verify(client, email)
    # «другое устройство»: отдельный логин, его кука
    r = await client.post("/auth/login", json={"email": email, "password": "secret123"})
    other_cookie = client.cookies.get("refresh_token")
    # «это устройство»
    r = await client.post("/auth/login", json={"email": email, "password": "secret123"})
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r = await client.post(
        "/users/me/password",
        json={"old_password": "secret123", "new_password": "newsecret123"},
        headers=headers,
    )
    assert r.status_code == 204, r.text
    # текущее устройство живо — получило свежую куку в ответе
    assert (await client.post("/auth/refresh")).status_code == 200
    # чужая сессия мертва
    client.cookies.clear()
    client.cookies.set("refresh_token", other_cookie, domain="test.local", path="/auth")
    assert (await client.post("/auth/refresh")).status_code == 401


async def test_login_bruteforce_throttled_per_email_and_ip(client):
    from app.core.redis import MAX_LOGIN_FAILS, clear_login_fails

    email = "qa.brute@wanderown.dev"
    await register_and_verify(client, email)
    await clear_login_fails(email, "127.0.0.1")
    for _ in range(MAX_LOGIN_FAILS):
        r = await client.post("/auth/login", json={"email": email, "password": "wrong-pass"})
        assert r.status_code == 401
    # дальше — 429 даже с ВЕРНЫМ паролем, пока окно не истекло
    r = await client.post("/auth/login", json={"email": email, "password": "secret123"})
    assert r.status_code == 429
    assert r.json()["detail"] == "too_many_login_attempts"
    await clear_login_fails(email, "127.0.0.1")
    r = await client.post("/auth/login", json={"email": email, "password": "secret123"})
    assert r.status_code == 200


async def test_public_preview_hides_author_private_locations(client, auth_headers):
    """QA: отели/дом автора публичной поездки отдавались любому юзеру через API."""
    trip = await _trip(client, auth_headers, start_address="Дом автора", start_lat=54.7, start_lon=20.5)
    day = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()[0]
    loc = (await client.post(
        f"/trips/{trip['id']}/locations",
        json={"name": "Отель автора", "lat": 54.71, "lon": 20.51}, headers=auth_headers,
    )).json()
    await client.patch(
        f"/trips/{trip['id']}/days/{day['id']}",
        json={"start_location_id": loc["id"]}, headers=auth_headers,
    )
    await client.patch(f"/trips/{trip['id']}", json={"is_public": True}, headers=auth_headers)

    viewer = await register_and_verify(client, "qa.viewer@wanderown.dev")
    detail = (await client.get(f"/trips/{trip['id']}", headers=viewer)).json()
    assert detail["start_address"] is None and detail["start_lat"] is None
    assert all(d["start_location"] is None for d in detail["days"])
    assert (await client.get(f"/trips/{trip['id']}/locations", headers=viewer)).json() == []
    days = (await client.get(f"/trips/{trip['id']}/days", headers=viewer)).json()
    assert days[0]["start_location"] is None
    # владелец по-прежнему видит всё
    own = (await client.get(f"/trips/{trip['id']}", headers=auth_headers)).json()
    assert own["start_address"] == "Дом автора"
    assert own["days"][0]["start_location"]["id"] == loc["id"]


async def test_parallel_add_stop_gets_distinct_positions(client, auth_headers):
    """QA: параллельные добавления в один день давали дубль position."""
    import asyncio

    trip = await _trip(client, auth_headers)
    day = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()[0]
    places = [
        (await client.post("/places/", json={"name": f"P{i}", "lat": 54.7, "lon": 20.5},
                           headers=auth_headers)).json()["id"]
        for i in range(5)
    ]
    rs = await asyncio.gather(*[
        client.post(f"/trips/{trip['id']}/stops",
                    json={"place_id": pid, "day_id": day["id"]}, headers=auth_headers)
        for pid in places
    ])
    assert all(r.status_code == 200 for r in rs), [r.text for r in rs]
    stops = (await client.get(f"/trips/{trip['id']}/stops", headers=auth_headers)).json()
    assert sorted(s["position"] for s in stops) == [1, 2, 3, 4, 5]


async def test_budget_skips_dropped_stops_unless_booked(client, auth_headers, monkeypatch):
    """QA: выкинутое оптимизацией место не входит в «Запланировано»."""
    from app.services import optimizer as optimizer_module

    async def fake_matrix(locations, costing="pedestrian"):
        return [[0] * len(locations) for _ in locations]

    monkeypatch.setattr(optimizer_module, "get_time_matrix", fake_matrix)
    trip = await _trip(client, auth_headers)
    day = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()[0]
    kept = await _stop(client, auth_headers, trip["id"], day["id"], "A")
    dropped = await _stop(client, auth_headers, trip["id"], day["id"], "B")
    for s, cost, minutes in ((kept, "100.00", 10), (dropped, "250.00", 300)):
        r = await client.patch(f"/trips/{trip['id']}/stops/{s['id']}",
                               json={"estimated_cost": cost, "duration_minutes": minutes},
                               headers=auth_headers)
        assert r.status_code == 200, r.text
    r = await client.post(
        f"/trips/{trip['id']}/days/{day['id']}/optimize",
        json={"mode": "selective", "time_budget_minutes": 60}, headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["dropped_stop_ids"] == [dropped["id"]]
    budget = (await client.get(f"/trips/{trip['id']}/budget", headers=auth_headers)).json()
    assert budget["planned_total"] == "100.00"
