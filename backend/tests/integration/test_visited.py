"""S15: отметка «посещено» — оценка 1–5 + комментарий, листинг, снятие."""


async def _make_place(client, headers, name="Музей") -> str:
    r = await client.post(
        "/places/", json={"name": name, "lat": 54.71, "lon": 20.51}, headers=headers
    )
    return r.json()["id"]


async def test_mark_visited_with_rating_and_comment(client, auth_headers):
    place_id = await _make_place(client, auth_headers)
    r = await client.post(
        f"/places/{place_id}/visited",
        json={"rating": 5, "comment": "Отличный музей"},
        headers=auth_headers,
    )
    assert r.status_code == 204, r.text

    listed = (await client.get("/users/me/visited-places", headers=auth_headers)).json()
    assert len(listed) == 1
    assert listed[0]["place_id"] == place_id
    assert listed[0]["rating"] == 5
    assert listed[0]["comment"] == "Отличный музей"


async def test_mark_visited_upsert_updates_rating(client, auth_headers):
    place_id = await _make_place(client, auth_headers)
    await client.post(
        f"/places/{place_id}/visited", json={"rating": 3}, headers=auth_headers
    )
    # повторная отметка обновляет, не плодит строки
    await client.post(
        f"/places/{place_id}/visited",
        json={"rating": 4, "comment": "Пересмотрел мнение"},
        headers=auth_headers,
    )
    listed = (await client.get("/users/me/visited-places", headers=auth_headers)).json()
    assert len(listed) == 1
    assert listed[0]["rating"] == 4
    assert listed[0]["comment"] == "Пересмотрел мнение"


async def test_visited_without_rating_is_just_a_mark(client, auth_headers):
    """Тоггл «✓ Посещено» без оценки — rating/comment остаются NULL, не 0."""
    place_id = await _make_place(client, auth_headers)
    r = await client.post(
        f"/places/{place_id}/visited", json={}, headers=auth_headers
    )
    assert r.status_code == 204
    listed = (await client.get("/users/me/visited-places", headers=auth_headers)).json()
    assert listed[0]["rating"] is None
    assert listed[0]["comment"] is None


async def test_unmark_visited(client, auth_headers):
    place_id = await _make_place(client, auth_headers)
    await client.post(
        f"/places/{place_id}/visited", json={"rating": 2}, headers=auth_headers
    )
    r = await client.delete(f"/places/{place_id}/visited", headers=auth_headers)
    assert r.status_code == 204
    listed = (await client.get("/users/me/visited-places", headers=auth_headers)).json()
    assert listed == []
    # повторное снятие — 404
    r = await client.delete(f"/places/{place_id}/visited", headers=auth_headers)
    assert r.status_code == 404


async def test_rating_out_of_range_422(client, auth_headers):
    place_id = await _make_place(client, auth_headers)
    r = await client.post(
        f"/places/{place_id}/visited", json={"rating": 6}, headers=auth_headers
    )
    assert r.status_code == 422
