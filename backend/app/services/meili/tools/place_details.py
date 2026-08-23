"""Read-tool: детали места (ТЗ-Meili M2.5).

Описание приходит из внешних источников (OSM/пользователи), поэтому
оборачивается как ДАННЫЕ (правило 1.10): системный промпт запрещает
исполнять инструкции из полей, помеченных external_data.
"""
from datetime import datetime
from uuid import UUID

from geoalchemy2.shape import to_shape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.place import Place
from app.services.meili.pricing import resolve_price
from app.services.places.opening import is_open_at


async def get_place_details(db: AsyncSession, now: datetime, place_id: str) -> dict:
    try:
        pid = UUID(place_id)
    except ValueError:
        return {"error": "place_not_found"}
    place = (await db.execute(select(Place).where(Place.id == pid))).scalar_one_or_none()
    if place is None:
        return {"error": "place_not_found"}

    lat = lon = None
    if place.location is not None:
        point = to_shape(place.location)
        lat, lon = point.y, point.x

    price = await resolve_price(place)  # ценовой гибрид (M5.1)
    return {
        "place_id": str(place.id),
        "name": place.name,
        "category": place.category,
        "address": place.address,
        "lat": lat,
        "lon": lon,
        "opening_hours": place.opening_hours,       # сырые часы
        "is_open_now": is_open_at(place.opening_hours, now),
        "price": price.label,
        "price_is_estimate": price.is_estimate,
        "price_level": place.price_level,
        "duration_minutes": place.duration_minutes,
        "suitable_for_children": place.suitable_for_children,
        # внешний текст — data-plane, не инструкции (правило 1.10)
        "description": {
            "external_data": True,
            "text": place.description or "",
        },
    }
