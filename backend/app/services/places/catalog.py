"""Каталог мест без границ: город по названию + автозаполнение из OSM.

Раньше каталог был равен сиду Калининградской области (scripts/seed_places.py),
а «город» для Meili — справочнику её 25 городов. За пределами области
ассистент был пустым: «музеи в Берлине» он принимал за ориентир «Берлин»,
не находил его и честно отвечал «ничего нет».

Теперь:
- resolve_city — город по названию. Сначала база (места с таким city —
  центр по ним, без сети), потом геокодер (Nominatim, кэш в Redis).
- ensure_city_catalog — если вокруг города мало мест спрошенной категории,
  тянем её из Overpass прямо в ходе, а остальные категории дозаполняет
  Celery (meili_upgrade: раньше метка была одна на область, и категория,
  которой не было при первом заполнении, не приходила никогда). Факты по-прежнему от системы (§0 ТЗ-Meili): места — из OSM,
  модель их только компонует.

Всё сетевое — best effort: недоступный геокодер/Overpass не роняет ход
ассистента, просто ищем по тому, что уже есть в базе.
"""
import json
import logging
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
from app.services.places.opening import parse_osm_hours

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

# meili_upgrade: заполнение — по парам «область × категория». Раньше метка
# ставилась на всю область по общему числу мест (>= 40), и в Москве с её
# 16 тыс. кафе отели не дотянулись бы никогда. Теперь мало мест ЭТОЙ
# категории вокруг города — тянем именно её.
MIN_CATEGORY_PLACES = 5
# Overpass-радиус: у Москвы bbox 50 км, но тянуть всю агломерацию незачем
MAX_FETCH_RADIUS_M = 12_000
AREA_DONE_TTL = 30 * 24 * 3600    # заполнили — месяц не трогаем
# Overpass лёг — не долбим его каждым ходом. Живой смоук: час был слишком
# долго — один 429 из-за нашего же всплеска делал город пустым на час
AREA_FAIL_TTL = 300
AREA_LOCK_TTL = 120
# фоновое дозаполнение остальных категорий ставим не чаще раза в 10 минут
AREA_QUEUED_TTL = 600
# Живой прогон по Москве: один запрос на 7 категорий × 12 км публичный
# Overpass отбивает 504 (оценка стоимости под нагрузкой), лёгкий проходит.
# Поэтому по категории за запрос; в ходе — только спрошенная категория
CATEGORY_TIMEOUT_S = 20.0
# версия меток: смена списка категорий не должна упираться в старые метки
MARKER_VERSION = "v2"

# (OSM key, value | (values…) | None = любое, наша категория, кап). Одна наша
# категория может собираться из нескольких записей (museum = музеи + галереи).
# Порядок важен для _category_of: historic — последним (у музея-усадьбы есть
# и tourism=museum, и historic=manor — это музей). fast_food не берём: в
# мегаполисе это тысячи точек, они забивали бы выдачу «где поесть».
CATALOG_CATEGORIES: list[tuple[str, str | tuple[str, ...] | None, str, int]] = [
    ("tourism", ("hotel", "hostel", "guest_house", "apartment", "motel"), "hotel", 100),
    ("tourism", "museum", "museum", 60),
    ("tourism", "gallery", "museum", 30),
    ("tourism", "attraction", "landmark", 80),
    ("tourism", ("zoo", "aquarium", "theme_park"), "attraction", 20),
    ("tourism", "viewpoint", "viewpoint", 30),
    ("amenity", "restaurant", "restaurant", 120),
    ("amenity", "cafe", "cafe", 120),
    ("amenity", ("bar", "pub"), "bar", 80),
    ("leisure", "park", "park", 60),
    ("amenity", "theatre", "theatre", 30),
    ("natural", "beach", "beach", 30),
    ("shop", "mall", "shopping", 30),
    ("amenity", "marketplace", "shopping", 20),
    ("historic", None, "historic", 80),
]
# наши категории в порядке первого появления
CATEGORIES: list[str] = list(dict.fromkeys(c for _, _, c, _ in CATALOG_CATEGORIES))
# категория, которую тянем в ходе, если модель искала без категории
DEFAULT_SYNC_CATEGORY = "landmark"

# тесты подменяют фабрику на свою БД; ход Meili свою транзакцию не делит
session_factory = AsyncSessionLocal


class OverpassBusy(Exception):
    """Overpass ответил 429: дальше в этот заход не стучимся (фон останавливается)."""


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


def _area_key(city: CityRef, category: str) -> str:
    # ~1 км сетка: один и тот же город под разными названиями — одна область
    return f"catalog:{MARKER_VERSION}:{city.lat:.2f}:{city.lon:.2f}:{category}"


