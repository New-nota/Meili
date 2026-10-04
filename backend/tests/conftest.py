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
    единый .env, и если там задан SMTP_HOST, каждая тестовая регистрация
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


@pytest.fixture(autouse=True)
def _no_real_llm(monkeypatch):
    """Тесты не зависят от LLM_API_KEY в .env разработчика и не ходят в
    настоящую (платную) модель. Ревью «с нуля»: на чистом клоне без ключа
    test_rate_limit_is_reported_distinctly падал 501 — он молча опирался на
    ключ из .env. Нужен «настроенный» ассистент — задай ключ в тесте явно."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "LLM_API_KEY", None)


@pytest.fixture(autouse=True)
def _no_real_celery(monkeypatch):
    """Тесты не ставят задачи в живую очередь. Ревью: брокер (Redis) общий с
    dev-стеком — после прогона pytest живой воркер получал summarize по ID
    тестовых диалогов из чужой базы. Постановка перехвачена; нужен факт
    постановки — смотри список enqueued в тесте."""
    from app.services.meili import loop

    enqueued: list = []
    monkeypatch.setattr(loop, "_schedule_summarize", lambda cid: enqueued.append(cid))
    return enqueued


@pytest.fixture(autouse=True)
def _no_real_valhalla(monkeypatch):
    """Тесты не ходят в Valhalla. CI нашёл: test_apply_creates_trip_stops_atomically
    проходил только с живой Valhalla, а локальная проверка «без Valhalla»
    обманывала — матрицу отдавал общий с dev Redis-кэш. Подмена — по прямой:
    ~1,3 м/с пешком, длина в км; линии маршрута пустые.
    Нужна настоящая cached_post — верни её в тесте явно."""
    from app.services import optimizer, valhalla
    from app.services.places.geo import haversine_m

    def secs(a, b):
        return int(haversine_m(a["lat"], a["lon"], b["lat"], b["lon"]) / 1.3)

    async def fake_cached_post(action, body, slim=None):
        if action == "sources_to_targets":
            src = body["sources"]
            return {"sources_to_targets": [[{"time": secs(a, b)} for b in src] for a in src]}
        if action == "route":
            locs = body["locations"]
            return {"trip": {"legs": [
                {"summary": {"time": secs(a, b),
                             "length": haversine_m(a["lat"], a["lon"], b["lat"], b["lon"]) / 1000},
                 "shape": ""}
                for a, b in zip(locs, locs[1:])
            ]}}
        raise AssertionError(f"неожиданный вызов Valhalla: {action}")

    monkeypatch.setattr(valhalla, "cached_post", fake_cached_post)
    monkeypatch.setattr(optimizer, "cached_post", fake_cached_post)
