"""S9 WP-D: профиль пользователя — /users/me и подэндпоинты."""
import io


async def test_get_me_returns_profile_with_stats(client, auth_headers):
    r = await client.get("/users/me", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == "it_user@wanderown.dev"
    assert body["has_password"] is True
    assert body["stats"] == {
        "trips_count": 0,
        "visited_places_count": 0,
        "likes_given": 0,
        "likes_received": 0,
    }


async def test_patch_me_updates_profile(client, auth_headers):
    r = await client.patch(
        "/users/me",
        json={"name": "Ник", "home_city": "Калининград",
              "travel_style": ["culture", "food"]},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "Ник"
    assert body["home_city"] == "Калининград"
    assert body["travel_style"] == ["culture", "food"]
    # email менять нельзя — поля просто нет в UserProfileUpdate


async def test_avatar_upload_not_configured_501(client, auth_headers):
    """R2 не сконфигурирован в тестах: код storage_not_configured."""
    r = await client.post(
        "/users/me/avatar",
        files={"file": ("me.png", io.BytesIO(b"fake-png"), "image/png")},
        headers=auth_headers,
    )
    assert r.status_code == 501
    assert r.json()["detail"] == "storage_not_configured"


async def test_avatar_bad_type_rejected(client, auth_headers, monkeypatch):
    """Не-картинка отклоняется кодом avatar_bad_type (R2 замокан как настроенный)."""
    from app.services import storage

    monkeypatch.setattr(storage, "is_configured", lambda: True)
    r = await client.post(
        "/users/me/avatar",
        files={"file": ("doc.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "avatar_bad_type"


async def test_password_change_checks_old(client, auth_headers):
    # неверный старый пароль
    r = await client.post(
        "/users/me/password",
        json={"old_password": "wrong", "new_password": "newpass123"},
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "wrong_password"

    # верный старый — пароль реально меняется
    r = await client.post(
        "/users/me/password",
        json={"old_password": "secret123", "new_password": "newpass123"},
        headers=auth_headers,
    )
    assert r.status_code == 204
    r = await client.post(
        "/auth/login",
        json={"email": "it_user@wanderown.dev", "password": "newpass123"},
    )
    assert r.status_code == 200


async def test_my_trips_and_liked_trips(client, auth_headers):
    # своя поездка
    r = await client.post(
        "/trips/", json={"title": "Моя"}, headers=auth_headers
    )
    my_trip_id = r.json()["id"]

    # чужая публичная поездка + лайк (S14: регистрация через код)
    from tests.integration.conftest import register_and_verify
    other = await register_and_verify(client, "other@wanderown.dev")
    r = await client.post("/trips/", json={"title": "Чужая"}, headers=other)
    other_trip_id = r.json()["id"]
    await client.put(
        f"/trips/{other_trip_id}", json={"is_public": True}, headers=other
    )

    await client.post(f"/trips/{other_trip_id}/like", headers=auth_headers)

    r = await client.get("/users/me/trips", headers=auth_headers)
    assert [t["id"] for t in r.json()] == [my_trip_id]

    r = await client.get("/users/me/liked-trips", headers=auth_headers)
    assert [t["id"] for t in r.json()] == [other_trip_id]

    # статистика обновилась
    stats = (await client.get("/users/me", headers=auth_headers)).json()["stats"]
    assert stats["trips_count"] == 1
    assert stats["likes_given"] == 1
