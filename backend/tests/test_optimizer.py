"""Оптимизатор маршрута: OR-Tools TSP/TSPTW, depot, матрица времён с
коэффициентом пробок (app/services/optimizer.py)."""
from datetime import time
from types import SimpleNamespace

import pytest
from shapely.geometry import Point
from shapely import wkb as shp_wkb

from app.services import optimizer
from app.services.optimizer import (
    COSTING_MAP,
    get_time_matrix,
    optimize_trip_stops,
    parse_time_windows,
    solve_tsp,
)


# ---------- helpers ----------------------------------------------------------
def _fake_location(lon: float, lat: float):
    """Имитирует geoalchemy2 WKBElement: объект с атрибутом .data (WKB-байты)."""
    return SimpleNamespace(data=shp_wkb.dumps(Point(lon, lat)))


def _fake_stop(stop_id: str, lon: float, lat: float, opening_hours=None):
    place = SimpleNamespace(
        id=f"place-{stop_id}",
        location=_fake_location(lon, lat),
        opening_hours=opening_hours,
    )
    return SimpleNamespace(id=stop_id, place=place)


def _fake_trip(start_lat=None, start_lon=None, start_time=None, transport="walking"):
    return SimpleNamespace(
        start_lat=start_lat,
        start_lon=start_lon,
        start_time=start_time,
        transport_default=transport,
    )


# ---------- solve_tsp --------------------------------------------------------
def test_solve_tsp_returns_permutation_starting_at_zero():
    # 4 точки по прямой: 0-1-2-3
    matrix = [
        [0, 1, 2, 3],
        [1, 0, 1, 2],
        [2, 1, 0, 1],
        [3, 2, 1, 0],
    ]
    order = solve_tsp(matrix)
    assert order[0] == 0
    assert sorted(order) == [0, 1, 2, 3]  # каждая точка ровно один раз


def test_solve_tsp_picks_cheaper_neighbour_first():
    # из узла 0 ближе всего узел 2 (стоимость 1), потом 1 (стоимость 10)
    matrix = [
        [0, 10, 1],
        [10, 0, 10],
        [1, 10, 0],
    ]
    order = solve_tsp(matrix)
    assert order[0] == 0
    assert order[1] == 2  # жадный старт идёт в ближайшего соседа


# ---------- parse_time_windows ----------------------------------------------
def test_parse_time_windows_shifts_relative_to_start():
    trip = _fake_trip(start_time=time(9, 0))  # старт в 9:00 -> 32400 сек
    stops = [
        _fake_stop("s1", 20.5, 54.7, opening_hours={"open": "10:00", "close": "18:00"}),
    ]
    windows = parse_time_windows(stops, trip, has_depot=False)
    # open: 10:00 - 9:00 = 3600, close: 18:00 - 9:00 = 32400
    assert windows == [(3600, 32400)]


def test_parse_time_windows_default_when_no_hours():
    trip = _fake_trip(start_time=time(9, 0))
    stops = [_fake_stop("s1", 20.5, 54.7, opening_hours=None)]
    windows = parse_time_windows(stops, trip, has_depot=False)
    assert windows == [(0, 12 * 3600)]  # дефолт: 0..12ч


def test_parse_time_windows_prepends_depot():
    trip = _fake_trip(start_time=time(8, 0))
    stops = [_fake_stop("s1", 20.5, 54.7, opening_hours=None)]
    windows = parse_time_windows(stops, trip, has_depot=True)
    assert windows[0] == (0, 0)  # depot зафиксирован в начале
    assert len(windows) == 2


def test_solve_tsp_with_time_windows_returns_feasible_permutation():
    # окна в пределах 12-часового горизонта измерения "Time" (<=43200 сек);
    # решатель должен найти допустимый порядок и не упасть
    matrix = [
        [0, 60, 300],
        [60, 0, 60],
        [300, 60, 0],
    ]
    windows = [(0, 43200), (1800, 43200), (0, 43200)]
    order = solve_tsp(matrix, windows)
    assert order[0] == 0
    assert sorted(order) == [0, 1, 2]  # каждый узел ровно один раз


# ---------- get_time_matrix (мок Valhalla) -----------------------------------
class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeAsyncClient:
    """Подменяет httpx.AsyncClient, возвращает фиксированную матрицу времён."""

    payload = {
        "sources_to_targets": [
            [{"time": 0}, {"time": 100}],
            [{"time": 200}, {"time": 0}],
        ]
    }

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, *args, **kwargs):
        return _FakeResponse(self.payload)


async def test_get_time_matrix_applies_traffic_buffer_for_auto(monkeypatch):
    monkeypatch.setattr(optimizer.httpx, "AsyncClient", _FakeAsyncClient)
    locations = [{"lat": 54.7, "lon": 20.5}, {"lat": 54.71, "lon": 20.52}]
    matrix = await get_time_matrix(locations, costing="auto")
    # коэффициент пробок 1.4: int(100*1.4)=140, int(200*1.4)=280
    assert matrix[0][1] == 140
    assert matrix[1][0] == 280


