from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp
import httpx
from typing import List, Dict
import os
from shapely import wkb
VALHALLA_URL = os.getenv("VALHALLA_URL", "http://valhalla:8002")
    
COSTING_MAP = {
        "walking" : "pedestrian",
        "auto": "auto",
        "bicycle": "bicycle",
    }

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
            f"{VALHALLA_URL}/sources_to_targets",
            json=body
        )
        response.raise_for_status()
        data = response.json()
    n = len(locations)
    matrix = [[0] * n for _ in range(n)]

    for i, row in enumerate(data["sources_to_targets"]):
        for j, cell in enumerate(row):
            if body["costing"] == "auto":
                matrix[i][j] = int(cell["time"]* 1.4)   if cell["time"] is not None else 9999
            else:
                matrix[i][j] = int(cell["time"])  if cell["time"] is not None else 9999

    return matrix
def parse_time_windows(stops: list, trip, has_depot: bool) -> List[tuple]:
    start = trip.start_time
    start_secs = start.hour * 3600 + start.minute * 60
    windows = []

    if has_depot:
        windows.append((0,0))
    for stop in stops:
        op_hor = stop.place.opening_hours
        if op_hor is None:
            windows.append((0,12*3600))
        else:
            open_parts = op_hor["open"].split(":")
            close_parts = op_hor["close"].split(":")
            open_secs = int(open_parts[0]) * 3600 + int(open_parts[1]) * 60
            close_secs = int(close_parts[0]) * 3600 + int(close_parts[1]) * 60
            windows.append((
                max(0, open_secs - start_secs),max(0, close_secs - start_secs)
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
            transit_callback_index, 1 * 3600, 12 * 3600, False, "Time"
        )
        time_dimension = routing.GetDimensionOrDie("Time")
        for i, (open_sec, close_sec) in enumerate(time_windows):
            index = manager.NodeToIndex(i)
            time_dimension.CumulVar(index).SetMin(open_sec)
            time_dimension.SetCumulVarSoftUpperBound(index, close_sec, 1000)
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
        if all(d >= 9999 for d in depot_distances):
            has_depot = False
            locations = locations[1:]
            matrix = [row[1:] for row in matrix[1:]]
            time_windows = time_windows[1:] if time_windows else None
            
    optimal_order = solve_tsp(matrix, time_windows)
    if has_depot:
        return [str(stops[i-1].id) for i in optimal_order if i != 0]
    else:
        return [str(stops[i].id) for i in optimal_order ]