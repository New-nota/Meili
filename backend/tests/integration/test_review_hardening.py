"""Регрессии код-ревью: дыры в авторизации, 500 вместо 4xx, доменные правила.

Каждый тест воспроизводит конкретный найденный баг — до правки он падал.
Именование по симптому, а не по ручке: понятно, что именно охраняем.
"""
from decimal import Decimal

from tests.integration.conftest import D1, D2, register_and_verify


async def _trip(client, headers, **extra) -> dict:
    body = {"title": "Ревью", "start_date": D1, "end_date": D2, "currency": "EUR"}
    body.update(extra)
    r = await client.post("/trips/", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def _place(client, headers, name="Музей", **extra) -> str:
    body = {"name": name, "lat": 54.71, "lon": 20.51}
    body.update(extra)
    r = await client.post("/places/", json=body, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# --- кривой путь: 422, а не 500 ----------------------------------------------

async def test_clone_with_non_uuid_path_is_422(client, auth_headers):
    """trip_id был `str` + UUID(...) руками — ValueError улетал 500-кой."""
    r = await client.post("/trips/not-a-uuid/clone", headers=auth_headers)
    assert r.status_code == 422, r.text


async def test_reorder_with_non_uuid_path_is_422(client, auth_headers):
    r = await client.post(
        "/trips/not-a-uuid/stops/reorder", json={"stop_ids": []}, headers=auth_headers
    )
    assert r.status_code == 422, r.text


async def test_nan_in_body_is_422_not_500(client, auth_headers):
    """json.loads принимает NaN, json.dumps его отдать не может: дефолтный
    обработчик валидации FastAPI клал вход в тело 422 и падал сам."""
    trip = await _trip(client, auth_headers)
    r = await client.post(
        f"/trips/{trip['id']}/locations",
        content=b'{"lat": NaN, "lon": NaN}',
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert r.status_code == 422, r.text
    assert r.json()["detail"][0]["loc"] == ["body", "lat"]


async def test_out_of_range_coordinates_rejected(client, auth_headers):
    trip = await _trip(client, auth_headers)
    r = await client.post(
        f"/trips/{trip['id']}/locations",
        json={"lat": 999, "lon": -4000},
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text


async def test_visited_unknown_place_is_404(client, auth_headers):
    """FK-констрейнт ронял INSERT — наружу уходило 500."""
    r = await client.post(
        "/places/00000000-0000-0000-0000-000000000000/visited",
        json={"rating": 5},
        headers=auth_headers,
    )
    assert r.status_code == 404, r.text


async def test_verify_with_non_ascii_code_is_422(client):
    """secrets.compare_digest падает TypeError на не-ASCII — публичная 500."""
    await client.post(
        "/auth/register",
        json={"email": "nonascii@wanderown.dev", "password": "secret123"},
    )
    r = await client.post(
        "/auth/verify", json={"email": "nonascii@wanderown.dev", "code": "ыыыыыы"}
    )
    assert r.status_code == 422, r.text


# --- авторизация --------------------------------------------------------------

async def test_place_edit_is_owner_only(client, auth_headers):
    """places — ОБЩИЙ каталог: чужие цены утекали в чужой бюджет."""
    place_id = await _place(client, auth_headers)
    other = await register_and_verify(client, "stranger@wanderown.dev")

    r = await client.patch(
        f"/places/{place_id}",
        json={"ticket_adult": "99999.00", "description": "PWNED"},
        headers=other,
    )
    assert r.status_code == 403, r.text

    mine = await client.patch(
        f"/places/{place_id}", json={"description": "свои правки"}, headers=auth_headers
    )
    assert mine.status_code == 200, mine.text


async def test_raw_valhalla_proxy_requires_auth(client):
    r = await client.post("/route/", json={"locations": [], "costing": "pedestrian"})
    assert r.status_code == 401, r.text


async def test_like_unknown_trip_is_404(client, auth_headers):
    """IntegrityError молча превращался в 204."""
    r = await client.post(
        "/trips/00000000-0000-0000-0000-000000000000/like", headers=auth_headers
    )
    assert r.status_code == 404, r.text


async def test_like_of_foreign_private_trip_is_404(client, auth_headers):
    """Приватный чужой маршрут копил likes_count, хотя лайкер его не видит."""
    trip = await _trip(client, auth_headers)
    other = await register_and_verify(client, "liker@wanderown.dev")
    r = await client.post(f"/trips/{trip['id']}/like", headers=other)
    assert r.status_code == 404, r.text


# --- валидация обновления поездки --------------------------------------------

async def test_trip_update_rejects_negative_group(client, auth_headers):
    trip = await _trip(client, auth_headers)
    r = await client.patch(
        f"/trips/{trip['id']}",
        json={"adults_count": -5, "children_count": -3},
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text


async def test_trip_update_rejects_oversized_currency(client, auth_headers):
    """varchar(3) в БД -> DataError -> 500."""
    trip = await _trip(client, auth_headers)
    r = await client.patch(
        f"/trips/{trip['id']}", json={"currency": "TOOLONG"}, headers=auth_headers
    )
    assert r.status_code == 422, r.text


async def test_trip_update_caps_day_count(client, auth_headers):
    """MAX_TRIP_DAYS жил только в TripCreate — PATCH генерил тысячи trip_days."""
    trip = await _trip(client, auth_headers)
    r = await client.patch(
        f"/trips/{trip['id']}",
        json={"start_date": D1, "end_date": "2099-01-01"},
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == "trip_too_long"

    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    assert len(days) == 2  # диапазон не поменялся


async def test_day_time_frame_must_be_ordered(client, auth_headers):
    """22:00–06:00 давало отрицательную длину дня и ломало селективный прогон."""
    trip = await _trip(client, auth_headers)
    day_id = (
        await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)
    ).json()[0]["id"]
    r = await client.patch(
        f"/trips/{trip['id']}/days/{day_id}",
        json={"start_time": "22:00:00", "end_time": "06:00:00"},
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text


# --- доменные правила ---------------------------------------------------------

async def test_booking_in_foreign_currency_is_rejected(client, auth_headers):
    """compute_budget складывал booking.amount как есть: 1000 JPY = 1000 EUR."""
    trip = await _trip(client, auth_headers)
    day_id = (
        await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)
    ).json()[0]["id"]
    place_id = await _place(client, auth_headers)
    stop = (await client.post(
        f"/trips/{trip['id']}/stops",
        json={"place_id": place_id, "day_id": day_id},
        headers=auth_headers,
    )).json()
    booking = (await client.post(
        "/bookings/",
        json={"trip_stop_id": stop["id"], "provider": "viator"},
        headers=auth_headers,
    )).json()

    r = await client.post(
        f"/bookings/{booking['id']}/confirm",
        json={"external_id": "X1", "amount": "1000.00", "currency": "JPY"},
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == "booking_currency_mismatch"

    budget = (await client.get(f"/trips/{trip['id']}/budget", headers=auth_headers)).json()
    assert Decimal(budget["booked_total"]) == 0

    ok = await client.post(
        f"/bookings/{booking['id']}/confirm",
        json={"external_id": "X1", "amount": "10.00", "currency": "EUR"},
        headers=auth_headers,
    )
    assert ok.status_code == 200, ok.text


async def test_reorder_numbers_positions_within_each_day(client, auth_headers):
    """Сквозная нумерация по всему списку ломала порядок сразу двух дней."""
    trip = await _trip(client, auth_headers)
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    stops = []
    for day, name in ((days[0], "A"), (days[0], "B"), (days[1], "C")):
        place_id = await _place(client, auth_headers, name=name)
        stops.append((await client.post(
            f"/trips/{trip['id']}/stops",
            json={"place_id": place_id, "day_id": day["id"]},
            headers=auth_headers,
        )).json())

    r = await client.post(
        f"/trips/{trip['id']}/stops/reorder",
        json={"stop_ids": [stops[1]["id"], stops[0]["id"], stops[2]["id"]]},
        headers=auth_headers,
    )
    assert r.status_code == 204, r.text

    by_id = {
        s["id"]: s
        for s in (await client.get(f"/trips/{trip['id']}/stops", headers=auth_headers)).json()
    }
    # QA: позиции 1-based — как у add_stop/remove_stop
    assert by_id[stops[1]["id"]]["position"] == 1   # B — первый в своём дне
    assert by_id[stops[0]["id"]]["position"] == 2   # A — второй
    # стоп ДРУГОГО дня не должен получить сквозную позицию 3
    assert by_id[stops[2]["id"]]["position"] == 1


async def test_reorder_partial_list_keeps_day_positions_unique(client, auth_headers):
    """QA: частичный список ([C, B] из A,B,C) оставлял A с дублем позиции."""
    trip = await _trip(client, auth_headers)
    days = (await client.get(f"/trips/{trip['id']}/days", headers=auth_headers)).json()
    ids = []
    for name in ("A", "B", "C"):
        place_id = await _place(client, auth_headers, name=name)
        ids.append((await client.post(
            f"/trips/{trip['id']}/stops",
            json={"place_id": place_id, "day_id": days[0]["id"]},
            headers=auth_headers,
        )).json()["id"])
    a, b, c = ids
    r = await client.post(
        f"/trips/{trip['id']}/stops/reorder",
        json={"stop_ids": [c, b, c]},  # дубль id тоже не должен ломать
        headers=auth_headers,
    )
    assert r.status_code == 204, r.text
    stops = (await client.get(f"/trips/{trip['id']}/stops", headers=auth_headers)).json()
    pos = {s["id"]: s["position"] for s in stops}
    assert [pos[c], pos[b], pos[a]] == [1, 2, 3]


# --- пароли -------------------------------------------------------------------

async def test_password_longer_than_bcrypt_limit_is_rejected(client):
    """bcrypt молча резал пароль на 72 байтах — юзер логинился огрызком."""
    r = await client.post(
        "/auth/register",
        json={"email": "longpw@wanderown.dev", "password": "A" * 100},
    )
    assert r.status_code == 422, r.text


async def test_register_is_rate_limited_per_email(client):
    """Публичная ручка слала письма и жгла CPU на bcrypt без ограничений.

    Троттл — квота на окно, а не кулдаун: перезапись черновика (S14, перехват
    регистрации владельцем почты) обязана остаться рабочей."""
    from app.core.redis import MAX_REGISTER_PER_WINDOW, clear_register_quota

    body = {"email": "flood@wanderown.dev", "password": "secret123"}
    # адрес тут намеренно не подтверждается, счётчик переживает тест
    await clear_register_quota(body["email"])
    for _ in range(MAX_REGISTER_PER_WINDOW):
        ok = await client.post("/auth/register", json=body)
        assert ok.status_code == 200, ok.text
    over = await client.post("/auth/register", json=body)
    assert over.status_code == 429, over.text
    assert over.json()["detail"] == "too_many_registrations"


async def test_liked_trip_can_still_be_deleted(client, auth_headers):
    """trip_likes.trip_id был без ON DELETE CASCADE: как только публичную
    поездку кто-то лайкал, владелец больше не мог её удалить (500)."""
    trip = await _trip(client, auth_headers, is_public=True)
    await client.patch(
        f"/trips/{trip['id']}", json={"is_public": True}, headers=auth_headers
    )
    liker = await register_and_verify(client, "cascade@wanderown.dev")
    like = await client.post(f"/trips/{trip['id']}/like", headers=liker)
    assert like.status_code == 204, like.text

    r = await client.delete(f"/trips/{trip['id']}", headers=auth_headers)
    assert r.status_code == 204, r.text
    gone = await client.get(f"/trips/{trip['id']}", headers=auth_headers)
    assert gone.status_code == 404
