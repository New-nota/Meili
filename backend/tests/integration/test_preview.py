"""S13: превью чужой поездки — ослабленное чтение (owner ИЛИ is_public),
liked_by_me, клон с сохранением дат/дней."""
from tests.integration.conftest import D1, D2


from tests.integration.conftest import register_and_verify


async def _register(client, email: str) -> dict:
    # S14: полный поток регистрации через код
    return await register_and_verify(client, email, name="U")


async def _public_trip_with_stop(client, headers) -> dict:
    r = await client.post(
        "/trips/",
        json={"title": "Публичная", "city": "Калининград",
              "start_date": D1, "end_date": D2},
        headers=headers,
    )
    trip = r.json()
    await client.patch(
        f"/trips/{trip['id']}", json={"is_public": True}, headers=headers
    )
    days = (await client.get(f"/trips/{trip['id']}/days", headers=headers)).json()
    p = await client.post(
        "/places/", json={"name": "Музей", "lat": 54.71, "lon": 20.51}, headers=headers
    )
    await client.post(
        f"/trips/{trip['id']}/stops",
        json={"place_id": p.json()["id"], "day_id": days[0]["id"]},
        headers=headers,
    )
    return trip


async def test_public_trip_readable_by_other(client, auth_headers):
    trip = await _public_trip_with_stop(client, auth_headers)
    other = await _register(client, "other@wanderown.dev")
    for path in ("", "/days", "/stops", "/locations"):
        r = await client.get(f"/trips/{trip['id']}{path}", headers=other)
        assert r.status_code == 200, f"{path}: {r.text}"


async def test_private_trip_not_readable_by_other(client, auth_headers):
    trip = (await client.post(
        "/trips/", json={"title": "Приват", "city": "Калининград"}, headers=auth_headers
    )).json()
    other = await _register(client, "other2@wanderown.dev")
    for path in ("", "/days", "/stops", "/locations"):
        r = await client.get(f"/trips/{trip['id']}{path}", headers=other)
        assert r.status_code == 404, f"{path}: {r.status_code}"


async def test_liked_by_me_reflects_state(client, auth_headers):
    trip = await _public_trip_with_stop(client, auth_headers)
    other = await _register(client, "liker@wanderown.dev")
    before = (await client.get(f"/trips/{trip['id']}", headers=other)).json()
    assert before["liked_by_me"] is False
    await client.post(f"/trips/{trip['id']}/like", headers=other)
    after = (await client.get(f"/trips/{trip['id']}", headers=other)).json()
    assert after["liked_by_me"] is True


async def test_clone_preserves_dates_and_maps_stops_to_days(client, auth_headers):
    trip = await _public_trip_with_stop(client, auth_headers)  # 2 дня, стоп в дне 0
    other = await _register(client, "cloner@wanderown.dev")
    r = await client.post(f"/trips/{trip['id']}/clone", headers=other)
    assert r.status_code == 200, r.text
    clone = r.json()
    assert clone["start_date"] == D1
    assert clone["end_date"] == D2
    days = (await client.get(f"/trips/{clone['id']}/days", headers=other)).json()
    assert [d["date"] for d in days] == [D1, D2]
    # стоп разложен по дню через visit_date
    assert len(days[0]["stops"]) == 1
    assert len(days[1]["stops"]) == 0
