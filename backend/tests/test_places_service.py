"""Конвертация Place -> dict, включая PostGIS-геометрию
(app/services/places.py)."""
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.models.place import Place
from app.services.places import place_to_dict


def test_place_to_dict_extracts_lat_lon_from_geometry():
    place = Place(
        name="Кафедральный собор",
        city="Калининград",
        location=from_shape(Point(20.5118, 54.7068), srid=4326),
    )
    result = place_to_dict(place)
    assert result["name"] == "Кафедральный собор"
    assert result["city"] == "Калининград"
    # WKB хранит (lon, lat); проверяем корректную распаковку
    assert abs(result["lon"] - 20.5118) < 1e-6
    assert abs(result["lat"] - 54.7068) < 1e-6


def test_place_to_dict_without_geometry_gives_none_coords():
    place = Place(name="Без координат")
    result = place_to_dict(place)
    assert result["lat"] is None
    assert result["lon"] is None
    assert result["name"] == "Без координат"


def test_place_to_dict_contains_expected_keys():
    place = Place(name="X")
    result = place_to_dict(place)
    for key in ("id", "name", "category", "address", "city", "country",
                "lat", "lon", "rating", "duration_minutes", "tags",
                "osm_id", "is_verified"):
        assert key in result
