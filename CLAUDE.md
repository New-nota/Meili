# Hermod — карта проекта для Claude

Планировщик путешествий. **Hermod** — сервис, **Meili** — ИИ-ассистент внутри
(ТЗ-rename; бэкенд-техимена ассистента остались meili). Бывш. Meili, ранее
WanderOwn / fastrip — в git-истории и БД `wanderown_*` это одно приложение. Работает по всему
миру; маршруты — только там, где есть тайлы Valhalla (`ROUTING_COVERAGE`, локально — Калининградская
область и Москва с агломерацией).
Пет-проект, формат работы — **активное программирование**: Claude пишет код сам.
Учебный формат из PROGRESS.md (студент пишет руками) — устарел, игнорировать.
Тон общения и комментарии в коде — неформальный русский; комментарии помечаются
спринтом/ТЗ («S8 WP-3», «ТЗ-E») и объясняют «почему», а не «что».

## Окружение и запуск

- Весь бэкенд-стек в Docker: `docker compose up -d` → postgres+PostGIS, redis,
  valhalla, backend (FastAPI на :8000), worker (Celery — фон Meili-ассистента).
  Фронт — локально: `cd frontend && npm run dev` (:5173).
- `./backend` смонтирован в контейнер как `/app` — правки на хосте видны сразу
  (uvicorn с reload). Команды бэкенда гонять **в контейнере**:
  `docker compose exec backend <cmd>`.
- Миграции: `docker compose exec backend alembic upgrade head`.
  **Правило проекта: не применять миграцию, не прочитав её.** Миграции пишутся
  читаемо руками (заготовка через `alembic revision -m "..."` в контейнере).
- Места (POI) региона с картами — из того же pbf, что тайлы, без Overpass:
  `./scripts/seed_region_pois.sh moscow` (bbox из `scripts/valhalla_regions.txt`,
  osmium → `scripts/seed_pois.py`, идемпотентен; Москва — ~16,8 тыс. мест за
  ~15 с). Города без карт Meili заполняет сам через Overpass (по категории
  за запрос — общий запрос по мегаполису публичный Overpass отбивает 504).
  Старый сид Калининграда через Overpass: `python -m scripts.seed_places`.
- **Один `.env` в корне** на весь проект (`cp .env.example .env`, впиши
  пустые строки — это личные секреты). Его читают compose (`${…}` + `env_file`
  у backend/worker), pydantic (`config.ROOT_ENV`, `extra="ignore"`,
  `env_ignore_empty` — «KEY=» значит «не задано») и Vite (`envDir: '..'`,
  наружу только `VITE_*`). Адреса сервисов и `ROUTING_COVERAGE` — в
  docker-compose.yml, не в .env. Без SECRET_KEY бэкенд не стартует; без
  Google/R2/SMTP/LLM — соответствующие фичи отвечают 501. `backend/.dockerignore`
  не пускает .env в образ.

## Тесты

- Бэкенд: `docker compose exec backend python -m pytest` (~295). Тесты не шлют
  настоящих писем (autouse-фикстура в `tests/conftest.py` гасит SMTP_HOST). Юнит в `tests/`,
  интеграционные в `tests/integration/` — реальный Postgres, отдельная БД
  `wanderown_test` (схема из моделей через `create_all`, TRUNCATE после каждого
  теста, скип всего пакета если БД недоступна). Фикстуры `client` (httpx→ASGI,
  подмена `get_db`) и `auth_headers` — в `tests/integration/conftest.py`.
- Фронт: `npm run test:unit` (vitest, 53), `npm run test:e2e` (Playwright, 22;
  `e2e/qa-hardening.spec.ts` — сценарии QA-прогона, Meili там без LLM: план
  замораживается в БД, SSE подменяется;
  сам поднимает dev-сервер, нужен запущенный docker-стек; **спеки написаны по
  русским строкам UI**).

## Бэкенд (`backend/app/`) — FastAPI, SQLAlchemy 2 async

Слои: `api/` (роутеры) → `services/` (логика) → `models/` (SQLAlchemy) +
`schemas/` (Pydantic) + `core/` (config, database, security, redis, logging,
i18n).

