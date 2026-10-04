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
        assert (f'["{key}"="{value}"]' if value else f'["{key}"]') in q
        assert f"out center tags {cap};" in q
    assert q.count('["name"]') == 2 * len(catalog.CATALOG_CATEGORIES)  # безымянное не тянем


def test_category_of_tags():
    assert _category_of({"tourism": "museum"}) == "museum"
    assert _category_of({"historic": "castle"}) == "historic"
    assert _category_of({"shop": "bakery"}) is None


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
