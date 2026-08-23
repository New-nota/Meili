"""Валхалла: единственное место, где режим транспорта превращается в costing.

S16 §1.6: маппинг TransportMode -> costing живёт здесь и нигде не дублируется.
Здесь же расчёт маршрута дня по перегонам: у каждого перегона свой costing
(из transport_to_next точки-источника), поэтому соседние перегоны с одинаковым
costing склеиваются в один запрос к Valhalla, а разные — идут отдельными.
"""
import httpx

from app.core.config import settings
from app.models.enums import DEFAULT_TRANSPORT, TransportMode

VALHALLA_COSTING: dict[TransportMode, str] = {
    TransportMode.WALKING: "pedestrian",
    TransportMode.DRIVING: "auto",
    TransportMode.TRANSIT: "multimodal",
}


class RouteError(Exception):
    """Valhalla не смог построить маршрут (вне покрытия/недоступна)."""


def to_mode(value: str | None) -> TransportMode:
    """Строка из БД -> режим. Мусор и None превращаются в дефолт."""
    try:
        return TransportMode(value)
    except ValueError:
        return DEFAULT_TRANSPORT


def costing_for(value: str | None) -> str:
    return VALHALLA_COSTING[to_mode(value)]


async def _route_call(points: list[dict], costing: str) -> list[dict]:
    """Один запрос к Valhalla; возвращает legs ответа (их len(points)-1)."""
    body = {
        "locations": [{"lat": p["lat"], "lon": p["lon"]} for p in points],
        "costing": costing,
        "directions_options": {"units": "kilometers"},
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(f"{settings.VALHALLA_URL}/route", json=body)
        if not response.is_success:
            raise RouteError(f"valhalla {response.status_code}")
        data = response.json()
    return data.get("trip", {}).get("legs", [])


async def route_legs(points: list[dict]) -> list[dict]:
    """Перегоны маршрута дня.

    points: [{lat, lon, mode}] — mode задаёт costing перегона ОТ этой точки
    к следующей (у последней точки mode не используется).
    Возвращает len(points)-1 словарей: duration_seconds, distance_meters,
    costing (значение TransportMode), geometry (encoded polyline).
    """
    if len(points) < 2:
        return []

    legs: list[dict] = []
    # склейка соседних перегонов с одинаковым режимом в один запрос
    start = 0
    while start < len(points) - 1:
        mode = to_mode(points[start].get("mode"))
        end = start + 1
        while end < len(points) - 1 and to_mode(points[end].get("mode")) is mode:
            end += 1
        chunk = points[start:end + 1]
        raw_legs = await _route_call(chunk, VALHALLA_COSTING[mode])
        if len(raw_legs) != len(chunk) - 1:
            raise RouteError("valhalla returned unexpected legs count")
        for leg in raw_legs:
            summary = leg.get("summary", {})
            legs.append({
                "duration_seconds": int(summary.get("time", 0)),
                # units=kilometers -> length в км, наружу отдаём метры
                "distance_meters": int(round(summary.get("length", 0) * 1000)),
                "costing": mode.value,
                "geometry": leg.get("shape", ""),
            })
        start = end
    return legs
