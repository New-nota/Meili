from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from geoalchemy2.functions import ST_MakePoint, ST_SetSRID, ST_X, ST_Y
from geoalchemy2.shape import to_shape

from app.models.place import Place
from app.schemas.places import PlaceCreate

async def create_place(data: PlaceCreate, db: AsyncSession, user_id=None) -> dict:
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
    }
    if place.location is not None:
        point = to_shape(place.location)
        result["lon"] = point.x
        result["lat"] = point.y 
    
    return result