from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from geoalchemy2.functions import ST_MakePoint, ST_SetSRID
from geoalchemy2.shape import to_shape

from app.models.place import Place
from app.schemas.places import PlaceCreate

async def create_place(data: PlaceCreate, db: AsyncSession, user_id=None) -> dict:
    """Get-or-create (S8 WP-2): если osm_id задан и место уже есть —
    возвращаем существующее, дубль не создаётся."""
    if data.osm_id:
        result = await db.execute(select(Place).where(Place.osm_id == data.osm_id))
        existing = result.scalar_one_or_none()
        if existing is not None:
            return place_to_dict(existing)

    place_data = data.model_dump(exclude={"lat","lon"})
    if data.lat is not None and data.lon is not None:
        place_data["location"] = ST_SetSRID(ST_MakePoint(data.lon, data.lat), 4326)
    place = Place(**place_data, created_by=user_id)
    db.add(place)
    await db.commit()
    await db.refresh(place)
    return place_to_dict(place)

def place_to_dict(place: Place)-> dict:
    result = {
        "id": place.id,
        "name": place.name,
        "description": place.description,
        "category": place.category,
        "address": place.address,
        "city": place.city,
        "country": place.country,
        "lat": None,
        "lon": None,
        "rating": place.rating,
        "duration_minutes": place.duration_minutes,
        "tags": place.tags,
        "osm_id": place.osm_id,
        "is_verified": place.is_verified,
        "opening_hours": place.opening_hours,  # ТЗ-Meili M2.4
        # ТЗ-E: цены для авто-оценки бюджета
        "pricing_model": place.pricing_model,
        "avg_check": place.avg_check,
        "ticket_adult": place.ticket_adult,
        "ticket_child": place.ticket_child,
        "price_currency": place.price_currency,
    }
    if place.location is not None:
        point = to_shape(place.location)
        result["lon"] = point.x
        result["lat"] = point.y 
    
    return result