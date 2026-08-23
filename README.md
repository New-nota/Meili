# Hermod

Планировщик путешествий: собери поездку по дням, оптимизируй маршрут каждого дня
с учётом часов работы мест, следи за бюджетом и выгружай итинерарий в PDF или
календарь. Регион MVP — Калининград (покрытие тайлов Valhalla).

**Hermod** — сервис; **Meili** — ИИ-ассистент внутри него.

> Проект ранее назывался Meili, а ещё раньше — WanderOwn / fastrip: старые имена
> в истории git, БД (`wanderown_db`) и бэкенд-коде ассистента — то же приложение.

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
- **Авто-оценка бюджета из цен мест**: место несёт цену (средний чек / билеты /
  бесплатно) → стоп считает сумму по группе → сумма втекает в «Запланировано».
  Ручная сумма (`manual`) авто-пересчётом не трогается, «вернуть авто» —
  пересчитывает; нет данных или чужая валюта → «цена не указана» (null, не 0).
  Триггеры: добавление стопа, смена группы/валюты, кнопка «обновить оценки».
- **AI-ассистент Meili** (чат в планировщике): обсуждаешь поездку — ассистент
  видит её актуальное состояние, ищет реальные места (часы работы и цены
  считает система, не модель) и предлагает **план** изменений. План — карточка
  с превью и виртуальным редактором; в БД пишет только кнопка «Применить»
  (детерминированный executor, одна транзакция, проверка владения). Стриминг
  ответов через SSE; история диалога сворачивается в фоне (Celery). Провайдер —
  Mistral (ЕС-хостинг), запасной DeepSeek — переключение одной env-переменной.
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
| Backend | FastAPI · SQLAlchemy 2 (async) · PostgreSQL + PostGIS · Redis · Alembic · Celery |
| AI-ассистент | Mistral Large 3 (дефолт) / DeepSeek (запасной) · SSE-стриминг · tool-calls |
| Маршруты | Valhalla (матрицы времён, полилинии) · OR-Tools (TSP/TSPTW/selective) |
| Frontend | Vite · React · TypeScript · MapLibre GL · TanStack Query · Zustand · i18next |
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

# 2. Бэкенд-стек: Postgres+PostGIS, Redis, Valhalla, FastAPI + Celery-воркер
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
| AI-ассистент Meili | `LLM_API_KEY` (ключ Mistral; `LLM_PROVIDER=deepseek` переключает на DeepSeek). Проба: `docker compose exec backend python -m scripts.llm_probe` |
| Вход через Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (redirect URI `http://localhost:8000/auth/google/callback`) |
| Аватары (R2) | `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_PUBLIC_BASE_URL` |
| Реальные письма | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` (иначе письма в лог) |

## Тесты

```bash
# backend: юнит + интеграционные (реальный Postgres, отдельная БД wanderown_test)
docker compose exec backend python -m pytest        # 203 теста

# frontend: юнит (vitest) и e2e (Playwright, нужен запущенный стек)
cd frontend
npm run test:unit                                    # 24 теста
npm run test:e2e                                     # 10 сценариев
```

## Структура

```
backend/
  app/
    api/        # роутеры: auth, trips, days, stops, places, bookings,
                # budget, export, users, optimize, recommendations,
                # meili (диалоги ассистента, SSE, планы)
    core/       # config, database, security (JWT), redis, logging
    models/     # SQLAlchemy: Trip, TripDay, TripLocation, TripStop,
                # TripExpense, Place, Booking, User, соц. связи,
                # Conversation, Message, MeiliPlan
    schemas/    # Pydantic-схемы (plan.py — граница LLM↔система)
    services/   # optimizer (OR-Tools), budget, budget_estimate, stops,
                # booking, storage (R2), export_pdf/ics, overpass,
                # recommendations, email; places/ (create + opening hours);
                # llm/ (Mistral/DeepSeek абстракция);
                # meili/ (loop, snapshot, tools, executor, pricing)
    workers/    # Celery: фоновая суммаризация истории диалогов
    templates/  # Jinja2-шаблон PDF-итинерария
  migrations/   # Alembic (17 миграций)
  scripts/      # сид POI из Overpass, llm_probe (проба провайдера)
  tests/        # pytest: юнит + integration/
frontend/
  src/
    styles/tokens.css   # дизайн-токены Hermod (светлая + черновая тёмная тема)
    i18n/               # словари ru/en/de/fr/es
    api/                # типизированные клиенты API (meili.ts — SSE-парсер)
    store/              # Zustand: состояние чата ассистента
    components/         # DayCard, BudgetPanel, StopDetailPanel, DayPill,
                        # HermodLogo (знак сервиса), Logo (знак-M — аватар Meili)…
    components/meili/   # MeiliChat, PlanPreview, PlanEditor
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

Спринты 1–10 завершены (см. PROGRESS), ТЗ-E (авто-оценка бюджета из цен мест)
и ТЗ-Meili (AI-ассистент, спринты M1–M5) реализованы. Ассистенту нужен
`LLM_API_KEY` в `backend/.env` (без него чат отвечает 501). Не реализовано:
реальный сид цен (2GIS avg_check, ручные билеты) — цены пока проставляются
через `PATCH /places/{id}`; деплой (решение об инфраструктуре открыто),
переводы de/fr/es, анимации, встроенное партнёрское API бронирования
(сейчас deep-link).
