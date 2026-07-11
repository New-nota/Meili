"""S9 WP-B: экспорт PDF и ICS."""


async def _trip_with_stops(client, headers) -> str:
    r = await client.post(
        "/trips/",
        json={"title": "Kaliningrad Trip", "start_date": "2026-08-01",
              "end_date": "2026-08-01"},
        headers=headers,
    )
    trip_id = r.json()["id"]
    day = (await client.get(f"/trips/{trip_id}/days", headers=headers)).json()[0]

    for i, name in enumerate(["Собор", "Музей"]):
        p = await client.post(
            "/places/",
            json={"name": name, "lat": 54.70 + i * 0.01, "lon": 20.51,
                  "address": f"Адрес {i}"},
            headers=headers,
        )
        await client.post(
            f"/trips/{trip_id}/stops",
            json={"place_id": p.json()["id"], "day_id": day["id"],
                  "duration_minutes": 45},
            headers=headers,
        )
    return trip_id


async def test_pdf_export_returns_valid_pdf(client, auth_headers):
    trip_id = await _trip_with_stops(client, auth_headers)
    r = await client.get(f"/trips/{trip_id}/export/pdf", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    assert "attachment" in r.headers["content-disposition"]
    assert r.content.startswith(b"%PDF-")  # валидная сигнатура PDF
    assert len(r.content) > 1000  # непустой документ


async def test_ics_export_valid_calendar_with_timezone(client, auth_headers):
    trip_id = await _trip_with_stops(client, auth_headers)
    r = await client.get(f"/trips/{trip_id}/export/ics", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/calendar")
    text = r.text
    assert "BEGIN:VCALENDAR" in text and "END:VCALENDAR" in text
    assert text.count("BEGIN:VEVENT") == 2  # по событию на стоп
    assert "SUMMARY:Собор" in text
    # 09:00 Europe/Kaliningrad (UTC+2) -> 07:00Z: таймзона поездки учтена
    assert "DTSTART:20260801T070000Z" in text


async def test_export_skips_dropped_stops(client, auth_headers, monkeypatch):
    """Стопы с included_in_route=false не попадают в выгрузки."""
    from app.services import optimizer as optimizer_module

    async def fake_matrix(locations, costing="pedestrian"):
        n = len(locations)
        return [[0 if i == j else 600 for j in range(n)] for i in range(n)]

    monkeypatch.setattr(optimizer_module, "get_time_matrix", fake_matrix)

    trip_id = await _trip_with_stops(client, auth_headers)
    day = (await client.get(f"/trips/{trip_id}/days", headers=auth_headers)).json()[0]

    # локации + селективный прогон с крошечным бюджетом: один стоп вылетит
    start = await client.post(
        f"/trips/{trip_id}/locations",
        json={"name": "Отель", "lat": 54.69, "lon": 20.50},
        headers=auth_headers,
    )
    end = await client.post(
        f"/trips/{trip_id}/locations",
        json={"name": "Вокзал", "lat": 54.73, "lon": 20.52},
        headers=auth_headers,
    )
    await client.patch(
        f"/trips/{trip_id}/days/{day['id']}",
        json={"start_location_id": start.json()["id"],
              "end_location_id": end.json()["id"]},
        headers=auth_headers,
    )
    r = await client.post(
        f"/trips/{trip_id}/days/{day['id']}/optimize",
        json={"mode": "selective", "time_budget_minutes": 80},
        headers=auth_headers,
    )
    assert len(r.json()["dropped_stop_ids"]) == 1

    ics = (await client.get(f"/trips/{trip_id}/export/ics", headers=auth_headers)).text
    assert ics.count("BEGIN:VEVENT") == 1  # исключённый стоп не в календаре
