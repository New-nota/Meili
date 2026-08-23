"""Read-tool: поиск мест (ТЗ-Meili M2.4).

Ищет по БД мест (сид Overpass + пользовательские). Каждый результат
аннотируется фактами, посчитанными системой: is_open_now (is_open_at + время
юзера) и ценовая метка (реальные цены ТЗ-E / price_level). Модель получает
факты готовыми и не выдумывает их.
"""
from datetime import datetime

from geoalchemy2 import Geography
from geoalchemy2.functions import ST_DWithin, ST_MakePoint, ST_SetSRID
from sqlalchemy import cast, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.place import Place
from app.services.meili.pricing import resolve_price
from app.services.places.opening import is_open_at

MAX_RESULTS = 8


async def search_places(
    db: AsyncSession,
    now: datetime,
    query: str,
    category: str | None = None,
    near: dict | None = None,        # {"lat": .., "lon": ..}
    radius: int | None = None,       # метры, с near
    day: str | None = None,          # ISO-дата: открытость смотрим в полдень этого дня
) -> list[dict]:
    stmt = select(Place)
    if query:
        pattern = f"%{query}%"
        stmt = stmt.where(or_(Place.name.ilike(pattern), Place.description.ilike(pattern)))
    if category:
        stmt = stmt.where(Place.category == category)
    if near and "lat" in near and "lon" in near:
        # geography-каст: радиус в метрах, не в градусах
        point = ST_SetSRID(ST_MakePoint(near["lon"], near["lat"]), 4326)
        stmt = stmt.where(ST_DWithin(
            cast(Place.location, Geography), cast(point, Geography), radius or 1000,
        ))
    places = (await db.execute(stmt.limit(MAX_RESULTS))).scalars().all()

    at = now
    if day:
        try:
            at = datetime.fromisoformat(day).replace(hour=12, minute=0)
        except ValueError:
            pass

    results = []
    for p in places:
        open_now = is_open_at(p.opening_hours, at)
        price = await resolve_price(p)  # ценовой гибрид (M5.1)
        results.append({
            "place_id": str(p.id),
            "name": p.name,
            "category": p.category,
            "address": p.address,
            "is_open_now": open_now,  # true/false/null («не знаем»)
            "price": price.label,
            "price_is_estimate": price.is_estimate,
            "duration_minutes": p.duration_minutes,
        })
    return results
