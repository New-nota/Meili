"""Регистрация (без верификации почты — отложена)."""


async def test_register_returns_tokens_and_cookie(client):
    """Регистрация сразу логинит: access в теле, refresh в httpOnly cookie."""
    r = await client.post(
        "/auth/register",
        json={"email": "newbie@wanderown.dev", "password": "secret123",
              "name": "Новичок"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]
    set_cookie = r.headers.get("set-cookie", "")
    assert "refresh_token=" in set_cookie
    assert "HttpOnly" in set_cookie

    # выданный access сразу рабочий
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    me = await client.get("/users/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == "newbie@wanderown.dev"
    assert me.json()["name"] == "Новичок"


async def test_register_duplicate_email_machine_code(client):
    body = {"email": "dup@wanderown.dev", "password": "secret123"}
    assert (await client.post("/auth/register", json=body)).status_code == 200
    r = await client.post("/auth/register", json=body)
    assert r.status_code == 400
    assert r.json()["detail"] == "email_taken"  # код, текст локализует фронт


async def test_register_short_password_422(client):
    r = await client.post(
        "/auth/register",
        json={"email": "short@wanderown.dev", "password": "1234567"},  # 7 < 8
    )
    assert r.status_code == 422
