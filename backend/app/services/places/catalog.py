"""Каталог мест без границ: город по названию + автозаполнение из OSM.

Раньше каталог был равен сиду Калининградской области (scripts/seed_places.py),
а «город» для Meili — справочнику её 25 городов. За пределами области
ассистент был пустым: «музеи в Берлине» он принимал за ориентир «Берлин»,
не находил его и честно отвечал «ничего нет».

Теперь:
- resolve_city — город по названию. Сначала база (места с таким city —
  центр по ним, без сети), потом геокодер (Nominatim, кэш в Redis).
- ensure_city_catalog — если вокруг города в каталоге пусто, один раз
  подтягиваем POI из Overpass (те же категории, что у сида) и пишем в
  places. Факты по-прежнему от системы (§0 ТЗ-Meili): места — из OSM,
  модель их только компонует.

Всё сетевое — best effort: недоступный геокодер/Overpass не роняет ход
ассистента, просто ищем по тому, что уже есть в базе.
"""
import json
import logging
import time
from dataclasses import dataclass

import httpx
from geoalchemy2 import Geography
from geoalchemy2.functions import ST_DWithin, ST_MakePoint, ST_SetSRID, ST_X, ST_Y
from sqlalchemy import cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.redis import redis_client
from app.models.place import Place
from app.services.overpass import OVERPASS_URL, parse_overpass_response
from app.services.places.geo import haversine_m

logger = logging.getLogger("meili.catalog")

# Nominatim usage policy: внятный User-Agent обязателен
USER_AGENT = "Hermod/1.0 (travel planner pet project)"
# адресные типы Nominatim, которые считаем «городом» (а не районом/местом)
SETTLEMENT_TYPES = {"city", "town", "village", "hamlet", "municipality", "borough"}

CITY_CACHE_TTL = 30 * 24 * 3600   # города не переезжают
CITY_MISS_TTL = 24 * 3600         # «не город» — перепроверим завтра
# радиус «в городе», когда у геокодера нет границ
DEFAULT_CITY_RADIUS_M = 15_000
# город известен только по местам в базе: там city надёжен и сам по себе,
# радиус лишь подбирает места без адреса — держим его малым, иначе в
# Светлогорск попадал бы соседний Пионерский (5 км) без пометки «не тут»
CATALOG_CITY_RADIUS_M = 5_000
MIN_CITY_RADIUS_M, MAX_CITY_RADIUS_M = 3_000, 25_000

# автозаполнение: меньше стольких мест вокруг города — каталог считаем пустым
MIN_AREA_PLACES = 40
# Overpass-радиус: у Москвы bbox 50 км, но тянуть всю агломерацию незачем
MAX_FETCH_RADIUS_M = 12_000
AREA_DONE_TTL = 30 * 24 * 3600    # заполнили — месяц не трогаем
AREA_PARTIAL_TTL = 600            # часть категорий не пришла — дотянем скоро
AREA_FAIL_TTL = 3600              # Overpass лёг — не долбим его каждым ходом
AREA_LOCK_TTL = 120
# Живой прогон по Москве: один запрос на 7 категорий × 12 км публичный
# Overpass отбивает 504 (оценка стоимости под нагрузкой), лёгкий проходит.
# Поэтому по категории за запрос и общий бюджет — ход Meili не ждёт вечно
FETCH_BUDGET_S = 30.0
CATEGORY_TIMEOUT_S = 20.0

# (OSM key, value | None = любое, наша категория, кап) — категории сида +
# кап на категорию: в Париже одних кафе тысячи, а модели хватит сотни
CATALOG_CATEGORIES: list[tuple[str, str | None, str, int]] = [
    ("tourism", "museum", "museum", 60),
    ("tourism", "attraction", "landmark", 80),
    ("amenity", "restaurant", "restaurant", 120),
    ("amenity", "cafe", "cafe", 120),
    ("leisure", "park", "park", 60),
    ("amenity", "theatre", "theatre", 30),
    ("historic", None, "historic", 80),
]

# тесты подменяют фабрику на свою БД; ход Meili свою транзакцию не делит
session_factory = AsyncSessionLocal


