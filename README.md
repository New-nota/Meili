# Hermod

Планировщик путешествий: собери поездку по дням в любом городе мира, оптимизируй
маршрут каждого дня с учётом часов работы мест, следи за бюджетом и выгружай
итинерарий в PDF или календарь. Внутри — ИИ-ассистент **Meili**, который ищет
реальные места и предлагает план изменений.

> Ранее проект назывался Meili, а ещё раньше — WanderOwn / fastrip: старые имена
> в истории git, имени БД (`wanderown_db`) и бэкенд-коде ассистента — это одно
> приложение.

## Возможности

- **Поездки по всему миру.** Мастер находит любой город (тёзки подписаны регионом
  и страной), страну и таймзону поездки вычисляет система по координатам.
- **Мульти-день.** Диапазон дат → дни поездки; у каждого дня свой старт и финиш
  (отели, вокзалы — переиспользуемая история локаций), стопы переносятся между днями.
- **Маршруты и оптимизация** (Valhalla + OR-Tools): пешком / на машине / на
  транспорте, путь дня с учётом часов работы (TSPTW) и длительности визитов,
  режим «максимум за время» (prize-collecting TSP), обязательные места не выкидываются.
  Маршруты строятся там, где есть карты (сейчас — Калининградская область и
  Москва с агломерацией, добавить город — одна строка, см. «Карты и регионы»).
- **Бюджет**: лимит и валюта поездки, стоимость стопов (факт брони важнее оценки,
  нет данных — «цена не указана», а не 0), статьи расходов, разбивки по дням и
  категориям, авто-оценка из цен мест.
- **Ассистент Meili** (чат в планировщике): видит актуальную поездку, ищет
  реальные места — часы работы и цены считает система, не модель; для нового
  города сам подтягивает места из OpenStreetMap. Предлагает **план** — карточку
  с превью и редактором; в базу пишет только кнопка «Применить» (одна транзакция,
  проверка владения). SSE-стриминг, свёртка длинной истории в фоне (Celery).
  Провайдер — Mistral, запасной DeepSeek (переключение одной переменной).
- **Бронирование** deep-link'ами (Viator / OpenTable / TheFork) с подтверждением
  номера брони и письмом.
- **Экспорт**: PDF-итинерарий и `.ics` в таймзоне поездки — на языке интерфейса.
- **Профиль**: аватар (Cloudflare R2), статистика, свои и понравившиеся маршруты,
  рекомендации (коллаборативная фильтрация).
- **5 языков** (ru, en, de, fr, es) с переключением без перезагрузки; PDF, `.ics`
  и письма — на ru/en по языку интерфейса.
- **Аутентификация**: регистрация с кодом на почту, JWT access в памяти + refresh
  в httpOnly-cookie с ротацией, вход через Google.
- **PWA**, адаптив под телефон, дизайн-система на CSS-токенах.

## Стек

| Слой | Технологии |
|---|---|
| Backend | Python 3.11 · FastAPI 0.142 · SQLAlchemy 2 (async) · PostgreSQL 15 + PostGIS · Redis · Alembic · Celery |
| Маршруты | Valhalla 3.9 (матрицы времён, полилинии) · OR-Tools (TSP / TSPTW / selective) |
| Ассистент | Mistral (дефолт) / DeepSeek · SSE · tool-calls |
| Frontend | Vite 8 · React 19 · TypeScript 6 · MapLibre GL 6 · TanStack Query · Zustand · i18next |
| Данные мест | OpenStreetMap: свой pbf региона (osmium), Overpass (новые города), Nominatim (геокодинг) |
| Экспорт | WeasyPrint 70 (без сети) · ics · Jinja2 |
| Прочее | Cloudflare R2 (boto3) · structlog (JSON-логи, request-id) · PyJWT · tzfpy |

## Быстрый старт (с нуля)

Нужны **Docker** (Compose v2) и **Node.js 22**. Свободные порты: 8000, 5173,
5432, 6379, 8002. Диск: ~3 ГБ под карты Калининграда и Москвы.

```bash
# 1. Конфиг — один .env на весь проект. Пустые строки в нём — личные секреты;
#    обязателен только SECRET_KEY, остальное включает опциональные фичи.
cp .env.example .env
sed -i '' "s/^SECRET_KEY=$/SECRET_KEY=$(openssl rand -hex 32)/" .env   # macOS; на Linux: sed -i "…"

# 2. Карты для маршрутов: скачает OSM регионов из scripts/valhalla_regions.txt
#    (~0,9 ГБ), вырежет, соберёт тайлы Valhalla (5–10 мин в первый раз)
./scripts/update_valhalla_tiles.sh

# 3. Стек: Postgres+PostGIS, Redis, Valhalla, FastAPI, Celery-воркер
docker compose up -d --build

# 4. Схема БД и места для регионов с картами (идемпотентно)
docker compose exec backend alembic upgrade head
./scripts/seed_region_pois.sh kaliningrad
./scripts/seed_region_pois.sh moscow

# 5. Фронтенд
cd frontend && npm ci && npm run dev
```