def _osm_selector(key: str, value) -> str:
    if value is None:
        return f'["{key}"]'
    if isinstance(value, tuple):
        return f'["{key}"~"^({"|".join(value)})$"]'
    return f'["{key}"="{value}"]'


def osmium_filters() -> str:
    """Фильтр osmium tags-filter из тех же категорий (seed_region_pois.sh)."""
    parts = []
    for key, value, _, _ in CATALOG_CATEGORIES:
        if value is None:
            parts.append(f"nwr/{key}")
        else:
            values = value if isinstance(value, tuple) else (value,)
            parts.append(f"nwr/{key}={','.join(values)}")
    return " ".join(parts)


def _entries(category: str | None):
    return [e for e in CATALOG_CATEGORIES if category is None or e[2] == category]


def _build_area_query(lat: float, lon: float, radius: int, categories=None) -> str:
    """Запрос по категориям: свой out с капом у каждой."""
    blocks = []
    for key, value, _, cap in categories or CATALOG_CATEGORIES:
        selector = _osm_selector(key, value)
        around = f"(around:{radius},{lat},{lon})"
        blocks.append(
            f'(node{selector}["name"]{around};way{selector}["name"]{around};);\n'
            f"out center tags {cap};"
        )
    return "[out:json][timeout:25];\n" + "\n".join(blocks)


def _entry_of(tags: dict):
    for entry in CATALOG_CATEGORIES:
        key, value, _, _ = entry
        if key not in tags:
            continue
        if value is None or tags[key] == value or (isinstance(value, tuple) and tags[key] in value):
            return entry
    return None


def _category_of(tags: dict) -> str | None:
    entry = _entry_of(tags)
    return entry[2] if entry else None


MAX_TAGS = 8


def poi_extras(tags: dict) -> dict:
    """Факты из OSM-тегов, которые раньше выкидывались (meili_upgrade).

    - opening_hours -> наш формат (или None, если синтаксис сложный);
    - fee=no -> pricing_model free (иначе «не знаем», а не 0);
    - подтип (hostel, pub, zoo…), stars, cuisine -> places.tags: Meili может
      фильтровать по ним, но цену из них не выводит.
    """
    entry = _entry_of(tags)
    marks: list[str] = []
    if entry and isinstance(entry[1], tuple):
        marks.append(tags[entry[0]])           # подтип: hostel / pub / zoo
    stars = (tags.get("stars") or "").strip()
    if stars[:1].isdigit():
        marks.append(f"stars:{stars[:1]}")
    for cuisine in (tags.get("cuisine") or "").split(";"):
        cuisine = cuisine.strip().lower()
        if cuisine:
            marks.append(f"cuisine:{cuisine}")
    return {
        "opening_hours": parse_osm_hours(tags.get("opening_hours")),
        "pricing_model": "free" if (tags.get("fee") or "").strip().lower() == "no" else None,
        "tags": marks[:MAX_TAGS] or None,
    }


def _pois_from_overpass(data: dict) -> list[dict]:
    by_id = {f"{el['type']}/{el['id']}": el.get("tags", {}) for el in data.get("elements", [])}
    pois = []
    for poi in parse_overpass_response(data):
        tags = by_id.get(poi["osm_id"], {})
        category = _category_of(tags)
        if category:
            pois.append({**poi, "category": category, **poi_extras(tags)})
    return pois


async def _fetch_category(lat: float, lon: float, radius: int, category: str) -> list[dict]:
    """POI одной нашей категории вокруг точки — один запрос Overpass.

    Бросает httpx.HTTPError / ValueError: решает вызывающий."""
    async with httpx.AsyncClient(timeout=CATEGORY_TIMEOUT_S) as client:
        r = await client.post(
            OVERPASS_URL, data={"data": _build_area_query(lat, lon, radius, _entries(category))},
            headers={"User-Agent": USER_AGENT},
        )
        r.raise_for_status()
        return _pois_from_overpass(r.json())


# поля из OSM-тегов, которые дописываем уже известным местам, если пусто
_EXTRA_FIELDS = ("opening_hours", "tags")