class GeocoderUnavailable(Exception):
    """Геокодер не ответил — «не знаем», а не «это не город»."""


@dataclass(frozen=True)
class CityRef:
    name: str
    lat: float
    lon: float
    radius_m: int = DEFAULT_CITY_RADIUS_M


def _radius_from_bbox(bbox: list) -> int:
    """Полудиагональ boundingbox Nominatim [south, north, west, east]."""
    try:
        south, north, west, east = (float(v) for v in bbox)
    except (TypeError, ValueError):
        return DEFAULT_CITY_RADIUS_M
    half = haversine_m(south, west, north, east) / 2
    return int(max(MIN_CITY_RADIUS_M, min(MAX_CITY_RADIUS_M, half)))


async def geocode_city(name: str) -> CityRef | None:
    """Населённый пункт по названию через Nominatim. None — это не город.

    Бросает GeocoderUnavailable, если сервис не ответил (тогда вызывающий
    оставит город как есть, без координат, а не сочтёт его ориентиром).
    """
    key = f"geo:city:{name.strip().lower()}"
    cached = await redis_client.get(key)
    if cached is not None:
        data = json.loads(cached)
        return CityRef(**data) if data else None

    params = {
        "q": name.strip(), "format": "json", "limit": "5",
        # только населённые пункты: «Рыбная деревня» (квартал) городом не станет
        "featureType": "settlement",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"{settings.NOMINATIM_URL}/search", params=params,
                headers={"User-Agent": USER_AGENT},
            )
            r.raise_for_status()
            hits = r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise GeocoderUnavailable(str(e)) from e

    city = None
    for hit in hits if isinstance(hits, list) else []:
        if hit.get("addresstype") in SETTLEMENT_TYPES or hit.get("class") == "place":
            city = CityRef(
                name=hit.get("name") or name.strip(),
                lat=float(hit["lat"]), lon=float(hit["lon"]),
                radius_m=_radius_from_bbox(hit.get("boundingbox")),
            )
            break
    payload = json.dumps(city.__dict__ if city else None)
    await redis_client.setex(key, CITY_CACHE_TTL if city else CITY_MISS_TTL, payload)
    return city


async def _city_from_catalog(db: AsyncSession, name: str) -> CityRef | None:
    """Город, который каталог уже знает: центр — среднее по его местам."""
    row = (await db.execute(
        select(func.count(), func.avg(ST_Y(Place.location)), func.avg(ST_X(Place.location)))
        .where(func.lower(Place.city) == name.strip().lower(), Place.location.is_not(None))
    )).one()
    count, lat, lon = row
    if not count:
        return None
    return CityRef(name=name.strip(), lat=float(lat), lon=float(lon),
                   radius_m=CATALOG_CITY_RADIUS_M)


async def resolve_city(db: AsyncSession, name: str | None) -> CityRef | None:
    """Город по названию: каталог → геокодер. None — это не город (ориентир).

    GeocoderUnavailable пробрасывается: «не знаем» ≠ «не город».
    """
    if not name or not name.strip():
        return None
    return await _city_from_catalog(db, name) or await geocode_city(name)


def _area_key(city: CityRef) -> str:
    # ~1 км сетка: один и тот же город под разными названиями — одна область
    return f"catalog:area:{city.lat:.2f}:{city.lon:.2f}"


def _build_area_query(lat: float, lon: float, radius: int, categories=None) -> str:
    """Запрос по категориям: свой out с капом у каждой."""
    blocks = []
    for key, value, _, cap in categories or CATALOG_CATEGORIES:
        selector = f'["{key}"="{value}"]' if value else f'["{key}"]'
        around = f"(around:{radius},{lat},{lon})"
        blocks.append(
            f'(node{selector}["name"]{around};way{selector}["name"]{around};);\n'
            f"out center tags {cap};"
        )
    return "[out:json][timeout:25];\n" + "\n".join(blocks)


def _category_of(tags: dict) -> str | None:
    for key, value, category, _ in CATALOG_CATEGORIES:
        if key in tags and (value is None or tags[key] == value):
            return category
    return None


