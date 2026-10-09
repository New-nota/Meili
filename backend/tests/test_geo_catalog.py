"""По миру без региона: покрытие, таймзона, геокодер города, запрос к OSM."""
import httpx
import pytest

from app.core.config import settings
from app.services.places import catalog
from app.services.places.catalog import (
    GeocoderUnavailable,
    _build_area_query,
    _category_of,
    _radius_from_bbox,
    geocode_city,  # настоящий: autouse-фикстура подменяет его уже после импорта
)
from app.services.places.geo import in_coverage, timezone_at
from app.services.valhalla import cached_post as REAL_CACHED_POST


def test_empty_coverage_means_whole_world(monkeypatch):
    monkeypatch.setattr(settings, "ROUTING_COVERAGE", [])
    assert in_coverage(48.86, 2.34) and in_coverage(-33.86, 151.21)


def test_coverage_of_n_cities(monkeypatch):
    # «карты N городов» — N прямоугольников
    monkeypatch.setattr(settings, "ROUTING_COVERAGE", [
        (54.30, 19.60, 55.35, 23.05),   # Калининград
        (48.70, 2.10, 49.00, 2.60),     # Париж
    ])
    assert in_coverage(54.71, 20.51)
    assert in_coverage(48.86, 2.34)
    assert not in_coverage(52.52, 13.40)  # Берлин — тайлов нет


@pytest.mark.parametrize("lat, lon, tz", [
    (54.71, 20.51, "Europe/Kaliningrad"),
    (48.86, 2.34, "Europe/Paris"),
    (35.68, 139.69, "Asia/Tokyo"),
    (-33.86, 151.21, "Australia/Sydney"),
])
def test_timezone_follows_coordinates(lat, lon, tz):
    assert timezone_at(lat, lon) == tz


def test_timezone_without_coordinates():
    assert timezone_at(None, 2.34) is None


def test_radius_from_bbox_is_clamped():
    assert _radius_from_bbox(["48.81", "48.90", "2.22", "2.47"]) == pytest.approx(10_000, rel=0.3)
    assert _radius_from_bbox(["55.00", "55.001", "20.0", "20.001"]) == catalog.MIN_CITY_RADIUS_M
    assert _radius_from_bbox(["55", "57", "36", "39"]) == catalog.MAX_CITY_RADIUS_M
    assert _radius_from_bbox(None) == catalog.DEFAULT_CITY_RADIUS_M


def test_area_query_has_every_category_with_cap():
    q = _build_area_query(48.86, 2.34, 5000)
    for key, value, _, cap in catalog.CATALOG_CATEGORIES:
        assert catalog._osm_selector(key, value) in q
        assert f"out center tags {cap};" in q
    assert q.count('["name"]') == 2 * len(catalog.CATALOG_CATEGORIES)  # безымянное не тянем
    assert '["tourism"~"^(hotel|hostel|guest_house|apartment|motel)$"]' in q


def test_category_query_takes_only_its_entries():
    # museum = музеи + галереи, ничего лишнего
    q = _build_area_query(48.86, 2.34, 5000, catalog._entries("museum"))
    assert '"museum"' in q and '"gallery"' in q and "restaurant" not in q


def test_category_of_tags():
    assert _category_of({"tourism": "museum"}) == "museum"
    assert _category_of({"historic": "castle"}) == "historic"
    assert _category_of({"shop": "bakery"}) is None
    assert _category_of({"tourism": "hostel"}) == "hotel"
    assert _category_of({"amenity": "pub"}) == "bar"
    assert _category_of({"amenity": "fast_food"}) is None  # осознанно не берём
    # музей-усадьба — музей, а не просто «историческое»
    assert _category_of({"tourism": "museum", "historic": "manor"}) == "museum"


def test_osmium_filters_cover_tuples():
    f = catalog.osmium_filters()
    assert "nwr/tourism=hotel,hostel,guest_house,apartment,motel" in f
    assert "nwr/historic " in f + " "


