import time
from uuid import uuid4

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from starlette.middleware.sessions import SessionMiddleware
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
from app.api.route import router as route_router
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
app.include_router(route_router)
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