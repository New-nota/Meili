"""Фоновое обогащение мест из 2ГИС (этап B): то, что не успело в бюджет хода.

Ход Meili ждёт 2ГИС не дольше enrich.BUDGET_S; недоделанные места — сюда,
без бюджета. Свои engine и Redis на прогон (воркер — свой event loop).
"""
import asyncio
from uuid import UUID

import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.logging import get_logger
from app.models.place import Place
from app.services.providers.enrich import enrich_places
from app.workers.celery_app import celery_app

logger = get_logger("meili.dgis_enrich")


@celery_app.task(name="dgis.enrich_places")
def enrich_places_task(place_ids: list[str]) -> None:
    async def _run():
        engine = create_async_engine(settings.DATABASE_URL)
        redis = aioredis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                places = list((await db.execute(
                    select(Place).where(Place.id.in_([UUID(i) for i in place_ids]))
                )).scalars().all())
                written = await enrich_places(db, places, budget_s=None, redis=redis, background=False)
                logger.info("dgis_enriched", requested=len(place_ids), written=written)
        finally:
            await redis.aclose()
            await engine.dispose()

    asyncio.run(_run())
