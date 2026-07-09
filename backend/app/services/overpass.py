import httpx
import json
from app.core.redis import redis_client

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
CACHE_TTL_SECONDS = 24 * 3600  # сутки: POI меняются редко, Overpass просит щадить
# маппинг наших категорий в OSM теги тк он(OSM) использует свои теги
CATEGORY_TO_OSM = {
    "museum": ("tourism", "museum"),
    "restaurant": ("amenity", "restaurant"),
    "cafe": ("amenity", "cafe"),
    "park": ("leisure", "park"),
    "landmark": ("tourism", "attraction"),
    "hotel": ("tourism", "hotel"),
    "church": ("amenity", "place_of_worship"),
    "shop": ("shop", "mall"),
}

def build_overpass_query(lat: float, lon: float, radius: int, category: str) -> str:
    # cтроим на OVERPASS QL(спец язык запросов для OSM данных) запрос
    key, value = CATEGORY_TO_OSM.get(category, ("tourism", "attraction"))
    # node точечные объекты (музеи кафе рестораны)
    # way линейные (парки здания )
    # around:radius,lat,lon в радиусе от точки
    return f"""
    [out:json][timeout:25];
    (
    node["{key}"= "{value}"](around:{radius},{lat},{lon});
    way["{key}"= "{value}"](around:{radius},{lat},{lon});
    );
    out center tags;
"""

def parse_overpass_response(data:dict) -> list[dict]:
    # преобразуем ответ overpass под наш формат
    places = []
    for element in data.get("elements", []):
        tags = element.get("tags", {})
        if element["type"] == "way":
            center = element.get("center", {})
            lat = center.get("lat")
            lon = center.get("lon")
        else:
            lat = element.get("lat")
            lon = element.get("lon")
        name = tags.get("name") or tags.get("name:ru") or tags.get("name:en")
        if not name or not lat or not lon:
            continue
        places.append({
            "osm_id": str(element["id"]),
            "name": name,
            "lat": lat,
            "lon": lon,
            "address": tags.get("addr:street", ""),
            "opening_hours": tags.get("opening_hours"),
            "website": tags.get("website"),
        })
    return places


async def search_places_overpass(
        lat: float,
        lon: float,
        radius: int,
        category: str,
) -> list[dict]:
    # поиск места через Overpass с кэшем в redis, 
    # ключ кэша включает все параметры запроса одинаковые запросы дают одинаковый ключ
    cache_key = f"overpass:{category}:{lat:.4f}:{lon:.4f}:{radius}"

    cached = await redis_client.get(cache_key)
    if cached:
        return json.loads(cached) # если запрос был - отдаем из памяти
    query = build_overpass_query(lat, lon, radius, category)
    # если нет запрашиваем у overpass
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            OVERPASS_URL, params={"data":query}, 
            headers={"Accept":"*/*", "User-Agent":"WanderOwn/1.0"})
        response.raise_for_status()
        data = response.json()
    places = parse_overpass_response(data)
    # сохраняем кэш
    await redis_client.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(places))

    return places