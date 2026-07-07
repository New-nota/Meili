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
