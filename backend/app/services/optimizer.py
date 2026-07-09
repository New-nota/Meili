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




def solve_tsp(matrix: List[List[int]], time_windows: List[tuple] = None) -> List[int]:
    n = len(matrix)
    manager = pywrapcp.RoutingIndexManager(n, 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return matrix[from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)
    if time_windows:
        routing.AddDimension(
            transit_callback_index, MAX_SLACK_SECONDS, TIME_HORIZON_SECONDS, False, "Time"
        )
        time_dimension = routing.GetDimensionOrDie("Time")
        for i, (open_sec, close_sec) in enumerate(time_windows):
            index = manager.NodeToIndex(i)
            time_dimension.CumulVar(index).SetMin(open_sec)
            time_dimension.SetCumulVarSoftUpperBound(index, close_sec, LATE_ARRIVAL_PENALTY)
    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )

    solution = routing.SolveWithParameters(search_params)
    if solution is None:
        return list(range(n))
    
    order = []
    index = routing.Start(0)
    while not routing.IsEnd(index):
        order.append(manager.IndexToNode(index))
        index = solution.Value(routing.NextVar(index))
    
    return order

async def optimize_trip_stops(stops: list, trip) -> List[str]:
    if len(stops) <= 2:
        return [str(stop.id) for stop in stops]
    has_depot = trip.start_lat is not None and trip.start_lon is not None
    locations = []
    if has_depot:
        locations.append({"lat": trip.start_lat, "lon": trip.start_lon})
    for stop in stops:
        if stop.place.location is None:
            raise ValueError(f"Place {stop.place.id} has no coordinates")
        point = wkb.loads(bytes(stop.place.location.data))
        locations.append({"lat": point.y, "lon": point.x})
    time_windows = None
    if trip.start_time is not None:
        time_windows = parse_time_windows(stops, trip, has_depot)

    costing = COSTING_MAP.get(trip.transport_default or "walking",  "pedestrian")
    matrix = await get_time_matrix(locations, costing=costing)
    if has_depot:
        depot_distances = [matrix[0][j] for j in range (1, len(matrix))]
        if all(d >= UNREACHABLE_TIME for d in depot_distances):
            has_depot = False
            locations = locations[1:]
            matrix = [row[1:] for row in matrix[1:]]
            time_windows = time_windows[1:] if time_windows else None
            
    optimal_order = solve_tsp(matrix, time_windows)
    if has_depot:
        return [str(stops[i-1].id) for i in optimal_order if i != 0]
    else:
        return [str(stops[i].id) for i in optimal_order ]