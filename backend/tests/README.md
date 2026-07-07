# Тесты бэкенда

Два слоя: быстрые юнит-тесты чистой логики (без инфраструктуры) и
интеграционные тесты против реального Postgres+PostGIS.

## Юнит-слой (`tests/*.py`)

| Файл | Модуль | Проверяет |
|---|---|---|
| `test_security.py` | `core/security.py` | bcrypt-хеширование, JWT (создание/декод, невалидный/просроченный/подделанный токен) |
| `test_recommendations.py` | `services/recommendations.py` | метрики `jaccard` и `cosine` для коллаборативной фильтрации |
| `test_optimizer.py` | `services/optimizer.py` | OR-Tools TSP/TSPTW, окна работы, depot, коэффициент пробок `auto × 1.4` (Valhalla замокан) |
| `test_places_service.py` | `services/places.py` | конвертация Place → dict, распаковка PostGIS-координат |
| `test_booking_service.py` | `services/booking.py` | deep-link для Viator/OpenTable/TheFork, приоритет `booking_url`, `booking_to_dict` |
| `test_email.py` | `services/email.py` | письмо о брони, dev-режим (лог вместо SMTP), сбой SMTP не роняет запрос |
| `test_google_oauth.py` | `api/auth.py` | 501 без ключей, редирект на accounts.google.com с ключами |
| `test_app_smoke.py` | `main.py` | приложение импортируется, `/health`, карта всех роутов, OpenAPI |

## Интеграционный слой (`tests/integration/`)

Реальный Postgres из docker-compose, отдельная БД `wanderown_test`
(создаётся и чистится автоматически; без Postgres — слой скипается).

| Файл | Проверяет |
|---|---|
| `test_booking_flow.py` | полный флоу: регистрация → логин → поездка → место (PostGIS round-trip) → остановка → бронь → confirm (`is_booked`) → cancel; чужая остановка 404; неизвестный провайдер 400; PUT остановки |

## Запуск

```bash
# стек поднят (docker compose up):
docker compose exec backend python -m pytest

# без стека (интеграционные скипнутся):
docker compose run --rm --no-deps backend python -m pytest
```

## E2E (frontend/e2e, Playwright)

Живой браузерный смоук: логин, ошибка пароля, редирект незалогиненных,
создание поездки → планировщик. Бэкенд должен быть поднят.

```bash
cd frontend && npm run test:e2e
```
