"""S8 WP-1: refresh-токены — httpOnly cookie, ротация jti в Redis,
детект переиспользования, logout. Требует живой Redis (docker-стек)."""


async def _login(client, email="refresh_user@wanderown.dev"):
    await client.post(
        "/auth/register", json={"email": email, "password": "secret123"}
    )
    r = await client.post(
        "/auth/login", json={"email": email, "password": "secret123"}
    )
    assert r.status_code == 200, r.text
    return r


async def test_login_sets_httponly_refresh_cookie(client):
    r = await _login(client)
    set_cookie = r.headers.get("set-cookie", "")
    assert "refresh_token=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "Path=/auth" in set_cookie
    # и access в теле
    assert r.json()["access_token"]


async def test_refresh_rotates_token(client):
    await _login(client)
    old_cookie = client.cookies.get("refresh_token")

    r = await client.post("/auth/refresh")
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]

    new_cookie = client.cookies.get("refresh_token")
    assert new_cookie and new_cookie != old_cookie  # ротация произошла


async def test_reused_refresh_rejected_and_revokes_all(client):
    await _login(client)
    old_cookie = client.cookies.get("refresh_token")

    # легальная ротация
    r = await client.post("/auth/refresh")
    assert r.status_code == 200

    # подсовываем СТАРЫЙ (уже ротированный) refresh — атака повтором
    # (jar чистим, иначе в запрос уйдут обе cookie и сервер возьмёт новую)
    client.cookies.clear()
    client.cookies.set("refresh_token", old_cookie, domain="test", path="/auth")
    r = await client.post("/auth/refresh")
    assert r.status_code == 401

    # после детекта отозваны ВСЕ refresh: даже новый больше не работает
    r = await client.post("/auth/refresh")
    assert r.status_code == 401


async def test_logout_invalidates_refresh(client):
    await _login(client)
    r = await client.post("/auth/logout")
    assert r.status_code == 204

    # cookie стёрта сервером; но даже если бы клиент её сохранил —
    # jti отозван в Redis
    r = await client.post("/auth/refresh")
    assert r.status_code == 401


async def test_refresh_without_cookie_401(client):
    r = await client.post("/auth/refresh")
    assert r.status_code == 401


async def test_refresh_token_cannot_be_used_as_access(client):
    """refresh-JWT в Authorization не проходит как access (type-проверка)."""
    from app.core.security import create_refresh_token

    r = await _login(client)
    # сам эндпоинт работает с нормальным access
    access = r.json()["access_token"]
    ok = await client.get("/trips/", headers={"Authorization": f"Bearer {access}"})
    assert ok.status_code == 200

    refresh_jwt, _ = create_refresh_token("00000000-0000-0000-0000-000000000000")
    bad = await client.get(
        "/trips/", headers={"Authorization": f"Bearer {refresh_jwt}"}
    )
    assert bad.status_code == 401
