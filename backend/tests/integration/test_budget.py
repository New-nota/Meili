"""S9 WP-A: бюджет — расчёт, статьи, валюта, over_budget."""
from tests.integration.conftest import D1


async def _trip_with_day(client, headers) -> tuple[str, str]:
    r = await client.post(
        "/trips/",
        json={"title": "Бюджетная", "start_date": D1, "end_date": D1,
              "currency": "EUR"},
        headers=headers,
    )
    trip_id = r.json()["id"]
    day = (await client.get(f"/trips/{trip_id}/days", headers=headers)).json()[0]
    return trip_id, day["id"]


async def _add_stop(client, headers, trip_id, day_id, name, cost=None) -> str:
    p = await client.post(
        "/places/", json={"name": name, "lat": 54.71, "lon": 20.47}, headers=headers
    )
    s = await client.post(
        f"/trips/{trip_id}/stops",
        json={"place_id": p.json()["id"], "day_id": day_id},
        headers=headers,
    )
    stop_id = s.json()["id"]
    if cost is not None:
        await client.patch(
            f"/trips/{trip_id}/stops/{stop_id}",
            json={"estimated_cost": str(cost)},
            headers=headers,
        )
    return stop_id


async def test_budget_from_estimates_and_expenses(client, auth_headers):
    trip_id, day_id = await _trip_with_day(client, auth_headers)
    await client.patch(
        f"/trips/{trip_id}", json={"budget_total": "500.00"}, headers=auth_headers
    )
    await _add_stop(client, auth_headers, trip_id, day_id, "Музей", cost="25.50")
    r = await client.post(
        f"/trips/{trip_id}/expenses",
        json={"category": "lodging", "title": "Отель", "amount": "120.00",
              "day_id": day_id},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text

    budget = (await client.get(f"/trips/{trip_id}/budget", headers=auth_headers)).json()
    assert budget["currency"] == "EUR"
    assert budget["activities_total"] == "25.50"
    assert budget["expenses_total"] == "120.00"
    assert budget["planned_total"] == "145.50"
    assert budget["remaining"] == "354.50"
    assert budget["over_budget"] is False
    assert budget["per_category"]["activity"] == "25.50"
    assert budget["per_category"]["lodging"] == "120.00"
    assert budget["per_day"][day_id] == "145.50"


async def test_booked_stop_uses_booking_amount_not_estimate(client, auth_headers):
    trip_id, day_id = await _trip_with_day(client, auth_headers)
    stop_id = await _add_stop(client, auth_headers, trip_id, day_id, "Тур", cost="10.00")

    # бронь с фактической суммой 99.99
    b = await client.post(
        "/bookings/",
        json={"trip_stop_id": stop_id, "provider": "viator"},
        headers=auth_headers,
    )
    await client.post(
        f"/bookings/{b.json()['id']}/confirm",
        json={"external_id": "X-1", "amount": "99.99", "currency": "EUR"},
        headers=auth_headers,
    )

    budget = (await client.get(f"/trips/{trip_id}/budget", headers=auth_headers)).json()
    # в расчёт идёт факт из брони, а не оценка
    assert budget["activities_total"] == "99.99"
    assert budget["booked_total"] == "99.99"


async def test_expense_currency_mismatch_rejected(client, auth_headers):
    trip_id, _ = await _trip_with_day(client, auth_headers)
    r = await client.post(
        f"/trips/{trip_id}/expenses",
        json={"category": "food", "title": "Ужин", "amount": "30.00",
              "currency": "USD"},
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "expense_currency_mismatch"


async def test_over_budget_flag(client, auth_headers):
    trip_id, day_id = await _trip_with_day(client, auth_headers)
    await client.patch(
        f"/trips/{trip_id}", json={"budget_total": "50.00"}, headers=auth_headers
    )
    await client.post(
        f"/trips/{trip_id}/expenses",
        json={"category": "transport", "title": "Такси", "amount": "80.00"},
        headers=auth_headers,
    )
    budget = (await client.get(f"/trips/{trip_id}/budget", headers=auth_headers)).json()
    assert budget["over_budget"] is True
    assert budget["remaining"] == "-30.00"
    # расход без дня попадает в per_day.unassigned
    assert budget["per_day"]["unassigned"] == "80.00"


async def test_expense_update_and_delete(client, auth_headers):
    trip_id, _ = await _trip_with_day(client, auth_headers)
    r = await client.post(
        f"/trips/{trip_id}/expenses",
        json={"category": "other", "title": "Сувениры", "amount": "15.00"},
        headers=auth_headers,
    )
    expense_id = r.json()["id"]

    r = await client.patch(
        f"/trips/{trip_id}/expenses/{expense_id}",
        json={"amount": "20.00", "title": "Сувениры и открытки"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["amount"] == "20.00"

    r = await client.delete(
        f"/trips/{trip_id}/expenses/{expense_id}", headers=auth_headers
    )
    assert r.status_code == 204
    budget = (await client.get(f"/trips/{trip_id}/budget", headers=auth_headers)).json()
    assert budget["expenses_total"] == "0"


async def test_activity_category_not_allowed(client, auth_headers):
    """Категория 'activity' запрещена в статьях — активности из стопов."""
    trip_id, _ = await _trip_with_day(client, auth_headers)
    r = await client.post(
        f"/trips/{trip_id}/expenses",
        json={"category": "activity", "title": "Тур", "amount": "10.00"},
        headers=auth_headers,
    )
    assert r.status_code == 422  # Literal не пропускает