Модели и связи (`models/`):
- `trip.py`: **Trip** (группа adults/children, `budget_total`+`currency` — одна
  валюта на поездку, `timezone`, `city_lat/lon` — центр карты из мастера S11) →
  **TripDay** (день с датой, именем `title`, 1-based `position`, стартом/финишем,
  временными рамками; уникальности trip+date и trip+position — **DEFERRABLE**,
  иначе реордер не переставит даты в одной транзакции) → **TripStop**
  (позиция в рамках дня, `day_id` **NOT NULL** — единственный источник даты стопа,
  отдельного `visit_date` больше нет; `duration_minutes` NOT NULL + флаг
  `duration_is_custom` — false значит «подставлено из места», UI рисует «≈»;
  `priority` 0/1/2 и `included_in_route` для selective-TSP;
  `estimated_cost` + `cost_source` auto/manual — ТЗ-E). **TripLocation** — история
  стартов/финишей (отели, вокзалы). **TripExpense** — статьи расходов
  (lodging/transport/food/other; категория `activity` запрещена — активности
  считаются из стопов).
- `enums.py`: **TransportMode** — ровно три режима `walking|driving|transit`
  (хранятся строкой). Соответствие costing'ам Valhalla — единственный словарь
  `VALHALLA_COSTING` в `services/valhalla.py`, больше нигде не дублируется.
- `place.py`: **Place** — POI с PostGIS-геометрией (`location`, POINT 4326),
  `osm_id` с partial-unique индексом (get-or-create в `services/places.create_place`).
  Цены для авто-оценки (ТЗ-E): `pricing_model` per_person|ticketed|free,
  `avg_check`, `ticket_adult/child`, `price_currency`.
- `booking.py`: **Booking** — deep-link брони (viator/opentable/thefork),
  статусы pending→confirmed/cancelled, факт суммы.
- `user.py`, `social.py`: юзеры (JWT + Google OAuth), лайки, посещённые места.
- `conversation.py`, `message.py`, `meili_plan.py` (ТЗ-Meili): **Conversation**
  (диалог; `trip_id` NULL до «Применить», summary-поля для свёрнутой истории) →
  **Message** (`role` user|assistant, `tool_calls` JSONB — аудит, в LLM-окно не
  подмешивается, `token_count` — триггер суммаризации) и **MeiliPlan**
  (замороженный `plan_json`, статус proposed|applied|discarded).

Ключевые сервисы (`services/`):
- `optimizer.py` — OR-Tools: TSP/TSPTW по матрице времён Valhalla, учёт часов
  работы и длительности визитов; selective (prize-collecting) режим «максимум
  за время», must-visit не выкидывается.
- `budget.py` — сводка бюджета: активности из стопов (факт брони важнее
  `estimated_cost`, null-стопы не считаются нулём) + статьи; разбивки per_day /
  per_category.
- `budget_estimate.py` (ТЗ-E) — чистая `estimate_stop_cost(place, adults,
  children, trip_currency)` → Decimal|None и `recompute_auto_stops(db, trip)`
  (только auto-стопы, без commit). Триггеры: POST stop, PUT trip при смене
  группы/валюты, `POST /trips/{id}/recompute-estimates` (ручная кнопка).
- `trips.py` — `sync_trip_days`: диапазон дат ↔ trip_days.
- `stops.py` — add_stop/remove_stop без commit: общая логика api/stops.py и
  Meili-executor'а (позиции в хвост дня, смыкание, авто-оценка ТЗ-E).
- `overpass.py` — поиск POI (кэш 24ч в Redis); `places/` — пакет: get-or-create
  по osm_id (`__init__.py`) + `opening.py` (`is_open_at`: часы работы, дни
  недели, интервалы через полночь; None = «не знаем») + `geo.py`
  (`in_coverage`, `timezone_at` через tzfpy) + `catalog.py` (`resolve_city`:
  каталог → Nominatim с кэшем; `ensure_city_catalog`: пустой город — один
  раз тянем POI из Overpass, метка области в Redis на месяц),
  `booking.py`, `export_pdf.py` (WeasyPrint + Jinja2 из `templates/`),
  `export_ics.py`, `storage.py` (R2/boto3), `recommendations.py` (collaborative
  filtering), `email.py` (без SMTP — в лог).

API (`api/`): auth (JWT access в памяти + refresh httpOnly cookie, ротация jti
в Redis), trips, days, stops, places, route (прокси Valhalla), optimize,
bookings, budget, export, users, recommendations, meili (префикс `/api/meili`).
Роутеры подключаются в `main.py` (там же request-id middleware и structlog).

## AI-ассистент Meili (ТЗ-Meili, спринты M1–M5)

