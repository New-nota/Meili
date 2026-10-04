"""Общая настройка тестов.

Здесь мы выставляем переменные окружения ДО того, как импортируется код
приложения. `app.core.config.Settings` требует DATABASE_URL / REDIS_URL /
VALHALLA_URL, а `database.py` создаёт async-engine на этапе импорта — без этих
переменных любой `from app...` упадёт ещё на этапе сборки тестов.

Юнит-тесты в этом наборе НЕ подключаются к Postgres/Redis/Valhalla — они
проверяют чистую логику. URL-ы ниже валидны как строки, но реальные соединения
не открываются (SQLAlchemy/redis подключаются лениво).
"""
import os

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://test:test@localhost:5432/test_db",
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("VALHALLA_URL", "http://localhost:8002")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-pytest")
os.environ.setdefault("ALGORITHM", "HS256")
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "15")


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _no_real_smtp(monkeypatch):
    """QA: тесты не шлют настоящих писем. Внутри контейнера settings читает
    backend/.env, и если там задан SMTP_HOST, каждая тестовая регистрация
    фоном стучалась в боевой SMTP (на адреса @wanderown.dev). Тестам, которым
    нужна prod-ветка email, SMTP_HOST подставляют явно через patch."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "SMTP_HOST", "")


@pytest.fixture(autouse=True)
def _no_real_geo(monkeypatch):
    """Тесты не ходят в Nominatim/Overpass и не зависят от env покрытия.

    - покрытие маршрутов: весь мир (в контейнере ROUTING_COVERAGE задаёт
      compose — тест не должен от этого меняться);
    - геокодер города: «не знаю такого города» (как будто сети нет) —
      города в тестах узнаются по каталогу, как и раньше по справочнику;
    - автозаполнение каталога: no-op (оно пишет своей сессией в боевую БД
      и метки в общий с dev Redis). Тесты каталога подменяют это явно.
    """
    from app.core.config import settings
    from app.services.meili.tools import search_places as search_module
    from app.services.places import catalog

    async def no_city(name):
        return None

    async def no_fill(city):
        return 0

    monkeypatch.setattr(settings, "ROUTING_COVERAGE", [])
    monkeypatch.setattr(catalog, "geocode_city", no_city)
    monkeypatch.setattr(search_module, "ensure_city_catalog", no_fill)


@pytest.fixture
def kaliningrad_coverage(monkeypatch):
    """Тайлы только Калининградской области — как в локальном compose."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "ROUTING_COVERAGE", [(54.30, 19.60, 55.35, 23.05)])
