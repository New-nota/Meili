"""Оптимизатор маршрута: OR-Tools путь с двумя депо (S8 WP-3), TSPTW,
матрица времён с коэффициентом пробок (app/services/optimizer.py)."""
from datetime import time
from types import SimpleNamespace

import pytest
from shapely.geometry import Point
from shapely import wkb as shp_wkb

from app.services import optimizer
from app.services.optimizer import (
    COSTING_MAP,
    OutOfCoverageError,
    get_time_matrix,
    optimize_day_stops,
    parse_time_windows,
    solve_tsp_path,
)


# ---------- helpers ----------------------------------------------------------
def _fake_location(lon: float, lat: float):
    """Имитирует geoalchemy2 WKBElement: объект с атрибутом .data (WKB-байты)."""
    return SimpleNamespace(data=shp_wkb.dumps(Point(lon, lat)))


def _fake_stop(stop_id: str, lon: float, lat: float, opening_hours=None,
               duration_minutes=None):
    place = SimpleNamespace(
        id=f"place-{stop_id}",
        location=_fake_location(lon, lat),
        opening_hours=opening_hours,
    )
    return SimpleNamespace(
        id=stop_id, place=place, duration_minutes=duration_minutes
    )


def _fake_trip(start_time=None, transport="walking"):
    return SimpleNamespace(start_time=start_time, transport_default=transport)


def _fake_day(start=(54.69, 20.49), end=(54.75, 20.55), start_time=time(9, 0),
              end_time=time(21, 0)):
    return SimpleNamespace(
        start_location=SimpleNamespace(lat=start[0], lon=start[1]),
        end_location=SimpleNamespace(lat=end[0], lon=end[1]),
        start_time=start_time,
        end_time=end_time,
    )


# ---------- solve_tsp_path (два депо: 0 — старт, n-1 — финиш) -----------------
def test_path_starts_at_zero_ends_at_last():
    matrix = [
        [0, 1, 2, 3],
        [1, 0, 1, 2],
        [2, 1, 0, 1],
        [3, 2, 1, 0],
    ]
    order = solve_tsp_path(matrix)
    assert order[0] == 0        # старт фиксирован
    assert order[-1] == 3       # финиш фиксирован
    assert sorted(order) == [0, 1, 2, 3]  # каждый узел ровно один раз


def test_path_orders_middle_nodes_optimally():
    # старт 0, финиш 3; 2 ближе к старту, чем 1 -> порядок 0,2,1,3
    matrix = [
        [0, 10, 1, 99],
        [10, 0, 10, 1],
        [1, 10, 0, 99],
        [99, 1, 99, 0],
    ]
    order = solve_tsp_path(matrix)
    assert order == [0, 2, 1, 3]


def test_path_with_time_windows_feasible():
    matrix = [
        [0, 60, 300, 400],
        [60, 0, 60, 300],
        [300, 60, 0, 60],
        [400, 300, 60, 0],
    ]
    windows = [(0, 0), (1800, 43200), (0, 43200), (0, 43200)]
    order = solve_tsp_path(matrix, windows)
    assert order[0] == 0 and order[-1] == 3
    assert sorted(order) == [0, 1, 2, 3]


def test_path_service_times_accepted():
    # service_time учитывается в стоимости, порядок остаётся валидным путём
    matrix = [
        [0, 10, 10],
        [10, 0, 10],
        [10, 10, 0],
    ]
    order = solve_tsp_path(matrix, service_times=[0, 3600, 0])
    assert order[0] == 0 and order[-1] == 2


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


def test_parse_time_windows_survives_malformed_opening_hours():
    # opening_hours из OSM бывает строкой/огрызком — не должны падать
    trip = _fake_trip(start_time=time(9, 0))
    stops = [
        _fake_stop("s1", 20.5, 54.7, opening_hours="Mo-Fr 09:00-18:00"),  # строка
        _fake_stop("s2", 20.5, 54.7, opening_hours={"open": "10:00"}),     # нет close
        _fake_stop("s3", 20.5, 54.7, opening_hours={"open": "??", "close": "18:00"}),
    ]
    windows = parse_time_windows(stops, trip, has_depot=False)
    assert windows == [(0, 12 * 3600)] * 3  # все получили дефолтное окно