**Инвариант (§0 ТЗ, не ломать):** факты (цены, часы, состояние поездки, доступ)
вычисляет и хранит система, модель их только компонует. Единственная точка
записи в поездку — кнопка «Применить» (executor). `trip_id` берётся ТОЛЬКО из
`conversation.trip_id` (серверная сессия), никогда из вывода модели.

Поток: `POST /api/meili/conversations/{id}/messages` → SSE-стрим → agent loop
в запросе (`services/meili/loop.py`, `run_turn`) → события `token | step |
plan | done | error`. Контекст хода: системный промпт + summary + окно
последних сообщений (токен-бюджет `MEILI_WINDOW_TOKENS`) + свежий снапшот
поездки из БД (`snapshot.py`) + локальное время юзера (tz клиента > tz поездки).

- **LLM-абстракция** (`services/llm/`): `base.py` — `LLMClient` + общий
  OpenAI-совместимый SSE-парсер (`LLMEvent`: token|tool_call|end);
  `mistral.py` (дефолт, pinned: loop `mistral-large-2512`, summary
  `mistral-small-2603`), `deepseek.py` (запасной, `deepseek-v4-pro`/`-flash`).
  Смена провайдера = env `LLM_PROVIDER`; ID проверять по офиц. докам, не по
  памяти. Без `LLM_API_KEY` чат отвечает 501. Проба: `python -m scripts.llm_probe`.
- **Read-tools** (`services/meili/tools/`): registry.py (JSON-схемы + диспетчер,
  только чтение), search_places (аннотирует `is_open_now` через `is_open_at` и
  цену через `pricing.resolve_price`; `near_place` — ориентир по названию,
  координаты и `distance_m` считает система, не-город области в `city` тоже
  трактуется как ориентир; слова-типы «кафе/музей/парк» — категория, а не
  подстрока имени; город в адресе — целым словом), place_details (описание обёрнуто как
  `external_data` — data-plane, не инструкции). Кап `LLM_MAX_STEPS` (посл. шаг
  без tools), таймаут шага `LLM_STEP_TIMEOUT_S`.
- **План**: псевдо-tool `propose_plan` в loop; аргументы валидируются
  `schemas/plan.py` (`ProposedPlan`, discriminated union по закрытому enum:
  create_trip | add_stop | remove_stop | set_budget | set_stop_cost | optimize).
  Валидный → заморожен в `meili_plans` + `event: plan`; невалидный → ошибка
  валидации в контекст, модель чинит (в пределах max_steps), в БД не пишется.
- Ссылки плана резолвит система (`plan_refs`, и при заморозке, и в refreeze):
  `add_stop` — place_id или place_name, `remove_stop`/`set_stop_cost` —
  stop_id или stop_name (+ day_index); в снапшоте у дней есть `day_index`.
- Защита хода: реплика 1..4000 символов, один ход на диалог (Redis-лок →
  409 `turn_in_progress`), не больше 10 ходов в минуту на юзера (429).
- **Executor** (`services/meili/executor.py`): одна транзакция, FOR UPDATE на
  план (анти-дабл-клик), ownership-guard перед записью, actions → сервисы 1:1
  (`Trip`+`sync_trip_days`, `services/stops.add_stop/remove_stop`,
  `optimize_day_stops` по дням — дни без старта/финиша скипаются), проставляет
  `conversation.trip_id`. Ошибка → ROLLBACK, план остаётся proposed. Повторный
  apply — идемпотентно прежний результат; discarded → 409. ORM-атрибуты для
  ответа читать ДО commit (после — MissingGreenlet).
- **Цены** (`services/meili/pricing.py`): реальный источник (цены ТЗ-E,
  price_level) → `is_estimate=false`; нет источника → модель даёт только
  ДИАПАЗОН (cost_min/max, source='estimate') — рисуется с «≈», в БД попадает
  только через «Применить». `trip_stops.cost_source` расширен значениями
  viator|price_level|estimate (движок ТЗ-E пересчитывает только 'auto').
- **Суммаризация** (`workers/meili_summarize.py`, Celery + Redis-брокер):
  токен-триггер после хода → фоново свернуть выпавшую из окна дельту в
  `conversations.summary` малой моделью, сдвинуть `summary_covers_until`;
  последний обмен всегда остаётся в окне. Ядро — обычная корутина (тесты зовут
  напрямую), Celery-таск — обёртка со своим engine.
