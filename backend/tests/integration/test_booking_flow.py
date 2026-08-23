"""Sprint 6 end-to-end (API + реальный Postgres): регистрация → поездка →
место (PostGIS) → остановка → бронь → подтверждение → отмена."""
from tests.integration.conftest import D1, D2


async def _make_trip_with_stop(client, headers) -> tuple[str, str]:
    """Поездка с одной остановкой, возвращает (trip_id, stop_id)."""
    r = await client.post(
        "/trips/",
        # S16: стоп живёт в дне, поэтому поездке нужны даты
        json={"title": "Тест-поездка", "city": "Калининград",
              "start_date": D1, "end_date": D1},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    trip_id = r.json()["id"]
    day_id = (await client.get(f"/trips/{trip_id}/days", headers=headers)).json()[0]["id"]

    r = await client.post(
        "/places/",
        json={
            "name": "Рыбная деревня",
            "city": "Калининград",
            "lat": 54.7083,
            "lon": 20.5145,
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    place = r.json()
    # PostGIS-координаты выжили round-trip
    assert abs(place["lat"] - 54.7083) < 1e-6
    assert abs(place["lon"] - 20.5145) < 1e-6

    r = await client.post(
        f"/trips/{trip_id}/stops",
        json={"place_id": place["id"], "day_id": day_id},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return trip_id, r.json()["id"]


async def test_full_booking_lifecycle(client, auth_headers):
    trip_id, stop_id = await _make_trip_with_stop(client, auth_headers)

    # 1. создать бронь -> pending + deep_link
    r = await client.post(
        "/bookings/",
        json={"trip_stop_id": stop_id, "provider": "viator", "visit_date": D1},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    booking = r.json()
    assert booking["status"] == "pending"
    assert booking["deep_link"].startswith("https://www.viator.com/")
    booking_id = booking["id"]

    # 2. бронь видна в списке
    r = await client.get("/bookings/", headers=auth_headers)
    assert [b["id"] for b in r.json()] == [booking_id]

    # 3. подтвердить -> confirmed, остановка помечена is_booked
    r = await client.post(
        f"/bookings/{booking_id}/confirm",
        json={"external_id": "VIA-42", "amount": "45.50", "currency": "eur"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    confirmed = r.json()
    assert confirmed["status"] == "confirmed"
    assert confirmed["external_id"] == "VIA-42"
    assert confirmed["currency"] == "EUR"  # нормализация к верхнему регистру

    r = await client.get(f"/trips/{trip_id}/stops", headers=auth_headers)
    stop = r.json()[0]
    assert stop["is_booked"] is True

    # 4. отменить -> cancelled, is_booked снят
    r = await client.post(f"/bookings/{booking_id}/cancel", headers=auth_headers)
    assert r.json()["status"] == "cancelled"

    r = await client.get(f"/trips/{trip_id}/stops", headers=auth_headers)
    assert r.json()[0]["is_booked"] is False

    # 5. подтвердить отменённую нельзя
    r = await client.post(
        f"/bookings/{booking_id}/confirm", json={}, headers=auth_headers
    )
    assert r.status_code == 400


async def test_unknown_provider_rejected(client, auth_headers):
    _, stop_id = await _make_trip_with_stop(client, auth_headers)
    r = await client.post(
        "/bookings/",
        json={"trip_stop_id": stop_id, "provider": "aviasales"},
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert "aviasales" in r.json()["detail"]


async def test_cannot_book_foreign_stop(client, auth_headers):
    """Чужую остановку забронировать нельзя (404, не утечка данных)."""
    _, stop_id = await _make_trip_with_stop(client, auth_headers)

    # второй пользователь (S14: полный поток регистрации через код)
    from tests.integration.conftest import register_and_verify
    intruder = await register_and_verify(client, "intruder@wanderown.dev")

    r = await client.post(
        "/bookings/",
        json={"trip_stop_id": stop_id, "provider": "viator"},
        headers=intruder,
    )
    assert r.status_code == 404


async def test_update_stop_transport_and_duration(client, auth_headers):
    """PUT /trips/{id}/stops/{id} — переключатель транспорта в UI (S16: три
    режима) + время на точке, которое взводит duration_is_custom."""
    trip_id, stop_id = await _make_trip_with_stop(client, auth_headers)

    r = await client.put(
        f"/trips/{trip_id}/stops/{stop_id}",
        json={"transport_to_next": "driving", "duration_minutes": 90},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["transport_to_next"] == "driving"
    assert updated["duration_minutes"] == 90
    assert updated["duration_is_custom"] is True  # «≈» в UI исчезает
    # частичное обновление не затёрло остальное
    assert updated["place_name"] == "Рыбная деревня"
    # регресс stop_to_dict: trip_id подменялся на place_id
    assert updated["trip_id"] == trip_id
    assert updated["trip_id"] != updated["place_id"]


async def test_unknown_transport_mode_rejected(client, auth_headers):
    """S16: режимов ровно три — велосипед из доменной модели ушёл."""
    trip_id, stop_id = await _make_trip_with_stop(client, auth_headers)
    r = await client.put(
        f"/trips/{trip_id}/stops/{stop_id}",
        json={"transport_to_next": "bicycle"},
        headers=auth_headers,
    )
    assert r.status_code == 422
