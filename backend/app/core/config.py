from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    REDIS_URL: str
    VALHALLA_URL: str
    # без дефолта: подписывать JWT предсказуемым ключом нельзя,
    # отсутствие SECRET_KEY в .env — ошибка запуска, и это правильно
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    DB_ECHO: bool = False

    # Наблюдаемость (S8 WP-0)
    LOG_LEVEL: str = "INFO"
    SENTRY_DSN: str | None = None  # включить на деплое

    # Cloudflare R2 — файловое хранилище (S9 WP-D); без ключей — 501
    R2_ENDPOINT: str | None = None
    R2_BUCKET: str | None = None
    R2_ACCESS_KEY: str | None = None
    R2_SECRET_KEY: str | None = None
    R2_PUBLIC_BASE_URL: str | None = None
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    # cookie refresh-токена (S8 WP-1); на деплое COOKIE_SECURE=true
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"

    # Email (S7): без SMTP_HOST письма пишутся в лог (dev-режим)
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    EMAIL_FROM: str = "noreply@meili.app"

    # Google OAuth2 (S7): без ключей эндпоинты отвечают 501
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    FRONTEND_URL: str = "http://localhost:5173"

    # AI-ассистент Meili (ТЗ-Meili §4). Объявлено ОДИН раз — правило 1.2.
    # Смена провайдера = смена LLM_PROVIDER: None в моделях означает
    # «точный pinned-ID из модуля провайдера» (services/llm/mistral.py|deepseek.py),
    # так что переключение — действительно одна env-переменная.
    # Прод — Mistral (ЕС-хостинг, GDPR); DeepSeek — запасной.
    LLM_PROVIDER: str = "mistral"          # 'mistral' | 'deepseek'
    LLM_MODEL_LOOP: str | None = None      # override pinned-ID агент-цикла
    LLM_MODEL_SUMMARY: str | None = None   # override pinned-ID суммаризации
    LLM_API_KEY: str | None = None         # без ключа /api/meili/... отвечает 501
    LLM_MAX_STEPS: int = 5
    LLM_STEP_TIMEOUT_S: int = 30           # молчание стрима, не общая длина шага
    # M5.3: токен-бюджет окна истории; превышение триггерит фоновую
    # суммаризацию (Celery) и обрезает окно при сборке контекста
    MEILI_WINDOW_TOKENS: int = 2000

    class Config:
        env_file = ".env"

settings = Settings()