- **Фронт**: `components/meili/` (MeiliChat — SSE-чат, PlanPreview — карточка
  [✕ закрыть | ✎ изменить | ✔ применить] + итог со значком оценок, PlanEditor —
  виртуальные правки через refreeze: новый plan_id, старый discarded),
  `store/meiliStore.ts` (Zustand), `api/meili.ts` (fetch + ReadableStream
  SSE-парсер). Вкладка «Meili» в TripPlanner.

**Отходы от буквы ТЗ-Meili (осознанные, чтобы не плодить дубли):**
- `trips.budget_amount/budget_currency` НЕ создавались — бюджет уже есть как
  `budget_total`+`currency` (S9); `set_budget` пишет туда.
- `trip_stops.cost_amount` НЕ создавался — точная сумма живёт в существующем
  `estimated_cost`; `cost_currency` не заводили (валюта одна на поездку,
  executor валидирует mismatch).
- Стек из шапки ТЗ (shadcn/Tailwind/dnd-kit) в проекте отсутствует — UI чата
  сделан в стиле проекта (инлайн-стили + токены); Zustand добавлен по ТЗ.
- `services/places.py` превращён в пакет `services/places/` (модуль и пакет
  одновременно существовать не могут) — старые импорты не тронуты.

**Ловушка SSE + asyncpg:** стриминговый ход обязан заканчиваться `commit()` —
висящая после финального SELECT read-транзакция держит соединение
`idle in transaction` и блокирует TRUNCATE/DDL (зависшие интеграционные тесты).

## Конвенции бэкенда

- **Деньги — только `Numeric(10,2)` / `Decimal`**, наружу строками ("25.50").
  Нет данных → `None`/NULL, **не 0** и не выдуманное значение.
- **Входные типы — из `schemas/common.py`** (QA-прогон): `Money` (ge=0, потолок
  Numeric(10,2), 2 знака), `MAX_GROUP`=50, `WallTime` (aware-время → naive),
  `not_null` — валидатор PATCH-схем для NOT NULL-колонок (поле можно не
  прислать, но нельзя прислать null). Новые схемы берут типы отсюда. Email —
  `NormalizedEmail` (strip+lower), поиск юзера — `func.lower(User.email)`.
- **Страховка в `main.py`:** `DBAPIError` по SQLSTATE → 422 `invalid_value` /
  `missing_value` / `invalid_reference`, 409 `conflict`; `httpx.HTTPError`
  внешних сервисов → 502 `upstream_unavailable`. Это сетка, а не валидация —
  правила всё равно пишем в схемах.
- **Тексты для людей — только в `core/i18n.py`** (ru/en): PDF, .ics, письма.
  Язык — зависимость `get_lang` (Accept-Language, его шлёт фронт из выбора в
  дропдауне); de/fr/es → en, без заголовка → ru. Ошибки API — по-прежнему
  машинные коды, их переводит фронт.
- **Покрытие маршрутов — конфиг, не код:** `ROUTING_COVERAGE` (JSON-список
  `[south, west, north, east]`, пусто = весь мир; локально задан в
  docker-compose под калининградские тайлы). Стоп вне зоны не добавляется
  (`place_out_of_coverage`, общая точка `services/stops.add_stop`), фронт
  берёт зону из публичного `GET /meta`. Справочник городов области живёт
  только у сид-скриптов (`scripts/kaliningrad.py`).
- **Таймзона поездки** — по координатам города (`geo.timezone_at`), без них
  UTC; Meili-executor сам находит координаты города через `resolve_city`.
- Позиции стопов **1-based** везде (add/reorder/optimize/clone); оптимизация
  работает и без старта/финиша дня (виртуальное депо = открытый путь).
- Превью чужой публичной поездки не отдаёт личное автора: старт/финиш дней,
  `/locations`, домашний адрес, факт броней (`day_to_response(owner=False)`).
- Enum'ы хранятся **строками** (String) + Pydantic `Literal` в схемах — не
  PG ENUM (примеры: `trip_expenses.category`, `cost_source`, `pricing_model`).
- Ответы стопов собираются руками в `stop_to_dict` (api/stops.py) — место
  подмешивается туда же (`place_name`, `place_pricing_model`…). Аналогично
  `place_to_dict` (services/places.py) — не забывать при добавлении полей.
- Владение проверяется через `get_trip_or_404(trip_id, user_id, db)` из api/stops.py.
- PUT и PATCH на один хендлер (`@router.put` + `@router.patch`), частичные
  обновления через `model_dump(exclude_unset=True)`.

## Фронтенд (`frontend/src/`) — Vite + React + TS

