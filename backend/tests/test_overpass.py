"""Overpass-парсер (app/services/overpass.py) — фиксирует починку багов:
return внутри цикла (терялись все места кроме первого) и опечатки в OSM-тегах."""
from app.services.overpass import (
    CATEGORY_TO_OSM,
    build_overpass_query,
    parse_overpass_response,
)


def _node(el_id: int, name: str, lat: float = 54.7, lon: float = 20.5) -> dict:
    return {"type": "node", "id": el_id, "lat": lat, "lon": lon, "tags": {"name": name}}


class TestParseResponse:
    def test_returns_all_elements_not_just_first(self):
        # регресс: return стоял внутри цикла и обрезал список до 1 элемента
        data = {"elements": [_node(1, "Собор"), _node(2, "Музей"), _node(3, "Парк")]}
        places = parse_overpass_response(data)
        assert [p["name"] for p in places] == ["Собор", "Музей", "Парк"]

    def test_empty_response_returns_empty_list(self):
        # регресс: при пустом ответе функция возвращала None (кэшировался null)
        assert parse_overpass_response({"elements": []}) == []
        assert parse_overpass_response({}) == []

    def test_way_takes_coords_from_center(self):
        data = {"elements": [{
            "type": "way", "id": 7,
            "center": {"lat": 54.71, "lon": 20.51},
            "tags": {"name": "Парк"},
        }]}
        places = parse_overpass_response(data)
        assert places[0]["lat"] == 54.71
        assert places[0]["lon"] == 20.51

    def test_nameless_elements_skipped(self):
        data = {"elements": [
            {"type": "node", "id": 1, "lat": 54.7, "lon": 20.5, "tags": {}},
            _node(2, "С именем"),
        ]}
        places = parse_overpass_response(data)
        assert len(places) == 1
        assert places[0]["name"] == "С именем"


class TestCategories:
    def test_no_typos_in_osm_keys(self):
        # регресс: 'amenty' и ' restaurant' (пробел) ломали поиск кафе/ресторанов
        valid_keys = {"tourism", "amenity", "leisure", "shop"}
        for key, value in CATEGORY_TO_OSM.values():
            assert key in valid_keys, f"неизвестный OSM-ключ: {key!r}"
            assert value == value.strip(), f"пробелы в значении: {value!r}"

    def test_query_contains_category_tag(self):
        q = build_overpass_query(54.7, 20.5, 1000, "restaurant")
        assert '"amenity"' in q
        assert "restaurant" in q
        assert "around:1000,54.7,20.5" in q

    def test_unknown_category_falls_back_to_attraction(self):
        q = build_overpass_query(54.7, 20.5, 500, "casino")
        assert '"tourism"' in q
        assert "attraction" in q