- Приложение: http://localhost:5173 (регистрация — код подтверждения без SMTP
  печатается в лог: `docker compose logs backend | grep -A3 "dev email"`)
- Swagger: http://localhost:8000/docs
- pgAdmin: `docker compose --profile tools up -d pgadmin` → http://localhost:5050

## Конфигурация

Всё в одном `.env` в корне (шаблон с комментариями — `.env.example`). Его читают
docker compose, бэкенд (pydantic) и Vite (в браузер попадают только `VITE_*`).
Пустое значение `KEY=` означает «не задано».

| Что включает | Переменные |
|---|---|
| Обязательно | `SECRET_KEY` — подпись JWT, у каждого своя (`openssl rand -hex 32`) |
| Ассистент Meili | `LLM_API_KEY` (Mistral; `LLM_PROVIDER=deepseek` — DeepSeek). Проба: `docker compose exec backend python -m scripts.llm_probe` |
| Вход через Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (redirect URI `http://localhost:8000/auth/google/callback`) |
| Аватары | `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_PUBLIC_BASE_URL` |
| Настоящие письма | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` (без них письма — в лог) |
| На деплое за HTTPS | `COOKIE_SECURE=true`, `FRONTEND_URL=<адрес фронта>` |

Без ключа фича отвечает 501, остальное работает. Адреса сервисов внутри Docker
и зона карт (`ROUTING_COVERAGE`) задаются в `docker-compose.yml`, не в `.env`.

## Карты и регионы

Поиск мест, мастер, ассистент, бюджет и экспорт работают в любом городе.
**Маршруты** (время в пути, оптимизация дня) — только там, где есть тайлы
Valhalla. Регионы описаны в `scripts/valhalla_regions.txt`:

```
# имя         источник OSM (pbf)                                      south,west,north,east  [cut]
kaliningrad  https://download.geofabrik.de/russia/kaliningrad-latest.osm.pbf   54.30,19.60,55.35,23.05
moscow       https://download.geofabrik.de/russia/central-fed-district-latest.osm.pbf 55.35,36.95,56.05,38.15 cut
```

Добавить город:
1. строка в `valhalla_regions.txt` (с `cut` регион вырезается из большого файла по bbox);
2. `./scripts/update_valhalla_tiles.sh` — соберёт тайлы в стороне, проверит и
   подменит без простоя, затем напечатает строку `ROUTING_COVERAGE` — вставь её
   в `docker-compose.yml` (backend и worker) и `docker compose up -d backend worker`;
3. `./scripts/seed_region_pois.sh <имя>` — места региона из того же pbf.

Скрипт обновления можно ставить в cron раз в месяц — неизменённые источники
он не перекачивает. Точка вне зоны карт честно отклоняется («здесь пока не
строятся маршруты»), а не ломает день.

Сколько железа нужно (замер на Москве + опубликованные сборки Valhalla):

| Покрытие | OSM pbf | Тайлы | Сборка: RAM / диск / время | Работа: RAM / диск |
|---|---|---|---|---|
| Москва (агломерация) | 0,13 ГБ | 0,26 ГБ | 4 ГБ / 3 ГБ / < 1 мин | 2 ГБ / 0,5 ГБ |
| Россия | 4,2 ГБ | ~4–5 ГБ | 16 ГБ / 50 ГБ / ~1 ч | 4–8 ГБ / 10 ГБ |
| Европа | 35 ГБ | ~32–40 ГБ | 32 ГБ / 250 ГБ NVMe / 6–12 ч | 8–16 ГБ / 50 ГБ |
| Весь мир | 95 ГБ | ~75–90 ГБ | 64 ГБ / 1 ТБ NVMe / 18–24 ч | 16–32 ГБ / 120 ГБ |

## Производительность и боевой запуск

Образ бэкенда по умолчанию боевой: несколько процессов uvicorn
(`WEB_CONCURRENCY`, по умолчанию 2), без `--reload`; docker-compose для
разработки включает `--reload`. Маршруты и матрицы Valhalla кэшируются в
Redis. Замер на ноутбуке (50 одновременных пользователей, типичные запросы
планировщика вместе с маршрутами): dev-режим — ~220 rps, боевой образ на
4 воркерах — ~600 rps, p50 маршрута 11 мс; поездка на 60 дней × 25 мест
(1500 стопов) открывается за ~60 мс, PDF/`.ics` — ~1 с.

## Тесты

```bash
# backend: юнит + интеграционные (реальный Postgres, отдельная БД wanderown_test),
# включая прогон миграций с нуля и проверку дрейфа схемы
docker compose exec backend python -m pytest          # ~342