- `pages/`: Auth, Discover («Мои поездки» + рекомендации), **TripPlanner** —
  главный экран (десктоп: панель слева + карта справа в рамке на дубовой
  подложке; телефон: одна колонка — шапка, карта 300px, тело; вкладки
  «Маршрут | Бюджет | Meili», панель стопа), TripSettings, Profile.
- `components/trip/`: **DayPlan** (открытый день целиком: блок дня с–по/км/₽,
  поиск в день, старт → места с перегонами → финиш, «не влезло», оптимизация;
  время прибытия — `utils/daySchedule`), **DaySwatches** (дни-образцы вместо
  аккордеона, DnD-реордер, «Все дни»), LegRow, StopDuration. `components/ui/`:
  **Menu** (единое всплывающее меню: портал + fixed), Stepper. Плюс
  StopDetailPanel (бронь, оценка стоимости), BudgetPanel, PlaceSearch,
  LocationPicker (строка старта/финиша дня), StartPoint…
- `api/`: тонкие типизированные клиенты над `apiFetch` (client.ts: access-токен
  в памяти, авторефреш по cookie — **single-flight**, для `/auth/*` не
  рефрешится). Типы домена — `types/index.ts`.
- **Ошибки API → текст только через `utils/apiError.apiErrorMessage`**
  (машинный код `errors.<code>` → 422 с полями → по статусу → fallback). Новые
  машинные коды бэка — сразу в `errors.*` ru+en. Действия с сетью оборачивать
  в try/catch с показом ошибки (паттерн `safely` в DayPlan/StopDetailPanel) —
  голый `await` в onClick = «кнопка молча не работает».
- Геокодер — только `utils/geocode.geocode` (по миру; внутри поездки —
  сначала округа её города из `SearchAreaContext`, пусто — весь мир; res.ok,
  отмена устаревших запросов). Покрытие маршрутов — `useRoutingCoverage()`
  (`api/meta.ts`) + `inCoverage`; числовые поля с границами — `IntInput`, потолки
  — `utils/limits.ts` (зеркало `schemas/common.py`). Корень роутов обёрнут в
  `ErrorBoundary`.
- Состояние: стопы/дни в TripPlanner — обычный `useState` + `reloadStops()`
  (перезагружает стопы, дни, выбранный стоп и инвалидирует `['budget', tripId]`);
  TanStack Query используется точечно (бюджет, рекомендации); Zustand — только
  чат Meili (`store/meiliStore.ts`).
- **Дизайн-система «Лес»** (редизайн 2026-10, `DESIGN.md` в корне): интерфейс
  зелёный (мох `--moss`), поверхности берёза/дуб, главная кнопка — орех
  (`--walnut`), маршрут и метки на карте — дерево (`--wood`, хекс в
  `utils/mapStyle.ROUTE_HEX`), ошибки — брусника (`--danger`, НЕ `--accent`:
  он теперь зелёный). Шрифт Onest, иконки только `lucide-react` — эмодзи и
  глифы-иконки (✨🏁📍✕→) в UI не используем. Стили инлайновые на токенах +
  общие классы в `index.css` (`.btn .btn-primary/.btn-accent/.btn-ghost`,
  `.icon-btn`, `.input/.select/.textarea`, `.field`, `.searchbox`, `.seg`,
  `.chip`, `.switch`, `.modal-scrim/.modal-sheet`, `.page/.page-head`) — новые
  кнопки и поля берут их, а не пишут свои. Тёмная тема (`data-theme="dark"`) —
  черновая. Суммы — табличные цифры, `utils/money.formatMoney`; в сводках —
  `formatMoneyCompact` (без «,00»). Продуктовый контекст — `PRODUCT.md`,
  рабочие файлы дизайн-скилла — `.impeccable/`.
- i18n (`i18n/locales/*/translation.json`, **отступ 2 пробела**): ключи есть во
  всех пяти, de/fr/es переведены полностью (с en совпадают только
  слова-двойники: Budget, Route, Transport, «{{count}} min»). de — на «du»,
  fr — на «vous», es — на «tú» (испанский Испании). У fr/es в плюралах есть
  `_many` (копия `_other`, CLDR-категория для миллионов).
  `src/i18n/locales.test.ts` падает, если ключ есть в en, но нет в каком-то
  языке, или потерян плейсхолдер `{{…}}`. Новые строки — сразу во все пять.
  Язык интерфейса уходит бэкенду в Accept-Language (`setRequestLanguage` в
  `api/client.ts`, ставит `i18n/index.ts`) и в `<html lang>`.

