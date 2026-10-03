"""S14: регистрация по коду на почту — жёсткий гейт.

До verify юзера в БД нет (черновик в Redis), токены выдаёт только verify.
Код в тестах читается напрямую из pending-черновика (SMTP нет — письмо в лог).
"""
from app.core.redis import (
    MAX_CODE_ATTEMPTS,
    clear_register_quota,
    delete_pending_registration,
    get_pending_registration,
)


async def _register(client, email, password="secret123", name=None):
    """Регистрация с чистой квотой адреса.

    Квота /auth/register (ревью: троттл против спама письмами) живёт в Redis
    час и переживает TRUNCATE тестовой БД. Адреса здесь фиксированные и часто
    не подтверждаются, поэтому через несколько прогонов подряд они упирались
    в 429. Чистим точечно свой адрес — чужие ключи в общем Redis не трогаем.
    """
    await clear_register_quota(email)
    return await client.post(
        "/auth/register", json={"email": email, "password": password, "name": name}
    )


async def test_register_sends_code_but_no_tokens(client):
    email = "newbie@wanderown.dev"
    r = await _register(client, email, name="Новичок")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "code_sent"}
    assert "access_token" not in r.json()
    assert "refresh_token" not in r.headers.get("set-cookie", "")

    # юзера в БД ещё нет — логин невозможен
    r = await client.post(
        "/auth/login", json={"email": email, "password": "secret123"}
    )
    assert r.status_code == 401

    # черновик лежит в Redis с 6-значным кодом
    pending = await get_pending_registration(email)
    assert pending is not None
    assert len(pending["code"]) == 6
    await delete_pending_registration(email)  # Redis не truncate-ится — чистим


async def test_verify_creates_user_and_issues_tokens(client):
    email = "verified@wanderown.dev"
    await _register(client, email, name="Проверенный")
    code = (await get_pending_registration(email))["code"]

    r = await client.post("/auth/verify", json={"email": email, "code": code})
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]
    set_cookie = r.headers.get("set-cookie", "")
    assert "refresh_token=" in set_cookie
    assert "HttpOnly" in set_cookie

    # юзер настоящий: /users/me работает, черновик удалён
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    me = await client.get("/users/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == email
    assert me.json()["name"] == "Проверенный"
    assert await get_pending_registration(email) is None


async def test_verify_wrong_code_burns_after_max_attempts(client):
    email = "bruteforce@wanderown.dev"
    await _register(client, email)
    code = (await get_pending_registration(email))["code"]
    wrong = "000000" if code != "000000" else "111111"

    for _ in range(MAX_CODE_ATTEMPTS):
        r = await client.post("/auth/verify", json={"email": email, "code": wrong})
        assert r.status_code == 400
        assert r.json()["detail"] == "invalid_code"

    # попытки исчерпаны — даже верный код больше не принимается
    r = await client.post("/auth/verify", json={"email": email, "code": code})
    assert r.status_code == 400
    assert r.json()["detail"] == "too_many_attempts"
    await delete_pending_registration(email)


async def test_register_on_verified_email_gives_machine_code(client):
    email = "dup@wanderown.dev"
    await _register(client, email)
    code = (await get_pending_registration(email))["code"]
    await client.post("/auth/verify", json={"email": email, "code": code})

    r = await _register(client, email)
    assert r.status_code == 400
    assert r.json()["detail"] == "email_taken"  # код, текст локализует фронт


async def test_register_overwrites_pending_with_new_code(client):
    """Сквоттинг: повторный register на неподтверждённый email — не ошибка,
    а новый код (владелец почты перехватывает регистрацию)."""
    email = "squat@wanderown.dev"
    await _register(client, email, password="squatter123")
    first = (await get_pending_registration(email))["code"]

    await _register(client, email, password="owner-pass-456")
    pending = await get_pending_registration(email)
    # черновик перезаписан: код с высокой вероятностью другой, попытки сброшены
    assert pending["attempts"] == 0

    # подтверждается ПОСЛЕДНЯЯ регистрация — вход по её паролю
    r = await client.post("/auth/verify", json={"email": email, "code": pending["code"]})
    assert r.status_code == 200, r.text
    r = await client.post(
        "/auth/login", json={"email": email, "password": "owner-pass-456"}
    )
    assert r.status_code == 200
    assert first is not None  # первый код существовал (сам факт перезаписи)


async def test_verify_without_pending_400(client):
    r = await client.post(
        "/auth/verify", json={"email": "ghost@wanderown.dev", "code": "123456"}
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "no_pending_registration"


async def test_resend_regenerates_code_and_has_cooldown(client):
    from app.core.redis import redis_client

    email = "resender@wanderown.dev"
    # кулдаун переживает прогоны (Redis не truncate-ится) — чистим перед тестом
    await redis_client.delete(f"reg_cooldown:{email}")
    await _register(client, email)

    r = await client.post("/auth/resend-code", json={"email": email})
    assert r.status_code == 200, r.text
    # повторный resend сразу — кулдаун
    r = await client.post("/auth/resend-code", json={"email": email})
    assert r.status_code == 429
    assert r.json()["detail"] == "resend_cooldown"
    await delete_pending_registration(email)


async def test_register_short_password_422(client):
    r = await _register(client, "short@wanderown.dev", password="1234567")  # 7 < 8
    assert r.status_code == 422


async def test_email_is_case_insensitive_everywhere(client):
    """QA: «Mixed.Case@…» и «mixed.case@…» — один аккаунт: хранится в нижнем
    регистре, логин и повторная регистрация не зависят от регистра/пробелов."""
    from tests.integration.conftest import register_and_verify

    await register_and_verify(client, "Mixed.Case@WanderOwn.dev")
    r = await client.post(
        "/auth/login",
        json={"email": "  mixed.case@wanderown.dev ", "password": "secret123"},
    )
    assert r.status_code == 200, r.text
    me = await client.get(
        "/users/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"}
    )
    assert me.json()["email"] == "mixed.case@wanderown.dev"

    r = await _register(client, "MIXED.CASE@wanderown.dev")
    assert r.status_code == 400
    assert r.json()["detail"] == "email_taken"


async def test_register_blank_name_becomes_null_and_long_name_rejected(client):
    from tests.integration.conftest import register_and_verify

    headers = await register_and_verify(client, "blankname@wanderown.dev", name="   ")
    me = await client.get("/users/me", headers=headers)
    assert me.json()["name"] is None

    r = await _register(client, "longname@wanderown.dev", name="x" * 500)
    assert r.status_code == 422
