"""Структурные JSON-логи (WP-0, Спринт 8).

configure_logging() вызывается один раз в main.py до создания приложения.
Дальше везде: from app.core.logging import get_logger; log = get_logger().
Контекст запроса (request_id, user_id, ...) добавляется через
structlog.contextvars в middleware — попадает в каждую строку лога.
"""
import logging

import structlog

from app.core.config import settings


def configure_logging() -> None:
    level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
    logging.basicConfig(level=level, format="%(message)s")

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(ensure_ascii=False),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        cache_logger_on_first_use=True,
    )


def get_logger(*args, **kwargs):
    return structlog.get_logger(*args, **kwargs)