cd frontend
npm run test:unit      # vitest, ~59
npm run test:e2e       # Playwright, ~26 сценариев; нужен поднятый стек и тайлы
npm run lint && npx tsc -b
```

E2E идут против живого стека (бэкенд, Valhalla), геокодер мокается. Спеки
написаны по русским строкам интерфейса. Запуск из git-воркдерева:
`E2E_STACK_DIR=/путь/к/основной/копии npm run test:e2e`.

## Структура

```
backend/
  app/
    api/         # роутеры: auth, trips, days, stops, places, bookings, budget,
                 # export, users, optimize, recommendations, meili; /health, /meta
    core/        # config (единый .env), database, security (JWT), redis, logging,
                 # i18n (тексты PDF/.ics/писем ru/en)
    models/      # Trip, TripDay, TripLocation, TripStop, TripExpense, Place,
                 # Booking, User, соц. связи, Conversation, Message, MeiliPlan
    schemas/     # Pydantic (plan.py — граница «модель ↔ система»)
    services/    # optimizer, valhalla, budget, budget_estimate, stops, trips,
                 # export_pdf/ics, overpass, email, storage, recommendations;
                 # places/ (geo, catalog, opening hours); llm/; meili/
    workers/     # Celery: свёртка истории диалогов
    templates/   # Jinja2-шаблон PDF
  migrations/    # Alembic (26 миграций; цепочка поднимается с нуля)
  scripts/       # seed_pois (места из pbf), seed_places, llm_probe, kaliningrad.py
  tests/         # pytest: юнит + integration/
frontend/
  src/
    pages/       # Auth, Discover, TripPlanner, TripSettings, Profile
    components/  # trip/ (DayPlan…), meili/ (MeiliChat, PlanPreview, PlanEditor), …
    api/         # типизированные клиенты (meili.ts — SSE-парсер, meta.ts — зона карт)
    utils/       # geocode (поиск по миру), maplibre (воркер карты), money, …
    i18n/        # словари ru/en/de/fr/es
    styles/      # tokens.css — дизайн-токены
  e2e/           # Playwright: auth-and-trip, qa-hardening, world (+ helpers.ts)
scripts/
  valhalla_regions.txt      # регионы карт
  update_valhalla_tiles.sh  # скачать → вырезать → собрать → проверить → подменить
  seed_region_pois.sh       # места региона из локального OSM
```

## Дизайн

Тема «Лес»: зелёный акцент (`--moss` #3D7550), берёзовые и дубовые поверхности,
карта на «деревянной» подложке, насыщенным выделен только маршрут; дни в режиме
«Все дни» — природной палитрой. Шрифт — Onest, суммы — табличными цифрами.
Все цвета — токены из `frontend/src/styles/tokens.css`; подробности —
`DESIGN.md`, продуктовый контекст — `PRODUCT.md`.

## Если что-то не так

- **valhalla перезапускается по кругу** — нет тайлов: сначала
  `./scripts/update_valhalla_tiles.sh`, потом `docker compose up -d`.
- **«Маршрут дня сейчас не строится»** — точки вне зоны карт или Valhalla не
  поднялась (`docker compose logs valhalla`).
- **Ассистент отвечает 501** — не задан `LLM_API_KEY`.
- **Overpass отвечает 504** при первом вопросе Meili про новый город —
  публичный сервер перегружен; места для городов с картами лучше залить
  `seed_region_pois.sh`, а для прочих Meili повторит через 10 минут.
- **Код регистрации** без SMTP — в логе backend (`dev email`).

## Статус

Пет-проект. Сделано: спринты 1–18, ТЗ-E (авто-оценка бюджета), ТЗ-Meili
(ассистент), работа по всему миру с картами N регионов, ревью безопасности
(аудит зависимостей — 0 известных уязвимостей). Не сделано: деплой, реальные
цены мест (2GIS, билеты — пока `PATCH /places/{id}`), API бронирования
(сейчас deep-link), расписания общественного транспорта (GTFS), тёмная тема
(токены черновые, переключателя нет).
