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
    # QA: запасные модели через запятую (None — цепочка провайдера, "" — без
    # запасных). Клиент сам уходит на следующую, если модель недоступна тарифу/
    # региону (403 tier_not_allowed, 429 c лимитом 0, 404).
    LLM_MODEL_FALLBACKS: str | None = None
    # QA: доступ к провайдеру через другой регион. LLM_BASE_URL — свой
    # обратный прокси вместо https://api.mistral.ai/v1; LLM_HTTP_PROXY —
    # http(s)://… или socks5://… прокси ТОЛЬКО для LLM-запросов (например,
    # ssh -D 1080 на сервер → socks5://host.docker.internal:1080)
    LLM_BASE_URL: str | None = None
    LLM_HTTP_PROXY: str | None = None
    # Ревью: было 5 и этого не хватало. Модель тратит по шагу на каждый поиск
    # (парки, рестораны, музеи, пляжи — уже четыре), упиралась в кап и
    # пересказывала маршрут текстом, так и не вызвав propose_plan.
    LLM_MAX_STEPS: int = 8
    # молчание стрима, не общая длина шага. Ревью: 30 с не хватало —
    # large-модель с набором инструментов и снапшотом поездки регулярно
    # думает дольше до ПЕРВОГО токена, и ход падал «ассистент недоступен»
    # на живом, работающем провайдере (llm_probe при этом отвечает мгновенно)
    LLM_STEP_TIMEOUT_S: int = 60
    # M5.3: токен-бюджет окна истории; превышение триггерит фоновую
    # суммаризацию (Celery) и обрезает окно при сборке контекста
    MEILI_WINDOW_TOKENS: int = 2000

    # Покрытие маршрутизатора: прямоугольники [south, west, north, east], где
    # у Valhalla есть тайлы. Регион больше не зашит в код — он там, где карты:
    # N городов = N прямоугольников, пусто = весь мир (планетные тайлы или
    # внешний API). В env — JSON: ROUTING_COVERAGE='[[54.3,19.6,55.35,23.05]]'
    ROUTING_COVERAGE: list[tuple[float, float, float, float]] = []
    # геокодер для бэкенда (город для Meili, координаты городов поездок);
    # публичный Nominatim требует User-Agent и ≤1 запроса/с — всё кэшируем
    NOMINATIM_URL: str = "https://nominatim.openstreetmap.org"

    class Config:
        env_file = ".env"

settings = Settings()
