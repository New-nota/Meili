import httpx
from fastapi import APIRouter, HTTPException
from app.core.config import settings

router = APIRouter(prefix="/route", tags=["route"])

@router.post("/")
async def get_route(body: dict):
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{settings.VALHALLA_URL}/route",
            json=body
        )
        if not response.is_success:
            raise HTTPException(status_code=response.status_code, detail="Valhalla error")
        return response.json()