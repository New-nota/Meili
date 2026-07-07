# Тесты бэкенда

Быстрые юнит-тесты чистой логики + smoke-тест загрузки приложения. **Не требуют
живых Postgres / Redis / Valhalla** — проверяют жизнеспособность проекта за ~1.5с.

## Что покрыто

| Файл | Модуль | Проверяет |
|---|---|---|
| `test_security.py` | `core/security.py` | bcrypt-хеширование, JWT (создание/декод, невалидный/просроченный/подделанный токен) |
| `test_recommendations.py` | `services/recommendations.py` | метрики `jaccard` и `cosine` для коллаборативной фильтрации |
| `test_optimizer.py` | `services/optimizer.py` | OR-Tools TSP/TSPTW, окна работы, depot, коэффициент пробок `auto × 1.4` (Valhalla замокан) |
| `test_places_service.py` | `services/places.py` | конвертация Place → dict, распаковка PostGIS-координат |
| `test_app_smoke.py` | `main.py` | приложение импортируется, `/health`, все роуты подключены, OpenAPI собирается |

## Запуск

Локальный Python — 3.9, проект работает на 3.11, поэтому тесты гоняются в контейнере.

Если стек поднят (`docker compose up`):

```bash
docker compose exec backend python -m pytest
```

Без запущенного стека (эфемерный контейнер, без Postgres/Redis/Valhalla):

```bash
docker compose run --rm --no-deps backend python -m pytest
```

`pytest` и `pytest-asyncio` добавлены в `requirements.txt` — после `docker compose
build backend` они уже в образе. Правки самих тестов пересборки не требуют
(папка `./backend` смонтирована как volume).

## Что НЕ покрыто (осознанно)

Эндпоинты, которым нужен живой Postgres+PostGIS (CRUD, auth-flow через БД,
`/optimize`, `/recommendations` целиком). Для них нужна интеграционная сессия с
тестовой БД — отдельный слой, если понадобится.