def test_poi_extras_from_osm_tags():
    extras = catalog.poi_extras({
        "tourism": "hostel", "stars": "3", "opening_hours": "24/7",
    })
    assert extras["tags"] == ["hostel", "stars:3"]
    assert extras["opening_hours"]["su"] == [["00:00", "24:00"]]
    assert extras["pricing_model"] is None
    park = catalog.poi_extras({"leisure": "park", "fee": "no"})
    assert park == {"opening_hours": None, "pricing_model": "free", "tags": None}
    food = catalog.poi_extras({"amenity": "restaurant", "cuisine": "georgian;italian"})
    assert food["tags"] == ["cuisine:georgian", "cuisine:italian"]
    # fee=yes — цены всё равно нет: не «бесплатно» и не ноль
    assert catalog.poi_extras({"tourism": "museum", "fee": "yes"})["pricing_model"] is None


class FakeRedis:
    def __init__(self):
        self.data = {}

    async def get(self, key):
        return self.data.get(key)

    async def setex(self, key, ttl, value):
        self.data[key] = value


def _mock_nominatim(monkeypatch, handler):
    calls = []
    real = httpx.AsyncClient

    def factory(**kw):
        def wrapped(request):
            calls.append(request)
            return handler(request)
        return real(transport=httpx.MockTransport(wrapped), **kw)

    monkeypatch.setattr(catalog.httpx, "AsyncClient", factory)
    monkeypatch.setattr(catalog, "redis_client", FakeRedis())
    return calls


async def test_geocode_city_takes_settlement_and_caches(monkeypatch):
    calls = _mock_nominatim(monkeypatch, lambda r: httpx.Response(200, json=[{
        "addresstype": "city", "class": "boundary", "name": "Paris",
        "lat": "48.8566", "lon": "2.3522", "boundingbox": ["48.81", "48.90", "2.22", "2.47"],
    }]))
    city = await geocode_city("Париж")
    assert city.name == "Paris" and round(city.lat, 2) == 48.86
    assert calls[0].headers["User-Agent"].startswith("Hermod")  # политика Nominatim
    assert calls[0].url.params["featureType"] == "settlement"
    assert await geocode_city("париж ") == city  # из кэша, без второго запроса
    assert len(calls) == 1


async def test_geocode_city_rejects_non_settlement(monkeypatch):
    _mock_nominatim(monkeypatch, lambda r: httpx.Response(200, json=[{
        "addresstype": "quarter", "class": "boundary", "name": "Рыбная деревня",
        "lat": "54.70", "lon": "20.51",
    }]))
    assert await geocode_city("Рыбная деревня") is None


async def test_geocode_city_down_is_unknown_not_none(monkeypatch):
    _mock_nominatim(monkeypatch, lambda r: httpx.Response(503))
    with pytest.raises(GeocoderUnavailable):
        await geocode_city("Берлин")