## Доменные правила (не ломать)

- Бюджет: факт подтверждённой брони > `estimated_cost`; null-оценка = «нет
  данных», не 0; одна валюта на поездку, конвертаций нет (mismatch → null/400).
  Стоп «не влезло в день» (`included_in_route=false`) в «Запланировано» не
  входит — кроме подтверждённой брони.
- Авто-оценка (ТЗ-E): движок пересчитывает ТОЛЬКО `cost_source='auto'`;
  «вернуть авто» — PUT стопа с `cost_source: 'auto'` (пересчёт сразу); UI
  различает «Бесплатно» (free, 0.00) / «≈ сумма» (auto/estimate) / «≈ min–max»
  (диапазон-оценка Meili) / сумма без ≈ (manual, реальный источник) /
  «цена не указана» (null).
- Meili: факты — от системы, запись — только «Применить» (см. раздел ассистента).
- Дни (S16): `trip_days` — источник истины маршрута И даты стопа; стоп без дня
  невозможен (`day_id` NOT NULL). Позиции стопов — в рамках дня, при
  удалении/переносе хвост смыкается. Подпись «День N» **не хранится в БД** —
  её рисует фронт из `position` (`utils/dayLabel.ts`), в базе только `title`.
- Реордер дней (S16 §1.5): переставляется СОДЕРЖИМОЕ — день едет со своим
  именем и стопами, а даты остаются отсортированными по возрастанию (день
  получает новую дату из отсортированного пула).
- Время (S16): дорога между точками — только расчёт Valhalla
  (`GET /trips/{id}/route?day_id=`, перегоны с собственным costing), ручного
  ввода нет — иначе показывали бы одно, а оптимизировали по другому. Время
  НА точке правится руками и тогда теряет «≈» навсегда (`duration_is_custom`).
- Ре-сид цен/POI не пересчитывает стопы автоматически — только ручной recompute.

## Незакрытое / особенности

- Реальный сид цен (2GIS avg_check, билеты) не сделан — цены через
  `PATCH /places/{id}` или сид-скрипт.
- Mistral из РФ (2026-10-02): тем же ключом large → 403 `tier_not_allowed`,
  small/medium/magistral → 429 с `x-ratelimit-limit-req-minute: 0`, а
  `ministral-14b/8b/3b` и codestral отвечают (с сервера в КЗ ключ видит всё).
  Поэтому клиент LLM держит **цепочку запасных моделей** (`MODEL_FALLBACKS` в
  `services/llm/mistral.py`, override `LLM_MODEL_FALLBACKS`) и сам уходит на
  следующую при структурном отказе, кэшируя его на 10 мин; `client.last_model`
  — кто реально ответил (`scripts.llm_probe` печатает). Large вернётся через
  `LLM_HTTP_PROXY` (socks5/http, например ssh -D на сервер в КЗ) или
  `LLM_BASE_URL` (обратный прокси) — см. `.env.example`.
- Ассистент: живой прогон только с `LLM_API_KEY` (Mistral) в `.env` —
  тесты гоняются на фейковом клиенте; e2e-сценариев чата нет; PlanEditor
  правит только числа/день/удаление action.
- Деплой не решён; бронирование — deep-link, не API.
- Пустые `R2_ACCESS_KEY`/`R2_SECRET_KEY` в `.env` — загрузка аватара
  выключена (`avatar_upload_enabled=false` в профиле, кнопка неактивна).
- `valhalla_data/` — тяжёлые OSM-данные (не трогать без нужды). Регионы тайлов —
  `scripts/valhalla_regions.txt` (имя, источник, bbox, `cut` = вырезать
  osmium'ом); `scripts/update_valhalla_tiles.sh` качает (`curl -z`), вырезает,
  склеивает в один `regions.osm.pbf`, собирает в `valhalla_data/.build`,
  проверяет временным сервисом и только потом подменяет живые тайлы
  (ежемесячный cron). Положить pbf и рестартнуть НЕ работает: образ с
  `use_tiles_ignore_pbf=True` игнорирует pbf, а хеширует имена, не содержимое.
  Образ Valhalla зафиксирован на 3.9.0 (на 3.7.0 пешеходные маршруты по
  Москве падали 500, valhalla#6288); сборка и рантайм — одним образом.
- pgAdmin: `docker compose --profile tools up -d pgadmin` → :5050.
- Swagger: http://localhost:8000/docs.
