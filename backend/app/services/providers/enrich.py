"""Обогащение мест фактами внешних источников (этап B, сейчас — 2ГИС).

Зовётся из search_places по местам, которые увидит модель: цена и рейтинг
нужны в ЭТОМ ответе («сколько стоит поужинать там?»). Поэтому синхронно, но
с бюджетом: не успели за BUDGET_S — догоняет Celery (workers/dgis_enrich.py),
цены появятся со следующего вопроса.

Правила записи (разбор этапа B, вариант B — «обогащение с источником и сроком»):
- цену пишем, только если price_source пустой / osm / 2gis — ручную (manual)
  не трогаем никогда;
- часы — только если своих нет (OSM-часы не хуже, а ручные — тем более);
- «номер от N» — в lodging_price_from, только для показа;
- стопы не пересчитываем (правило проекта: ре-сид цен не трогает бюджет —
  только ручной recompute).
Соединение БД на запросах к 2ГИС не держим (правило производительности).
"""
import asyncio
import logging
from datetime import date, datetime, timedelta

import httpx
from geoalchemy2.shape import to_shape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.redis import redis_client
from app.models.place import Place
from app.services.providers import Enrichment, dgis

logger = logging.getLogger("meili.enrich")

BUDGET_S = 3.0
REFRESH_AFTER = timedelta(days=30)
MISS_TTL = 30 * 24 * 3600          # «в 2ГИС не нашли» — месяц не спрашиваем
MAX_PARALLEL = 4
PRICE_WRITABLE = (None, "osm", "2gis")


def enabled() -> bool:
    return bool(settings.DGIS_API_KEY)


def in_dgis_coverage(lat: float, lon: float) -> bool:
    zones = settings.DGIS_COVERAGE
    return not zones or any(s <= lat <= n and w <= lon <= e for s, w, n, e in zones)


def _miss_key(place_id) -> str:
    return f"dgis:miss:{place_id}"


def needs_enrichment(place: Place, now: datetime) -> bool:
    if place.location is None:
        return False
    if place.enriched_at is not None and now - place.enriched_at < REFRESH_AFTER:
        return False
    point = to_shape(place.location)
    return in_dgis_coverage(point.y, point.x)


async def _take_quota(redis, n: int) -> int:
    """Сколько запросов можно сделать из суточного лимита (из n желаемых)."""
    key = f"dgis:quota:{date.today().isoformat()}"
    used = await redis.incrby(key, n)
    if used == n:
        await redis.expire(key, 2 * 24 * 3600)
    over = max(0, used - settings.DGIS_DAILY_LIMIT)
    return max(0, n - over)


def apply(place: Place, found: Enrichment, now: datetime, claim_id: bool = True) -> None:
    """Записать факты в место по правилам выше (без commit).

    claim_id=False — объект 2ГИС уже закреплён за другим местом (в OSM одно
    заведение бывает и точкой, и контуром): факты берём, id — нет."""
    if claim_id:
        place.dgis_id = found.provider_id
    place.enriched_at = now
    if found.rating is not None:
        place.rating = found.rating
        place.rating_count = found.rating_count
    if found.opening_hours and not place.opening_hours:
        place.opening_hours = found.opening_hours
    if found.currency and place.price_source in PRICE_WRITABLE:
        if found.avg_check is not None:
            place.pricing_model = "per_person"
            place.avg_check = found.avg_check
            place.price_currency = found.currency
            place.price_source = "2gis"
        if found.lodging_price_from is not None:
            place.lodging_price_from = found.lodging_price_from
            place.price_currency = place.price_currency or found.currency
            place.price_source = place.price_source or "2gis"


def _schedule_background(place_ids: list) -> None:
    """Недоделанное — в Celery (тесты подменяют, как summarize)."""
    from app.workers.dgis_enrich import enrich_places_task  # воркер импортирует нас

    enrich_places_task.delay([str(i) for i in place_ids])


async def enrich_places(
    db: AsyncSession, places: list[Place], *, budget_s: float | None = BUDGET_S,
    redis=None, background: bool = True,
) -> int:
    """Обогатить места, которым пора. → сколько записали. Commit — здесь же.

    budget_s=None — без бюджета (воркер). Ошибки 2ГИС не роняют поиск.
    """
    if not enabled() or not places:
        return 0
    redis = redis or redis_client
    now = datetime.utcnow()
    todo = [p for p in places if needs_enrichment(p, now)]
    if todo:
        misses = await redis.mget([_miss_key(p.id) for p in todo])
        todo = [p for p, miss in zip(todo, misses) if not miss]
    if not todo:
        return 0
    allowed = await _take_quota(redis, len(todo))
    if allowed < len(todo):
        logger.warning("dgis: суточный лимит, пропускаем %d мест", len(todo) - allowed)
    todo = todo[:allowed]
    if not todo:
        return 0

    # координаты/имена — до commit: дальше ждём сеть без соединения из пула
    targets = [(p, p.name, p.category, to_shape(p.location)) for p in todo]
    await db.commit()

    sem = asyncio.Semaphore(MAX_PARALLEL)
    async with httpx.AsyncClient(timeout=dgis.REQUEST_TIMEOUT_S) as client:
        async def one(name, category, point):
            async with sem:
                return await dgis.find(client, name, point.y, point.x, category)

        tasks = {asyncio.create_task(one(name, category, point)): place
                 for place, name, category, point in targets}
        done, pending = await asyncio.wait(tasks, timeout=budget_s)
        for task in pending:
            task.cancel()

    written, late = 0, [tasks[t].id for t in pending]
    results: list[tuple[Place, Enrichment | None]] = []
    for task in done:
        place = tasks[task]
        try:
            results.append((place, task.result()))
        except dgis.DgisUnavailable as e:
            logger.warning("dgis: %s не ответил: %s", place.name, e)
    # partial unique на dgis_id: занятые другими местами id не перезакрепляем
    ids = {f.provider_id for _, f in results if f is not None}
    owners = dict((await db.execute(
        select(Place.dgis_id, Place.id).where(Place.dgis_id.in_(ids))
    )).all()) if ids else {}
    for place, found in results:
        if found is None:
            await redis.setex(_miss_key(place.id), MISS_TTL, "1")
            place.enriched_at = now  # спросили — нет; не спрашиваем REFRESH_AFTER
            continue
        owner = owners.get(found.provider_id)
        claim = owner is None or owner == place.id
        apply(place, found, now, claim_id=claim)
        if claim:
            owners[found.provider_id] = place.id
        written += 1
    try:
        await db.commit()
    except Exception:  # noqa: BLE001 — сетка: поиск важнее обогащения
        logger.exception("dgis: запись обогащения не удалась")
        await db.rollback()
        for place in places:  # после rollback атрибуты протухли — поиску их ещё читать
            await db.refresh(place)
        return 0
    if late and background:
        try:
            _schedule_background(late)
        except Exception:  # noqa: BLE001 — брокер лёг: ход важнее фона
            logger.exception("dgis: не поставили фоновое обогащение")
    return written
