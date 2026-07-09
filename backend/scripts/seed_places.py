"""Сид реальных POI Калининграда через Overpass (S8 WP-2).

Идемпотентен: get-or-create по osm_id, повторный запуск не создаёт дублей.
Синтетических пользователей/лайков НЕ генерирует — только реальные места.

Запуск:  docker compose exec backend python -m scripts.seed_places
"""
import asyncio
from math import asin, cos, radians, sin, sqrt

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.place import Place
from app.schemas.places import PlaceCreate
from app.services.overpass import fetch_places_bbox
from app.services.places import create_place

# bbox Калининградской области: (юг, запад, север, восток)
KALININGRAD_BBOX = (54.30, 19.60, 55.35, 23.05)

# (OSM key, OSM value | None=любое, наша категория)
SEED_CATEGORIES = [
    ("tourism", "museum", "museum"),
    ("tourism", "attraction", "landmark"),
    ("amenity", "restaurant", "restaurant"),
    ("amenity", "cafe", "cafe"),
    ("leisure", "park", "park"),
    ("amenity", "theatre", "theatre"),
    ("historic", None, "historic"),  # смотровые/памятники: любой historic=*
]

CITY = "Калининград"


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(a))


async def _fetch_with_retry(key, value, bbox, attempts=4) -> list[dict]:
    """Overpass охотно отвечает 429 — ждём и повторяем."""
    import httpx

    for attempt in range(attempts):
        try:
            return await fetch_places_bbox(key, value, bbox)
        except httpx.HTTPStatusError as e:
            # 429 — rate limit, 5xx — перегруз/таймаут шлюза: ждём и повторяем
            retryable = e.response.status_code == 429 or e.response.status_code >= 500
            if retryable and attempt < attempts - 1:
                wait = 30 * (attempt + 1)
                print(f"  {e.response.status_code} от Overpass, жду {wait}с...")
                await asyncio.sleep(wait)
            else:
                raise
    return []


async def seed() -> tuple[int, int]:
    """Возвращает (добавлено, уже_было)."""
    added = existed = 0
    async with AsyncSessionLocal() as db:
        for key, value, category in SEED_CATEGORIES:
            pois = await _fetch_with_retry(key, value, KALININGRAD_BBOX)
            print(f"  {key}={value or '*'}: {len(pois)} POI из Overpass")
            for poi in pois:
                result = await db.execute(
                    select(Place.id).where(Place.osm_id == poi["osm_id"])
                )
                if result.scalar_one_or_none() is not None:
                    existed += 1
                    continue
                await create_place(
                    PlaceCreate(
                        name=poi["name"],
                        lat=poi["lat"],
                        lon=poi["lon"],
                        address=poi.get("address") or None,
                        city=CITY,
                        category=category,
                        osm_id=poi["osm_id"],
                    ),
                    db,
                )
                added += 1
            # щадим Overpass между категориями
            await asyncio.sleep(10)
    return added, existed


async def backfill_osm_ids() -> int:
    """Проставить osm_id старым местам: точное совпадение имени (без регистра)
    + расстояние < 250 м. Только уверенные совпадения."""
    filled = 0
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Place).where(Place.osm_id.is_(None)))
        orphans = result.scalars().all()
        if not orphans:
            return 0

        # тянем кандидатов по всем категориям одним проходом
        candidates: list[dict] = []
        for key, value, _ in SEED_CATEGORIES:
            candidates.extend(await _fetch_with_retry(key, value, KALININGRAD_BBOX))
            await asyncio.sleep(10)

        from geoalchemy2.shape import to_shape
        for place in orphans:
            if place.location is None:
                continue
            point = to_shape(place.location)
            for cand in candidates:
                if cand["name"].strip().lower() != place.name.strip().lower():
                    continue
                if _haversine_m(point.y, point.x, cand["lat"], cand["lon"]) < 250:
                    # проверяем, что этот osm_id ещё не занят другим местом
                    taken = await db.execute(
                        select(Place.id).where(Place.osm_id == cand["osm_id"])
                    )
                    if taken.scalar_one_or_none() is None:
                        place.osm_id = cand["osm_id"]
                        filled += 1
                    break
        await db.commit()
    return filled


async def main():
    print("Сид POI Калининграда (Overpass)...")
    added, existed = await seed()
    print(f"Готово: добавлено {added}, уже было {existed}")

    print("Бэкфилл osm_id для старых мест...")
    filled = await backfill_osm_ids()
    print(f"Проставлено osm_id: {filled}")


if __name__ == "__main__":
    asyncio.run(main())
