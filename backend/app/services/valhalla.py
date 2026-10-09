"""Валхалла: единственное место, где режим транспорта превращается в costing.

S16 §1.6: маппинг TransportMode -> costing живёт здесь и нигде не дублируется.
Здесь же расчёт маршрута дня по перегонам: у каждого перегона свой costing
(из transport_to_next точки-источника), поэтому соседние перегоны с одинаковым
costing склеиваются в один запрос к Valhalla, а разные — идут отдельными.
"""
import hashlib
import json
import logging

import httpx

from app.core.config import settings
from app.models.enums import DEFAULT_TRANSPORT, TransportMode

VALHALLA_COSTING: dict[TransportMode, str] = {
    TransportMode.WALKING: "pedestrian",
    TransportMode.DRIVING: "auto",
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


logger = logging.getLogger("meili.valhalla")

# Ревью (нагрузка): Valhalla — потолок всего API (~70 маршрутов/с на 10
# потоках), а маршрут дня — самый повторяемый запрос: его заново считали на
# каждое открытие планировщика (и дважды — карта и панель дня). Одинаковые
# точки → одинаковый ответ: кэш по хешу тела запроса. 6 ч — тайлы
# обновляются раз в месяц, пробки мы не учитываем.
CACHE_TTL_SECONDS = 6 * 3600


async def cached_post(action: str, body: dict, slim=None) -> dict:
    """POST в Valhalla с кэшем в Redis (best effort: Redis лёг — просто идём в Valhalla).

    slim(data) → только нужные поля: их и кладём в кэш, и отдаём (одинаково
    с кэшем и без). Ревью: ответ /route целиком — ~200 КБ (манёвры, тексты
    инструкций); Redis общий с сессиями и очередью Celery и вытесняет по LRU —
    раздутый кэш выбрасывал бы refresh-токены. Неуспешный ответ не кэшируется:
    бросаем httpx.HTTPStatusError.
    """
    from app.core.redis import redis_client  # поздний импорт: модуль нужен и без Redis

    digest = hashlib.sha1(json.dumps(body, sort_keys=True).encode()).hexdigest()
    key = f"valhalla:{action}:{digest}"
    try:
        cached = await redis_client.get(key)
        if cached:
            return json.loads(cached)
    except Exception as e:  # noqa: BLE001
        logger.warning("кэш Valhalla недоступен: %s", e)
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(f"{settings.VALHALLA_URL}/{action}", json=body)
        response.raise_for_status()
        data = response.json()
    if slim is not None:
        data = slim(data)
    try:
        await redis_client.setex(key, CACHE_TTL_SECONDS, json.dumps(data))
    except Exception:  # noqa: BLE001
        pass
    return data


def _slim_route(data: dict) -> dict:
    """Из ответа /route — только то, что читает route_legs (время, длина, линия)."""
    return {"trip": {"legs": [
        {"summary": {k: leg.get("summary", {}).get(k) for k in ("time", "length")},
         "shape": leg.get("shape", "")}
        for leg in data.get("trip", {}).get("legs", [])
    ]}}


def slim_matrix(data: dict) -> dict:
    """Из ответа /sources_to_targets — только времена (оптимизатору больше не нужно)."""
    return {"sources_to_targets": [
        [{"time": cell.get("time")} for cell in row] for row in data.get("sources_to_targets", [])
    ]}


async def _route_call(points: list[dict], costing: str) -> list[dict]:
    """Один запрос к Valhalla; возвращает legs ответа (их len(points)-1)."""
    body = {
        "locations": [{"lat": p["lat"], "lon": p["lon"]} for p in points],
        "costing": costing,
        "directions_options": {"units": "kilometers"},
    }
    try:
        data = await cached_post("route", body, slim=_slim_route)
    except httpx.HTTPStatusError as e:
        raise RouteError(f"valhalla {e.response.status_code}") from e
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
