from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from app.api.auth import router as auth_router
from app.api.trips import router as trip_router
from app.api.places import router as places_router
from app.api.stops import router as stops_router
from app.api.route import router as route_router
from app.api.optimize import router as optimize_router
from app.api.recommendations import router as recommendations_router

app = FastAPI(
    title="WanderOwn API",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(trip_router)
app.include_router(places_router)
app.include_router(stops_router)
app.include_router(route_router)
app.include_router(optimize_router)
app.include_router(recommendations_router)
@app.get("/health")
async def health():
    return {"status":"ok"}

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    openapi_schema = get_openapi(
        title="wanderOwn API",
        version="0.1.0",
        routes=app.routes,
    )
    openapi_schema["components"]["securitySchemes"] = {
        "bearerAuth" : {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
        }
    }
    openapi_schema["security"] = [{"bearerAuth": []}]
    app.openapi_schema = openapi_schema
    return app.openapi_schema

app.openapi = custom_openapi