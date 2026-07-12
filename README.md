# Meili

Планировщик путешествий: собери поездку по дням, оптимизируй маршрут каждого дня
с учётом часов работы мест, следи за бюджетом и выгружай итинерарий в PDF или
календарь. Регион MVP — Калининград (покрытие тайлов Valhalla).

> Проект ранее назывался WanderOwn / fastrip — при встрече старых имён в истории
> git или в БД (`wanderown_db`) это одно и то же приложение.

## Возможности

- **Мульти-день**: диапазон дат → дни поездки, у каждого свои точки старта и
  финиша (отели, вокзалы — переиспользуемая история локаций), стопы переносятся
  между днями.
- **Оптимизация маршрута** (OR-Tools + Valhalla): путь от старта дня к финишу
  с учётом часов работы (TSPTW) и длительности визитов; режим
  **«Максимум за время»** (prize-collecting TSP) — впихнуть максимум мест в
  бюджет времени, обязательные (must-visit) не выкидываются.
- **Бюджет**: лимит и валюта поездки, стоимость активностей на стопах (факт из
  брони важнее оценки), статьи жильё/транспорт/еда/прочее, живой пересчёт,
  разбивки по дням и категориям.
- **Бронирование** (deep-link): Viator / OpenTable / TheFork, подтверждение
  номера брони, e-mail-уведомление.
- **Экспорт**: PDF-итинерарий (WeasyPrint) и календарь `.ics` в таймзоне поездки.
- **Профиль**: аватар (Cloudflare R2), статистика, свои и понравившиеся
  маршруты, рекомендации (коллаборативная фильтрация).
- **i18n**: русский и английский полностью, de/fr/es — заготовки с фолбэком;
  переключение без перезагрузки.
- **Аутентификация**: JWT access в памяти + refresh в httpOnly cookie с ротацией
  jti в Redis; вход через Google (OAuth2).
- **PWA**, мобильная адаптация, дизайн-система на CSS-токенах с проводкой под
  тёмную тему.

## Стек

| Слой | Технологии |
|---|---|
| Backend | FastAPI · SQLAlchemy 2 (async) · PostgreSQL + PostGIS · Redis · Alembic |
| Маршруты | Valhalla (матрицы времён, полилинии) · OR-Tools (TSP/TSPTW/selective) |
| Frontend | Vite · React · TypeScript · MapLibre GL · TanStack Query · i18next |
| Данные мест | OpenStreetMap: Overpass (POI, сид), Nominatim (геокодинг) |
| Экспорт | WeasyPrint (PDF) · ics · Jinja2 |
| Файлы | Cloudflare R2 (S3-совместимое, boto3) |
| Наблюдаемость | structlog (JSON-логи, request-id) |

## Запуск

Нужны Docker и Node.js.

```bash
# 1. Конфиги (секреты не в git)
cp .env.example .env                    # креды Postgres для docker-compose
cp backend/.env.example backend/.env    # DATABASE_URL, SECRET_KEY и опции

# 2. Бэкенд-стек: Postgres+PostGIS, Redis, Valhalla, FastAPI
docker compose up -d --build

# 3. Миграции и сид реальных POI Калининграда (идемпотентен)
docker compose exec backend alembic upgrade head
docker compose exec backend python -m scripts.seed_places

# 4. Фронтенд
cd frontend && npm install && npm run dev
```

- Приложение: http://localhost:5173
- Swagger: http://localhost:8000/docs
- pgAdmin (опционально): `docker compose --profile tools up -d pgadmin` → :5050

### Опциональные интеграции (без них соответствующие фичи отвечают 501)

| Фича | Переменные в `backend/.env` |
|---|---|
| Вход через Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (redirect URI `http://localhost:8000/auth/google/callback`) |
| Аватары (R2) | `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_PUBLIC_BASE_URL` |
| Реальные письма | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` (иначе письма в лог) |

## Тесты

```bash
# backend: юнит + интеграционные (реальный Postgres, отдельная БД meili/wanderown_test)
docker compose exec backend python -m pytest        # 125 тестов

# frontend: юнит (vitest) и e2e (Playwright, нужен запущенный стек)
cd frontend
npm run test:unit                                    # 9 тестов
npm run test:e2e                                     # 7 сценариев
```

## Структура

```
backend/
  app/
    api/        # роутеры: auth, trips, days, stops, places, bookings,
                # budget, export, users, optimize, recommendations
    core/       # config, database, security (JWT), redis, logging
    models/     # SQLAlchemy: Trip, TripDay, TripLocation, TripStop,
                # TripExpense, Place, Booking, User, соц. связи
    schemas/    # Pydantic-схемы
    services/   # optimizer (OR-Tools), budget, booking, storage (R2),
                # export_pdf/ics, overpass, recommendations, email
    templates/  # Jinja2-шаблон PDF-итинерария
  migrations/   # Alembic (12 миграций)
  scripts/      # сид POI из Overpass
  tests/        # pytest: юнит + integration/
frontend/
  src/
    styles/tokens.css   # дизайн-токены Meili (светлая + черновая тёмная тема)
    i18n/               # словари ru/en/de/fr/es
    api/                # типизированные клиенты API
    components/         # DayCard, BudgetPanel, StopDetailPanel, Logo, DayPill…
    pages/              # Auth, Discover, TripPlanner, TripSettings, Profile
    utils/              # mapPoint (форматирование адресов), mapStyle («бумага»)
  e2e/                  # Playwright-сценарии
scripts/
  update_valhalla_tiles.sh  # ежемесячное обновление OSM-экстракта (cron)
```

## Дизайн-система

Все цвета интерфейса — CSS-токены из `frontend/src/styles/tokens.css`
(акцент-сиена `#B04A24`, тёплые «бумажные» поверхности). Тёмная тема
переключается атрибутом `data-theme="dark"` на `<html>` (значения черновые).
Карта — приглушённая подложка, насыщенным выделен только маршрут; в режиме
«Все дни» маршруты дней окрашены приглушённой палитрой `--day-1…6`.
Шрифт — Hanken Grotesk с табличными цифрами (суммы не прыгают при пересчёте).

## Статус

Спринты 1–10 завершены (см. PROGRESS). Не реализовано: деплой (решение об
инфраструктуре открыто), переводы de/fr/es, анимации, встроенное партнёрское
API бронирования (сейчас deep-link).
