"""Интеграционные тесты: реальный Postgres+PostGIS, отдельная БД wanderown_test.

Как это работает:
1. Один раз за сессию (sync, psycopg2): DROP/CREATE DATABASE wanderown_test,
   CREATE EXTENSION postgis, Base.metadata.create_all — схема из моделей.
2. На каждый тест: async-движок к тестовой БД, get_db в приложении
   подменяется через dependency_overrides, httpx-клиент ходит в ASGI напрямую.
3. После каждого теста — TRUNCATE всех таблиц (изоляция тестов).

Если Postgres недоступен (pytest запущен вне docker-стека) — весь пакет
integration аккуратно скипается.
"""
import os
from datetime import date, timedelta

import pytest
import pytest_asyncio


def future_date(days_ahead: int) -> str:
    """Дата в будущем (ISO).

    Даты в тестах ОБЯЗАНЫ быть относительными: TripCreate (S11) запрещает
    старт в прошлом, поэтому захардкоженный «2026-08-01» однажды протухает
    и роняет весь пакет.
    """
    return (date.today() + timedelta(days=days_ahead)).isoformat()


D1, D2, D3, D4 = future_date(1), future_date(2), future_date(3), future_date(4)

# та же БД-нода, что у приложения, но отдельная база
_APP_DB_URL = os.environ["DATABASE_URL"]  # postgresql+asyncpg://user:pass@host:port/db
_TEST_DB_NAME = "wanderown_test"
_ADMIN_SYNC_URL = _APP_DB_URL.replace("+asyncpg", "+psycopg2")
_TEST_ASYNC_URL = _APP_DB_URL.rsplit("/", 1)[0] + f"/{_TEST_DB_NAME}"
_TEST_SYNC_URL = _ADMIN_SYNC_URL.rsplit("/", 1)[0] + f"/{_TEST_DB_NAME}"


@pytest.fixture(scope="session")
def _test_database():
    """Создать чистую тестовую БД со схемой из моделей (sync, один раз)."""
    from sqlalchemy import create_engine, text

    try:
        admin_engine = create_engine(_ADMIN_SYNC_URL, isolation_level="AUTOCOMMIT")
        with admin_engine.connect() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS {_TEST_DB_NAME} WITH (FORCE)"))
            conn.execute(text(f"CREATE DATABASE {_TEST_DB_NAME}"))
        admin_engine.dispose()
    except Exception as e:  # noqa: BLE001 — любой сбой коннекта = скип пакета
        pytest.skip(f"Postgres недоступен, интеграционные тесты пропущены: {e}")

    from app.core.database import Base
    import app.models  # noqa: F401 — регистрирует все таблицы в metadata

    test_engine = create_engine(_TEST_SYNC_URL)
    with test_engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        # pg_trgm: поиск мест ищет по словоформам (word_similarity). Схема тут
        # собирается из моделей, а не миграциями, поэтому расширения ставим сами
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        conn.commit()
    Base.metadata.create_all(bind=test_engine)
    test_engine.dispose()
    yield


@pytest_asyncio.fixture
async def client(_test_database):
    """httpx-клиент к приложению с подменённой БД + очистка таблиц после теста."""
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.core.database import Base, get_db
    from app.main import app

    engine = create_async_engine(_TEST_ASYNC_URL)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_db, None)
        # изоляция: чистим все таблицы моделей между тестами
        async with engine.begin() as conn:
            tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
            await conn.execute(text(f"TRUNCATE {tables} CASCADE"))
        await engine.dispose()
        # у каждого теста свой event loop, а redis_client глобальный:
        # рвём соединения пула, иначе следующий тест получит соединение,
        # привязанное к уже закрытому loop'у ("Event loop is closed")
        from app.core.redis import redis_client
        await redis_client.connection_pool.disconnect()


async def register_and_verify(
    client, email: str, password: str = "secret123", name: str | None = "IT"
) -> dict:
    """S14: полный поток регистрации — register → код из Redis → verify.

    Возвращает Bearer-заголовки. Код читаем напрямую из pending-черновика
    (SMTP в тестах нет — письмо ушло бы в лог).

    Квоту /auth/register снимаем явно: Redis общий с dev-приложением и
    TRUNCATE тестовой БД его не чистит, поэтому счётчик от прошлого прогона
    иначе роняет фикстуру 429-й. Точечно и только по своему адресу —
    чужие ключи в общем Redis не трогаем."""
    from app.core.redis import clear_register_quota, get_pending_registration

    await clear_register_quota(email)
    r = await client.post(
        "/auth/register",
        json={"email": email, "password": password, "name": name},
    )
    assert r.status_code == 200, r.text
    pending = await get_pending_registration(email)
    assert pending is not None
    r = await client.post(
        "/auth/verify", json={"email": email, "code": pending["code"]}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def auth_headers(client):
    """Зарегистрированный (и подтверждённый — S14) пользователь + Bearer."""
    return await register_and_verify(client, "it_user@wanderown.dev")
