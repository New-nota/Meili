"""Smoke-тесты жизнеспособности: приложение целиком импортируется, все роутеры
подключены, OpenAPI собирается. Ловит поломки импортов/синтаксиса по всему
проекту, не требуя живых Postgres/Redis/Valhalla."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_openapi_schema_builds():
    schema = app.openapi()
    assert schema["info"]["title"]
    assert "paths" in schema
    # кастомная JWT-схема безопасности на месте
    assert "bearerAuth" in schema["components"]["securitySchemes"]


# (метод, путь) — ожидаемая карта маршрутов из PROGRESS.md
EXPECTED_ROUTES = [
    ("POST", "/auth/register"),
    ("POST", "/auth/login"),
    ("GET", "/auth/google/login"),
    ("GET", "/auth/google/callback"),
    # S8 WP-1 — refresh-токены
    ("POST", "/auth/refresh"),
    ("POST", "/auth/logout"),
    # S9 WP-D — профиль
    ("GET", "/users/me"),
    ("PATCH", "/users/me"),
    ("POST", "/users/me/avatar"),
    ("POST", "/users/me/password"),
    ("GET", "/users/me/trips"),
    ("GET", "/users/me/liked-trips"),
    ("GET", "/trips/"),
    ("POST", "/trips/"),
    ("GET", "/trips/{trip_id}"),
    ("PUT", "/trips/{trip_id}"),
    ("DELETE", "/trips/{trip_id}"),
    ("POST", "/trips/{trip_id}/like"),
    ("DELETE", "/trips/{trip_id}/like"),
    ("POST", "/trips/{trip_id}/clone"),
    # S8 WP-3 — мульти-день (optimize переехал на уровень дня)
    ("GET", "/trips/{trip_id}/locations"),
    ("POST", "/trips/{trip_id}/locations"),
    ("DELETE", "/trips/{trip_id}/locations/{loc_id}"),
    ("GET", "/trips/{trip_id}/days"),
    ("PATCH", "/trips/{trip_id}/days/{day_id}"),
    ("POST", "/trips/{trip_id}/days/{day_id}/optimize"),
    ("PATCH", "/trips/{trip_id}/stops/{stop_id}"),
    ("GET", "/trips/{trip_id}/stops"),
    ("POST", "/trips/{trip_id}/stops"),
    ("POST", "/trips/{trip_id}/stops/reorder"),
    ("GET", "/places/"),
    ("POST", "/places/"),
    ("GET", "/places/search/nearby"),
    ("POST", "/places/{place_id}/visited"),
    ("GET", "/recommendations/places"),
    ("GET", "/recommendations/trips"),
    # Sprint 6 — бронирование
    ("PUT", "/trips/{trip_id}/stops/{stop_id}"),
    ("POST", "/bookings/"),
    ("GET", "/bookings/"),
    ("POST", "/bookings/{booking_id}/confirm"),
    ("POST", "/bookings/{booking_id}/cancel"),
]


def _registered_routes():
    routes = set()
    for route in app.routes:
        methods = getattr(route, "methods", None)
        path = getattr(route, "path", None)
        if methods and path:
            for m in methods:
                routes.add((m, path))
    return routes


def test_all_expected_routes_registered():
    registered = _registered_routes()
    missing = [r for r in EXPECTED_ROUTES if r not in registered]
    assert not missing, f"Не зарегистрированы роуты: {missing}"


def test_booking_endpoints_require_auth():
    """Все booking-эндпоинты закрыты JWT."""
    assert client.get("/bookings/").status_code == 401
    assert client.post("/bookings/", json={}).status_code == 401
