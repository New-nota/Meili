from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp
import httpx
from typing import List, Dict
from shapely import wkb

from app.core.config import settings

COSTING_MAP = {
        "walking" : "pedestrian",
        "auto": "auto",
        "bicycle": "bicycle",
    }

# буфер на пробки: Valhalla считает по статическим скоростям (см. PROGRESS, С3)
AUTO_TRAFFIC_FACTOR = 1.4
# «бесконечность» для недостижимых пар точек
UNREACHABLE_TIME = 9999
# горизонт планирования измерения Time: дольше 12ч маршрут одного дня не бывает
TIME_HORIZON_SECONDS = 12 * 3600
# штраф за приход после закрытия (мягкое окно, не жёсткий отказ)
LATE_ARRIVAL_PENALTY = 1000
# максимум ожидания в одной точке (например, до открытия)
MAX_SLACK_SECONDS = 1 * 3600

async def get_time_matrix(
        locations: List[Dict[str, float]],
        costing: str = "pedestrian"
) -> List[List[int]]:
    body = {
        "sources": [{"lon": loc["lon"], "lat": loc["lat"]} for loc in locations],
        "targets": [{"lon": loc["lon"], "lat": loc["lat"]} for loc in locations],
        "costing": costing
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{settings.VALHALLA_URL}/sources_to_targets",
            json=body
        )
        response.raise_for_status()
        data = response.json()
    n = len(locations)
    matrix = [[0] * n for _ in range(n)]

    for i, row in enumerate(data["sources_to_targets"]):
        for j, cell in enumerate(row):
            if cell["time"] is None:
                matrix[i][j] = UNREACHABLE_TIME
            elif body["costing"] == "auto":
                matrix[i][j] = int(cell["time"] * AUTO_TRAFFIC_FACTOR)
            else:
                matrix[i][j] = int(cell["time"])

    return matrix
def parse_time_windows(stops: list, trip, has_depot: bool) -> List[tuple]:
    start = trip.start_time
    start_secs = start.hour * 3600 + start.minute * 60
    windows = []

    if has_depot:
        windows.append((0,0))
    default_window = (0, TIME_HORIZON_SECONDS)
    for stop in stops:
        op_hor = stop.place.opening_hours
        # opening_hours приходит из OSM/пользователя — формат не гарантирован,
        # поэтому любой кривой вариант превращаем в «открыто весь день»
        if not isinstance(op_hor, dict) or "open" not in op_hor or "close" not in op_hor:
            windows.append(default_window)
            continue
        try:
            open_parts = op_hor["open"].split(":")
            close_parts = op_hor["close"].split(":")
            open_secs = int(open_parts[0]) * 3600 + int(open_parts[1]) * 60
            close_secs = int(close_parts[0]) * 3600 + int(close_parts[1]) * 60
        except (ValueError, IndexError, AttributeError):
            windows.append(default_window)
            continue
        windows.append((
            # окна не должны выходить за горизонт измерения Time, иначе
            # solver падает (SetMin > максимума CumulVar)
            min(max(0, open_secs - start_secs), TIME_HORIZON_SECONDS),
            min(max(0, close_secs - start_secs), TIME_HORIZON_SECONDS),
        ))
    return windows




class OutOfCoverageError(Exception):
    """Точки дня вне зоны покрытия тайлов Valhalla (S8 WP-3)."""


def solve_tsp_path(
    matrix: List[List[int]],
    time_windows: List[tuple] | None = None,
    service_times: List[int] | None = None,
) -> List[int] | None:
    """Путь с двумя разными депо: узел 0 — старт, узел n-1 — финиш (S8 WP-3).

    Возвращает порядок ВСЕХ узлов (включая крайние) или None, если решения нет.
    service_times[i] — время пребывания в узле i (сек), учитывается в
    временном измерении при выходе из узла.
    """
    n = len(matrix)
    manager = pywrapcp.RoutingIndexManager(n, 1, [0], [n - 1])
    routing = pywrapcp.RoutingModel(manager)
    service = service_times or [0] * n

    def transit_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return matrix[from_node][to_node] + service[from_node]

    transit_callback_index = routing.RegisterTransitCallback(transit_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    if time_windows:
        routing.AddDimension(
            transit_callback_index, MAX_SLACK_SECONDS, TIME_HORIZON_SECONDS, False, "Time"
        )
        time_dimension = routing.GetDimensionOrDie("Time")
        # старт дня фиксирован: время 0 = day.start_time
        time_dimension.CumulVar(routing.Start(0)).SetRange(0, 0)
        for i, (open_sec, close_sec) in enumerate(time_windows):
            if i == 0 or i == n - 1:
                continue  # депо-узлы: старт зафиксирован выше, финиш — горизонтом
            index = manager.NodeToIndex(i)
            time_dimension.CumulVar(index).SetMin(open_sec)
            time_dimension.SetCumulVarSoftUpperBound(index, close_sec, LATE_ARRIVAL_PENALTY)

    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )

    solution = routing.SolveWithParameters(search_params)
    if solution is None:
        return None

    order = []
    index = routing.Start(0)
    while not routing.IsEnd(index):
        order.append(manager.IndexToNode(index))
        index = solution.Value(routing.NextVar(index))
    order.append(manager.IndexToNode(index))  # финишное депо
    return order


def _stop_coords(stop) -> Dict[str, float]:
    if stop.place.location is None:
        raise ValueError(f"Place {stop.place.id} has no coordinates")
    point = wkb.loads(bytes(stop.place.location.data))
    return {"lat": point.y, "lon": point.x}


async def optimize_day_stops(day, stops: list, transport: str | None) -> List[str]:
    """Оптимальный порядок стопов дня: старт дня → ... → финиш дня (S8 WP-3).

    day.start_location / day.end_location должны быть заданы (проверяет API).
    Возвращает id стопов в оптимальном порядке.
    """
    locations = [{"lat": day.start_location.lat, "lon": day.start_location.lon}]
    locations += [_stop_coords(s) for s in stops]
    locations.append({"lat": day.end_location.lat, "lon": day.end_location.lon})

    costing = COSTING_MAP.get(transport or "walking", "pedestrian")
    try:
        matrix = await get_time_matrix(locations, costing=costing)
    except httpx.HTTPStatusError as e:
        # Valhalla отвечает 4xx, когда точки вне зоны тайлов
        raise OutOfCoverageError(str(e))

    n = len(matrix)
    # старт не достигает ни одного узла — день вне покрытия
    if all(matrix[0][j] >= UNREACHABLE_TIME for j in range(1, n)):
        raise OutOfCoverageError("start location cannot reach any node")

    # окна: [старт] + окна стопов (от start_time дня) + [финиш]
    stop_windows = parse_time_windows(stops, day, has_depot=False)
    time_windows = [(0, 0)] + stop_windows + [(0, TIME_HORIZON_SECONDS)]
    service_times = [0] + [(s.duration_minutes or 0) * 60 for s in stops] + [0]

    order = solve_tsp_path(matrix, time_windows, service_times)
    if order is None:
        # при мягких окнах решение есть почти всегда; фолбэк — исходный порядок
        return [str(s.id) for s in stops]

    inner = [i for i in order if 0 < i < n - 1]
    return [str(stops[i - 1].id) for i in inner]