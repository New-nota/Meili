from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp
import httpx
from typing import List, Dict
import os
from shapely import wkb
VALHALLA_URL = os.getenv("VALHALLA_URL", "http://valhalla:8002")

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
            matrix[i][j] = int(cell["time"]) if cell["time"] is not None else 9999

    return matrix

def solve_tsp(matrix: List[List[int]]) -> List[int]:
    n = len(matrix)
    manager = pywrapcp.RoutingIndexManager(n, 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return matrix[from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )

    solution = routing.SolveWithParameters(search_params)

    order = []
    index = routing.Start(0)
    while not routing.IsEnd(index):
        order.append(manager.IndexToNode(index))
        index = solution.Value(routing.NextVar(index))
    
    return order

async def optimize_trip_stops(stops: list) -> List[str]:
    if len(stops) <= 2:
        return [str(stop.id) for stop in stops]
    
    locations = []
    for stop in stops:
        if stop.place.location is None:
            raise ValueError(f"Place {stop.place.id} has no coordinates")
        point = wkb.loads(bytes(stop.place.location.data))
        locations.append({"lat": point.y, "lon": point.x})
    matrix = await get_time_matrix(locations)
    optimal_order = solve_tsp(matrix)

    return [str(stops[i].id) for i in optimal_order]
