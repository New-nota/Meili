"""Фоновое дозаполнение каталога города (meili_upgrade).

Ход Meili синхронно тянет из Overpass только спрошенную категорию — чтобы
ответить сейчас. Остальные категории города идут сюда: следующий вопрос
про этот город («а бар рядом?») уже не ждёт сеть.

Категории — последовательно, по запросу на каждую: публичный Overpass
отбивает тяжёлые запросы 504, а метки «область × категория» делают
повторную постановку дешёвой.
"""
import asyncio

import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.logging import get_logger
from app.services.places.catalog import CATEGORIES, CityRef, OverpassBusy, ensure_category
from app.workers.celery_app import celery_app

logger = get_logger("meili.catalog_fill")

# Живой смоук: два города дозаполнялись разом (воркер многопроцессный) и
# вместе с синхронным запросом хода выбирали слоты публичного Overpass —
# все ловили 429/504. Поэтому: один город за раз, пауза между категориями,
# первый 429 — стоп (недотянутое придёт со следующим поиском по городу).
FILL_LOCK = "catalog:fill:running"
FILL_LOCK_TTL = 600
FILL_PAUSE_S = 2.0
BUSY_RETRY_S = 120


async def fill_area(city: CityRef, factory=None, redis=None, pause_s: float = FILL_PAUSE_S) -> int:
    """Все категории вокруг города. → сколько мест добавлено."""
    added = 0
    for category in CATEGORIES:
        try:
            added += await ensure_category(city, category, factory=factory, redis=redis)
        except OverpassBusy:
            logger.warning("catalog_fill_overpass_busy", city=city.name, category=category)
            break
        except Exception:  # noqa: BLE001 — одна категория не валит остальные
            logger.exception("catalog_fill_failed", city=city.name, category=category)
        await asyncio.sleep(pause_s)
    return added


@celery_app.task(name="catalog.fill_area", bind=True, max_retries=5)
def fill_area_task(self, name: str, lat: float, lon: float, radius_m: int) -> None:
    """Celery-обёртка: свои engine и Redis на прогон (свой event loop)."""
    async def _run() -> bool:
        engine = create_async_engine(settings.DATABASE_URL)
        redis = aioredis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
        try:
            if not await redis.set(FILL_LOCK, name, nx=True, ex=FILL_LOCK_TTL):
                return False  # другой город уже заполняется
            try:
                added = await fill_area(
                    CityRef(name, lat, lon, radius_m),
                    factory=async_sessionmaker(engine, expire_on_commit=False), redis=redis,
                )
                logger.info("catalog_filled", city=name, added=added)
            finally:
                await redis.delete(FILL_LOCK)
            return True
        finally:
            await redis.aclose()
            await engine.dispose()

    if not asyncio.run(_run()):
        raise self.retry(countdown=BUSY_RETRY_S)
