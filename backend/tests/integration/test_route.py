"""S16 §1.6: маршрут дня по перегонам (Valhalla замокан)."""
import pytest

from app.services import valhalla as valhalla_module
from tests.integration.conftest import D1


@pytest.fixture
def fake_valhalla(monkeypatch):
    """Вместо Valhalla — фейк: по одному legs на пару точек, costing в записи."""
    calls: list[tuple[int, str]] = []

    async def fake_call(points, costing):
        calls.append((len(points), costing))
        return [
            {"summary": {"time": 600, "length": 1.5}, "shape": f"shape-{costing}-{i}"}
            for i in range(len(points) - 1)
        ]

    monkeypatch.setattr(valhalla_module, "_route_call", fake_call)
    return calls


async def _trip_with_day(client, headers) -> tuple[str, str]:
    r = await client.post(
        "/trips/",
        json={"title": "Маршрутная", "start_date": D1, "end_date": D1},
        headers=headers,
    )
    trip_id = r.json()["id"]
    day_id = (await client.get(f"/trips/{trip_id}/days", headers=headers)).json()[0]["id"]
    return trip_id, day_id


async def _add_stop(client, headers, trip_id, day_id, name, lat, lon, transport=None):
    p = await client.post(
        "/places/", json={"name": name, "lat": lat, "lon": lon}, headers=headers
    )
    body = {"place_id": p.json()["id"], "day_id": day_id}
    if transport:
        body["transport_to_next"] = transport
    r = await client.post(f"/trips/{trip_id}/stops", json=body, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _set_depots(client, headers, trip_id, day_id):
    start = await client.post(
        f"/trips/{trip_id}/locations",
        json={"name": "Отель", "lat": 54.70, "lon": 20.45}, headers=headers,
    )
    end = await client.post(
        f"/trips/{trip_id}/locations",
        json={"name": "Вокзал", "lat": 54.74, "lon": 20.55}, headers=headers,
    )
    await client.patch(
        f"/trips/{trip_id}/days/{day_id}",
        json={"start_location_id": start.json()["id"],
              "end_location_id": end.json()["id"]},
        headers=headers,
    )


async def test_route_returns_leg_per_hop(client, auth_headers, fake_valhalla):
    """DoD: число legs = число остановок + 1 (старт дня + стопы + финиш)."""
    trip_id, day_id = await _trip_with_day(client, auth_headers)
    await _set_depots(client, auth_headers, trip_id, day_id)
    s1 = await _add_stop(client, auth_headers, trip_id, day_id, "A", 54.71, 20.47)
    s2 = await _add_stop(client, auth_headers, trip_id, day_id, "B", 54.72, 20.49)

    r = await client.get(
        f"/trips/{trip_id}/route", params={"day_id": day_id}, headers=auth_headers
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["day_id"] == day_id
    assert len(body["legs"]) == 3          # 2 остановки + 1
    # первый перегон — из депо (from_stop_id=None), последний — в депо
    assert body["legs"][0]["from_stop_id"] is None
    assert body["legs"][0]["to_stop_id"] == s1
    assert body["legs"][1]["from_stop_id"] == s1
    assert body["legs"][1]["to_stop_id"] == s2
    assert body["legs"][2]["to_stop_id"] is None
    # суммы = сумма перегонов; length в км -> метры
    assert body["total_duration_seconds"] == 1800
    assert body["total_distance_meters"] == 4500


async def test_route_uses_per_leg_costing(client, auth_headers, fake_valhalla):
    """Каждый перегон считается своим costing из transport_to_next источника."""
    trip_id, day_id = await _trip_with_day(client, auth_headers)
    await _set_depots(client, auth_headers, trip_id, day_id)
    await _add_stop(client, auth_headers, trip_id, day_id, "A", 54.71, 20.47,
                    transport="driving")
    await _add_stop(client, auth_headers, trip_id, day_id, "B", 54.72, 20.49,
                    transport="walking")

    r = await client.get(
        f"/trips/{trip_id}/route", params={"day_id": day_id}, headers=auth_headers
    )
    legs = r.json()["legs"]
    # наружу отдаём доменный режим, не costing Valhalla
    assert [l["costing"] for l in legs] == ["driving", "driving", "walking"]
    # соседние перегоны одного режима склеены в один запрос к Valhalla
    assert fake_valhalla == [(3, "auto"), (2, "pedestrian")]


async def test_route_for_foreign_trip_is_404(client, auth_headers, fake_valhalla):
    from tests.integration.conftest import register_and_verify

    trip_id, day_id = await _trip_with_day(client, auth_headers)
    other = await register_and_verify(client, "route_thief@wanderown.dev")
    r = await client.get(
        f"/trips/{trip_id}/route", params={"day_id": day_id}, headers=other
    )
    assert r.status_code == 404


async def test_trip_detail_returns_days_with_stops(client, auth_headers):
    """DoD §1.4: GET /trips/{id} -> days[] со стопами, отсортированными по position."""
    trip_id, day_id = await _trip_with_day(client, auth_headers)
    await _add_stop(client, auth_headers, trip_id, day_id, "Первый", 54.71, 20.47)
    await _add_stop(client, auth_headers, trip_id, day_id, "Второй", 54.72, 20.49)

    r = await client.get(f"/trips/{trip_id}", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [d["position"] for d in body["days"]] == [1]
    day = body["days"][0]
    assert [s["place_name"] for s in day["stops"]] == ["Первый", "Второй"]
    assert day["stops_count"] == 2
    assert body["stops_count"] == 2
    # S16: длительность есть всегда и помечена как подставленная
    assert day["stops"][0]["duration_minutes"] == 60
    assert day["stops"][0]["duration_is_custom"] is False