async def test_get_time_matrix_no_buffer_for_pedestrian(monkeypatch):
    monkeypatch.setattr(optimizer.httpx, "AsyncClient", _FakeAsyncClient)
    locations = [{"lat": 54.7, "lon": 20.5}, {"lat": 54.71, "lon": 20.52}]
    matrix = await get_time_matrix(locations, costing="pedestrian")
    assert matrix[0][1] == 100  # без наценки
    assert matrix[1][0] == 200


async def test_get_time_matrix_handles_unreachable(monkeypatch):
    class _NullClient(_FakeAsyncClient):
        payload = {"sources_to_targets": [[{"time": 0}, {"time": None}],
                                          [{"time": None}, {"time": 0}]]}

    monkeypatch.setattr(optimizer.httpx, "AsyncClient", _NullClient)
    matrix = await get_time_matrix([{"lat": 0, "lon": 0}, {"lat": 1, "lon": 1}])
    assert matrix[0][1] == 9999  # недостижимо -> заглушка


# ---------- optimize_trip_stops (интеграция логики без сети) ------------------
async def test_optimize_short_trip_returns_as_is():
    # <=2 остановок оптимизировать нечего, матрица не запрашивается
    stops = [_fake_stop("a", 20.5, 54.7), _fake_stop("b", 20.6, 54.8)]
    trip = _fake_trip()
    result = await optimize_trip_stops(stops, trip)
    assert result == ["a", "b"]


async def test_optimize_returns_all_stop_ids(monkeypatch):
    async def fake_matrix(locations, costing="pedestrian"):
        n = len(locations)
        return [[0 if i == j else abs(i - j) for j in range(n)] for i in range(n)]

    monkeypatch.setattr(optimizer, "get_time_matrix", fake_matrix)
    stops = [
        _fake_stop("a", 20.50, 54.70),
        _fake_stop("b", 20.55, 54.72),
        _fake_stop("c", 20.60, 54.74),
    ]
    trip = _fake_trip()  # без depot, без start_time
    result = await optimize_trip_stops(stops, trip)
    assert sorted(result) == ["a", "b", "c"]  # перестановка исходных id


async def test_optimize_with_depot_excludes_depot_from_result(monkeypatch):
    async def fake_matrix(locations, costing="pedestrian"):
        n = len(locations)
        return [[0 if i == j else 10 for j in range(n)] for i in range(n)]

    monkeypatch.setattr(optimizer, "get_time_matrix", fake_matrix)
    stops = [
        _fake_stop("a", 20.50, 54.70),
        _fake_stop("b", 20.55, 54.72),
        _fake_stop("c", 20.60, 54.74),
    ]
    trip = _fake_trip(start_lat=54.69, start_lon=20.49)  # depot задан
    result = await optimize_trip_stops(stops, trip)
    # depot в результат не попадает, все три остановки — да
    assert sorted(result) == ["a", "b", "c"]


async def test_optimize_drops_unreachable_depot(monkeypatch):
    async def fake_matrix(locations, costing="pedestrian"):
        n = len(locations)
        m = [[0 if i == j else 10 for j in range(n)] for i in range(n)]
        # depot (индекс 0) недостижим до всех остальных
        for j in range(1, n):
            m[0][j] = 9999
        return m

    monkeypatch.setattr(optimizer, "get_time_matrix", fake_matrix)
    stops = [
        _fake_stop("a", 20.50, 54.70),
        _fake_stop("b", 20.55, 54.72),
        _fake_stop("c", 20.60, 54.74),
    ]
    trip = _fake_trip(start_lat=54.69, start_lon=20.49)
    result = await optimize_trip_stops(stops, trip)
    assert sorted(result) == ["a", "b", "c"]


async def test_optimize_raises_on_place_without_coords(monkeypatch):
    async def fake_matrix(locations, costing="pedestrian"):
        return [[0] * len(locations) for _ in locations]

    monkeypatch.setattr(optimizer, "get_time_matrix", fake_matrix)
    bad = _fake_stop("a", 20.5, 54.7)
    bad.place.location = None
    stops = [bad, _fake_stop("b", 20.55, 54.72), _fake_stop("c", 20.6, 54.74)]
    with pytest.raises(ValueError):
        await optimize_trip_stops(stops, _fake_trip())


# ---------- COSTING_MAP ------------------------------------------------------
def test_costing_map_covers_supported_modes():
    assert COSTING_MAP["walking"] == "pedestrian"
    assert COSTING_MAP["auto"] == "auto"
    assert COSTING_MAP["bicycle"] == "bicycle"
