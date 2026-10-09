"""Celery для отложенной работы Meili (ТЗ-Meili §2): интерактив стримится
в запросе (SSE), фон — здесь. Брокер — существующий Redis.

Воркер (сервис worker в docker-compose):
    celery -A app.workers.celery_app worker --loglevel=info
"""
from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "meili",
    broker=settings.REDIS_URL,
    # include вместо встречного импорта тасков — иначе циклический импорт
    include=["app.workers.meili_summarize", "app.workers.catalog_fill", "app.workers.dgis_enrich"],
)
celery_app.conf.update(
    task_ignore_result=True,      # результаты не читаем — backend не нужен
    broker_connection_retry_on_startup=True,
)