async def test_fetch_category_is_one_request(monkeypatch):
    """Одна категория — один запрос; теги OSM доезжают до места."""
    real = httpx.AsyncClient
    queries = []

    def handler(request):
        queries.append(request.read().decode())
        return httpx.Response(200, json={"elements": [
            {"type": "node", "id": 7, "lat": 55.75, "lon": 37.62,
             "tags": {"tourism": "hotel", "name": "Метрополь", "stars": "5",
                      "opening_hours": "24/7"}},
        ]})

    monkeypatch.setattr(catalog.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    pois = await catalog._fetch_category(55.75, 37.62, 5000, "hotel")
    assert len(queries) == 1 and "restaurant" not in queries[0]
    assert pois[0]["name"] == "Метрополь" and pois[0]["category"] == "hotel"
    assert pois[0]["tags"] == ["hotel", "stars:5"] and pois[0]["opening_hours"]["mo"]


async def test_ensure_category_overpass_down_is_marked_fail(monkeypatch):
    """Overpass лёг — метка fail на час, ход не падает."""
    class Redis(FakeRedis):
        async def exists(self, key):
            return int(key in self.data)

        async def set(self, key, value, nx=False, ex=None):
            if nx and key in self.data:
                return None
            self.data[key] = value
            return True

        async def delete(self, key):
            self.data.pop(key, None)

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def commit(self):
            pass

    async def no_places(db, city, category):
        return 0

    async def down(*a):
        raise httpx.ConnectError("down")

    redis = Redis()
    monkeypatch.setattr(catalog, "_category_count", no_places)
    monkeypatch.setattr(catalog, "_fetch_category", down)
    city = catalog.CityRef("Тбилиси", 41.69, 44.80)
    assert await catalog.ensure_category(city, "hotel", factory=Session, redis=redis) == 0
    assert redis.data[catalog._area_key(city, "hotel")] == "fail"


def test_seed_feature_to_poi():
    from scripts.seed_pois import feature_to_poi

    moscow = (55.35, 36.95, 56.05, 38.15)
    park = {"type": "Feature", "id": "w42", "properties": {
        "leisure": "park", "name": "Парк Горького", "addr:city": "Москва"},
        "geometry": {"type": "Polygon", "coordinates": [[
            [37.59, 55.72], [37.61, 55.72], [37.61, 55.73], [37.59, 55.73], [37.59, 55.72]]]}}
    poi = feature_to_poi(park, moscow)
    assert poi["osm_id"] == "way/42" and poi["category"] == "park" and poi["city"] == "Москва"
    assert 55.72 <= poi["lat"] <= 55.73
    museum = {"id": "n7", "properties": {"tourism": "museum", "name": "ГИМ"},
              "geometry": {"type": "Point", "coordinates": [37.6176, 55.7553]}}
    assert feature_to_poi(museum, moscow)["city"] is None  # без addr:city — без города
    far = {**museum, "geometry": {"type": "Point", "coordinates": [20.5, 54.7]}}
    assert feature_to_poi(far, moscow) is None
    nameless = {**museum, "properties": {"tourism": "museum"}}
    assert feature_to_poi(nameless, moscow) is None
    # meili_upgrade: теги OSM из pbf — те же extras, что у Overpass
    beach = {"id": "w9", "properties": {"natural": "beach", "name": "Серебряный бор", "fee": "no"},
             "geometry": {"type": "Point", "coordinates": [37.42, 55.78]}}
    poi = feature_to_poi(beach, moscow)
    assert poi["category"] == "beach" and poi["pricing_model"] == "free"


async def test_valhalla_cache_serves_repeat_and_survives_redis_outage(monkeypatch):
    """Ревью (нагрузка): одинаковый маршрут — из кэша; Redis лёг — идём в Valhalla."""
    from app.services import valhalla

    # настоящая cached_post (autouse-фикстура подменяет её фейком)
    monkeypatch.setattr(valhalla, "cached_post", REAL_CACHED_POST)
    calls = []
    real = httpx.AsyncClient

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"trip": {"legs": [{"summary": {"time": 60, "length": 1}}]}})

    monkeypatch.setattr(valhalla.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(handler), **kw))

    class DictRedis:
        def __init__(self):
            self.d = {}

        async def get(self, k):
            return self.d.get(k)

        async def setex(self, k, ttl, v):
            self.d[k] = v

    import app.core.redis as redis_mod
    monkeypatch.setattr(redis_mod, "redis_client", DictRedis())
    pts = [{"lat": 55.75, "lon": 37.61}, {"lat": 55.76, "lon": 37.62}]
    a = await valhalla._route_call(pts, "pedestrian")
    b = await valhalla._route_call(pts, "pedestrian")
    assert a == b and len(calls) == 1  # второй — из кэша

    class DeadRedis:
        async def get(self, k):
            raise ConnectionError("redis down")

        async def setex(self, k, ttl, v):
            raise ConnectionError("redis down")

    monkeypatch.setattr(redis_mod, "redis_client", DeadRedis())
    assert await valhalla._route_call(pts, "auto")  # без кэша, но работает
    assert len(calls) == 2


async def test_fill_area_stops_on_overpass_429(monkeypatch):
    """Живой смоук: 429 — значит, мы и так долбим публичный сервер; фон
    останавливается, а не перебирает оставшиеся категории."""
    from app.workers import catalog_fill

    calls = []

    async def ensure(city, category, factory=None, redis=None):
        calls.append(category)
        if len(calls) == 2:
            raise catalog.OverpassBusy("429")
        return 1

    monkeypatch.setattr(catalog_fill, "ensure_category", ensure)
    added = await catalog_fill.fill_area(catalog.CityRef("Тбилиси", 41.69, 44.80), pause_s=0)
    assert added == 1 and len(calls) == 2