def _pois_from_overpass(data: dict) -> list[dict]:
    by_id = {f"{el['type']}/{el['id']}": el.get("tags", {}) for el in data.get("elements", [])}
    pois = []
    for poi in parse_overpass_response(data):
        category = _category_of(by_id.get(poi["osm_id"], {}))
        if category:
            pois.append({**poi, "category": category})
    return pois


async def _fetch_area(lat: float, lon: float, radius: int) -> tuple[list[dict], bool]:
    """POI вокруг точки по категории за запрос → (места, все ли категории пришли).

    Упавшая категория не роняет остальные; бюджет времени общий.
    """
    loop_start = time.monotonic()
    pois, complete = [], True
    async with httpx.AsyncClient(timeout=CATEGORY_TIMEOUT_S) as client:
        for category in CATALOG_CATEGORIES:
            if time.monotonic() - loop_start > FETCH_BUDGET_S:
                complete = False
                break
            try:
                r = await client.post(
                    OVERPASS_URL, data={"data": _build_area_query(lat, lon, radius, [category])},
                    headers={"User-Agent": USER_AGENT},
                )
                r.raise_for_status()
                pois += _pois_from_overpass(r.json())
            except (httpx.HTTPError, ValueError) as e:
                logger.warning("Overpass: категория %s не пришла: %s", category[2], e)
                complete = False
    return pois, complete


async def add_pois(db: AsyncSession, pois: list[dict], default_city: str | None) -> int:
    """Get-or-create по osm_id пачкой (без commit). → сколько добавлено.

    Общая точка автозаполнения (Overpass) и сида региона из pbf.
    """
    ids = [p["osm_id"] for p in pois]
    known = set((await db.execute(
        select(Place.osm_id).where(Place.osm_id.in_(ids))
    )).scalars().all()) if ids else set()
    added = 0
    for poi in pois:
        if poi["osm_id"] in known:
            continue
        known.add(poi["osm_id"])  # node и way одного места — разные id, это ок
        db.add(Place(
            name=poi["name"],
            category=poi["category"],
            address=poi.get("address") or None,
            # addr:city из OSM, иначе город, ради которого тянули
            city=poi.get("city") or default_city,
            osm_id=poi["osm_id"],
            location=ST_SetSRID(ST_MakePoint(poi["lon"], poi["lat"]), 4326),
        ))
        added += 1
    return added


async def _area_place_count(db: AsyncSession, city: CityRef) -> int:
    point = ST_SetSRID(ST_MakePoint(city.lon, city.lat), 4326)
    return (await db.execute(
        select(func.count()).select_from(Place).where(ST_DWithin(
            cast(Place.location, Geography), cast(point, Geography), city.radius_m,
        ))
    )).scalar_one()


async def ensure_city_catalog(city: CityRef) -> int:
    """Подтянуть места вокруг города, если каталог там пуст. → сколько добавлено.

    Идемпотентно и дёшево на повторах: метка области в Redis (месяц), лок от
    параллельных ходов, get-or-create по osm_id. Пишем своей сессией и своим
    commit'ом — каталог общий, к транзакции хода он не относится.
    """
    marker = _area_key(city)
    if await redis_client.exists(marker):
        return 0
    async with session_factory() as db:
        if await _area_place_count(db, city) >= MIN_AREA_PLACES:
            await redis_client.setex(marker, AREA_DONE_TTL, "1")
            return 0
        lock = f"{marker}:lock"
        if not await redis_client.set(lock, "1", nx=True, ex=AREA_LOCK_TTL):
            return 0  # соседний ход уже заполняет — не дублируем запрос
        try:
            radius = min(city.radius_m, MAX_FETCH_RADIUS_M)
            pois, complete = await _fetch_area(city.lat, city.lon, radius)
            if not pois and not complete:
                logger.warning("Overpass недоступен для %s", city.name)
                await redis_client.setex(marker, AREA_FAIL_TTL, "fail")
                return 0
            added = await add_pois(db, pois, city.name)
            await db.commit()
            await redis_client.setex(
                marker, AREA_DONE_TTL if complete else AREA_PARTIAL_TTL,
                "1" if complete else "partial",
            )
            logger.info("каталог %s: +%d мест%s", city.name, added, "" if complete else " (частично)")
            return added
        finally:
            await redis_client.delete(lock)

