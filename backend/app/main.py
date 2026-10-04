import time
from math import isfinite
from uuid import uuid4

import httpx
import structlog
from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy.exc import DBAPIError
from starlette.responses import JSONResponse
from app.core.config import settings
from app.core.logging import configure_logging, get_logger

# логи настраиваются до создания приложения (WP-0)
configure_logging()
logger = get_logger("meili.api")

# --- Sentry: включить на деплое (WP-0) ---
# if settings.SENTRY_DSN:
#     import sentry_sdk
#     sentry_sdk.init(dsn=settings.SENTRY_DSN, traces_sample_rate=0.1)

from app.api.auth import router as auth_router
from app.api.trips import router as trip_router
from app.api.places import router as places_router
from app.api.stops import router as stops_router
from app.api.optimize import router as optimize_router
from app.api.recommendations import router as recommendations_router
from app.api.bookings import router as bookings_router
from app.api.days import router as days_router
from app.api.users import router as users_router
from app.api.budget import router as budget_router
from app.api.export import router as export_router
from app.api.meili import router as meili_router

app = FastAPI(
    title="Hermod API",
    version="0.1.0"
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Сквозной request-id + одна структурная строка лога на запрос."""
    request_id = uuid4().hex
    # дубль в request.state: обработчик исключений живёт снаружи этого
    # middleware и срабатывает уже после clear_contextvars()
    request.state.request_id = request_id
    structlog.contextvars.bind_contextvars(
        request_id=request_id,
        method=request.method,
        path=request.url.path,
    )
    start = time.perf_counter()
    try:
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start) * 1000, 1)
        logger.info("request", status=response.status_code, duration_ms=duration_ms)
        response.headers["X-Request-ID"] = request_id
        return response
    finally:
        structlog.contextvars.clear_contextvars()


def _json_safe(value):
    """Заменить не-JSON-совместимые float'ы (NaN/inf) их текстом.

    Ревью: JSON-парсер Python принимает литералы NaN/Infinity, а json.dumps их
    отдать наружу не может. Валидация тело с NaN отвергала правильно, но
    ДЕФОЛТНЫЙ обработчик FastAPI кладёт исходное значение в тело 422 — и падал
    на сериализации сам. Итог: любой запрос с NaN в любом float-поле давал 500
    вместо 422, на любой ручке. Санитайзим то, что уходит в ответ об ошибке.
    """
    if isinstance(value, float) and not isfinite(value):
        return repr(value)
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        # форма тела как у дефолтного обработчика FastAPI — клиенты не ломаются
        content={"detail": _json_safe(jsonable_encoder(exc.errors()))},
    )


def _sqlstate(exc: DBAPIError) -> str | None:
    """SQLSTATE исходной ошибки драйвера (asyncpg прячет её за адаптером)."""
    for err in (exc.orig, getattr(exc.orig, "__cause__", None)):
        code = getattr(err, "sqlstate", None) or getattr(err, "pgcode", None)
        if code:
            return code
    return None


@app.exception_handler(DBAPIError)
async def db_error_handler(request: Request, exc: DBAPIError):
    """QA: данные, которые БД отказалась хранить, — ошибка клиента, а не 500.

    Фаззинг всех ручек нашёл один и тот же класс падений в десятке мест:
    NUL-байт в любой строке (Postgres text его не принимает), сумма больше
    Numeric(10,2), null в NOT NULL-поле через PATCH, id несуществующего/чужого
    объекта в FK. Валидацию на входе чиним точечно в схемах, а это — страховка
    на всё, что туда не дошло: SQLSTATE → честный 4xx с машинным кодом.
    """
    state = _sqlstate(exc) or ""
    driver_data_error = "DataError" in type(exc.orig).__name__  # asyncpg: аргумент не лезет в тип
    if state.startswith("22") or driver_data_error:
        code, detail = 422, "invalid_value"
    elif state == "23502":
        code, detail = 422, "missing_value"
    elif state == "23503":
        code, detail = 422, "invalid_reference"
    elif state in ("23505", "23P01"):
        code, detail = 409, "conflict"
    elif state == "23514":
        code, detail = 422, "invalid_value"
    else:
        return await unhandled_exception_handler(request, exc)
    logger.warning("db_rejected", sqlstate=state, detail=detail, error=str(exc.orig)[:300])
    return JSONResponse(status_code=code, content={"detail": detail})


@app.exception_handler(httpx.HTTPError)
async def upstream_error_handler(request: Request, exc: httpx.HTTPError):
    """QA: внешний сервис (Overpass/Valhalla/Nominatim) лёг или ответил
    429/504 — это 502 «попробуйте позже», а не 500 «у нас баг»."""
    logger.warning("upstream_failed", error=f"{type(exc).__name__}: {exc}"[:300])
    return JSONResponse(status_code=502, content={"detail": "upstream_unavailable"})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Необработанное исключение: лог с traceback, клиенту — 500 c request_id."""
    request_id = getattr(request.state, "request_id", "unknown")
    logger.exception(
        "unhandled",
        request_id=request_id,
        method=request.method,
        path=request.url.path,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "internal error", "request_id": request_id},
        headers={"X-Request-ID": request_id},
    )

# сессии нужны authlib для хранения OAuth state (CSRF-защита флоу)
app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(trip_router)
app.include_router(places_router)
app.include_router(stops_router)
app.include_router(optimize_router)
app.include_router(recommendations_router)
app.include_router(bookings_router)
app.include_router(days_router)
app.include_router(users_router)
app.include_router(budget_router)
app.include_router(export_router)
app.include_router(meili_router)
@app.get("/health")
async def health():
    return {"status":"ok"}


@app.get("/meta")
async def meta():
    """Публичные факты о развёртывании для фронта. Покрытие маршрутов —
    где Valhalla строит маршруты ([south, west, north, east], пусто = везде):
    фронт предупреждает о точке вне зоны до того, как бэк её отклонит."""
    return {"routing_coverage": [list(box) for box in settings.ROUTING_COVERAGE]}

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    openapi_schema = get_openapi(
        title="Hermod API",
        version="0.1.0",
        routes=app.routes,
    )
    openapi_schema["components"]["securitySchemes"] = {
        "bearerAuth" : {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
        }
    }
    openapi_schema["security"] = [{"bearerAuth": []}]
    app.openapi_schema = openapi_schema
    return app.openapi_schema

app.openapi = custom_openapi