def test_parse_time_windows_clamped_to_horizon():
    # окно позже 12ч от старта не должно ронять solver (SetMin > максимума)
    trip = _fake_trip(start_time=time(6, 0))
    stops = [_fake_stop("s1", 20.5, 54.7,
                        opening_hours={"open": "21:00", "close": "23:00"})]
    windows = parse_time_windows(stops, trip, has_depot=False)
    (open_sec, close_sec) = windows[0]
    assert open_sec <= 12 * 3600
    assert close_sec <= 12 * 3600
    # solver с окном на краю горизонта не падает с CP Solver fail:
    # либо находит порядок, либо честно возвращает None (место недостижимо
    # по времени) — фолбэк на исходный порядок делает optimize_day_stops
    matrix = [[0, 60, 60], [60, 0, 60], [60, 60, 0]]
    order = solve_tsp_path(matrix, [(0, 0), windows[0], (0, 12 * 3600)])
    assert order is None or (order[0] == 0 and order[-1] == 2)


def test_parse_time_windows_prepends_depot():
    trip = _fake_trip(start_time=time(8, 0))
    stops = [_fake_stop("s1", 20.5, 54.7, opening_hours=None)]
    windows = parse_time_windows(stops, trip, has_depot=True)
    assert windows[0] == (0, 0)  # depot зафиксирован в начале
    assert len(windows) == 2


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


# ---------- optimize_day_stops (S8 WP-3, без сети) ----------------------------
async def test_day_optimize_returns_all_stop_ids(monkeypatch):
    async def fake_matrix(locations, costing="pedestrian"):
        n = len(locations)
        return [[0 if i == j else abs(i - j) * 10 for j in range(n)] for i in range(n)]

    monkeypatch.setattr(optimizer, "get_time_matrix", fake_matrix)
    stops = [
        _fake_stop("a", 20.50, 54.70),
        _fake_stop("b", 20.55, 54.72),
        _fake_stop("c", 20.60, 54.74),
    ]
    result = await optimize_day_stops(_fake_day(), stops, "walking")
    # депо (старт/финиш дня) в результат не входят, все стопы — да
    assert sorted(result) == ["a", "b", "c"]


async def test_day_optimize_single_stop(monkeypatch):
    async def fake_matrix(locations, costing="pedestrian"):
        n = len(locations)
        return [[0 if i == j else 10 for j in range(n)] for i in range(n)]

    monkeypatch.setattr(optimizer, "get_time_matrix", fake_matrix)
    result = await optimize_day_stops(_fake_day(), [_fake_stop("a", 20.5, 54.7)], None)
    assert result == ["a"]


async def test_day_optimize_out_of_coverage(monkeypatch):
    async def fake_matrix(locations, costing="pedestrian"):
        n = len(locations)
        m = [[0 if i == j else 10 for j in range(n)] for i in range(n)]
        for j in range(1, n):
            m[0][j] = 9999  # старт дня никого не достигает
        return m

    monkeypatch.setattr(optimizer, "get_time_matrix", fake_matrix)
    with pytest.raises(OutOfCoverageError):
        await optimize_day_stops(_fake_day(), [_fake_stop("a", 20.5, 54.7)], None)


async def test_day_optimize_raises_on_place_without_coords(monkeypatch):
    async def fake_matrix(locations, costing="pedestrian"):
        return [[0] * len(locations) for _ in locations]

    monkeypatch.setattr(optimizer, "get_time_matrix", fake_matrix)
    bad = _fake_stop("a", 20.5, 54.7)
    bad.place.location = None
    with pytest.raises(ValueError):
        await optimize_day_stops(_fake_day(), [bad], None)


# ---------- COSTING_MAP ------------------------------------------------------
def test_costing_map_covers_supported_modes():
    assert COSTING_MAP["walking"] == "pedestrian"
    assert COSTING_MAP["auto"] == "auto"
    assert COSTING_MAP["bicycle"] == "bicycle"