async def add_pois(db: AsyncSession, pois: list[dict], default_city: str | None) -> int:
    """Get-or-create по osm_id пачкой (без commit). → сколько добавлено.

    Общая точка автозаполнения (Overpass) и сида региона из pbf. Уже
    известному месту дописываем часы/теги/«бесплатно» — только если поле
    пустое: ручную правку через PATCH /places не затираем (meili_upgrade).
    """
    ids = [p["osm_id"] for p in pois]
    known = {p.osm_id: p for p in (await db.execute(
        select(Place).where(Place.osm_id.in_(ids))
    )).scalars().all()} if ids else {}
    added = 0
    for poi in pois:
        place = known.get(poi["osm_id"])
        if place is not None:
            for field in _EXTRA_FIELDS:
                if poi.get(field) and not getattr(place, field):
                    setattr(place, field, poi[field])
            if poi.get("pricing_model") == "free" and place.pricing_model == "unknown":
                place.pricing_model = "free"
            continue
        place = Place(
            name=poi["name"],
            category=poi["category"],
            address=poi.get("address") or None,
            # addr:city из OSM, иначе город, ради которого тянули
            city=poi.get("city") or default_city,
            osm_id=poi["osm_id"],
            location=ST_SetSRID(ST_MakePoint(poi["lon"], poi["lat"]), 4326),
            pricing_model=poi.get("pricing_model") or "unknown",
            # None не передаём: JSON-колонка записала бы JSON null вместо SQL NULL
            **{f: poi[f] for f in _EXTRA_FIELDS if poi.get(f)},
        )
        db.add(place)
        known[poi["osm_id"]] = place  # node и way одного места — разные id, это ок
        added += 1
    return added


async def _category_count(db: AsyncSession, city: CityRef, category: str) -> int:
    point = ST_SetSRID(ST_MakePoint(city.lon, city.lat), 4326)
    return (await db.execute(
        select(func.count()).select_from(Place).where(
            Place.category == category,
            ST_DWithin(cast(Place.location, Geography), cast(point, Geography), city.radius_m),
        )
    )).scalar_one()


async def ensure_category(city: CityRef, category: str, *, factory=None, redis=None) -> int:
    """Подтянуть категорию вокруг города, если её там мало. → сколько добавлено.

    Идемпотентно и дёшево на повторах: метка «область × категория» в Redis
    (месяц), лок от параллельных ходов, get-or-create по osm_id. Пишем своей
    сессией и своим commit'ом — каталог общий, к транзакции хода не относится.
    factory/redis — для Celery-воркера (свой event loop — свои пулы).
    """
    if category not in CATEGORIES:
        return 0
    redis = redis or redis_client
    marker = _area_key(city, category)
    if await redis.exists(marker):
        return 0
    async with (factory or session_factory)() as db:
        if await _category_count(db, city, category) >= MIN_CATEGORY_PLACES:
            await redis.setex(marker, AREA_DONE_TTL, "1")
            return 0
        # соединение не держим на Overpass (правило производительности)
        await db.commit()
        lock = f"{marker}:lock"
        if not await redis.set(lock, "1", nx=True, ex=AREA_LOCK_TTL):
            return 0  # соседний ход уже заполняет — не дублируем запрос
        try:
            radius = min(city.radius_m, MAX_FETCH_RADIUS_M)
            try:
                pois = await _fetch_category(city.lat, city.lon, radius, category)
            except (httpx.HTTPError, ValueError) as e:
                logger.warning("Overpass: %s для %s не пришла: %s", category, city.name, e)
                await redis.setex(marker, AREA_FAIL_TTL, "fail")
                if isinstance(e, httpx.HTTPStatusError) and e.response.status_code == 429:
                    raise OverpassBusy(str(e)) from e
                return 0
            added = await add_pois(db, pois, city.name)
            await db.commit()
            await redis.setex(marker, AREA_DONE_TTL, "1")
            logger.info("каталог %s/%s: +%d мест", city.name, category, added)
            return added
        finally:
            await redis.delete(lock)


# фон стартует чуть позже хода: синхронный запрос юзера к Overpass — первым,
# иначе они бьются за слоты публичного сервера и оба ловят 429
FILL_COUNTDOWN_S = 10


def _schedule_area_fill(city: CityRef) -> None:
    """Остальные категории — в Celery (тесты подменяют, как summarize)."""
    from app.workers.catalog_fill import fill_area_task  # воркер импортирует нас

    fill_area_task.apply_async(
        (city.name, city.lat, city.lon, city.radius_m), countdown=FILL_COUNTDOWN_S,
    )


async def ensure_city_catalog(city: CityRef, category: str | None = None) -> int:
    """Перед поиском Meili: спрошенная категория — сразу, в ходе (один запрос
    Overpass, обычно секунды); остальные — фоном, следующий ход уже быстрый.
    Без категории в ходе тянем «достопримечательности». → добавлено в ходе."""
    try:
        added = await ensure_category(city, category or DEFAULT_SYNC_CATEGORY)
    except OverpassBusy:
        added = 0  # ищем по тому, что есть; метка fail уже стоит
    queued = f"catalog:{MARKER_VERSION}:{city.lat:.2f}:{city.lon:.2f}:queued"
    if await redis_client.set(queued, "1", nx=True, ex=AREA_QUEUED_TTL):
        try:
            _schedule_area_fill(city)
        except Exception:  # noqa: BLE001 — брокер лёг: ход важнее фона
            logger.exception("не поставили дозаполнение %s", city.name)
    return added
