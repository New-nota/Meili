import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.core.config import settings
from app.core.security import get_current_user
from app.models.user import User

router = APIRouter(prefix="/route", tags=["route"])


@router.post("/")
async def get_route(body: dict, _: User = Depends(get_current_user)):
    """Сырой прокси на Valhalla.

    Ревью: раньше ручка была БЕЗ авторизации — любой анонимный клиент гонял
    произвольные запросы через наш внутренний Valhalla (счёт за CPU платим мы).
    Фронт ей не пользуется (маршрут дня строит GET /trips/{id}/route), но
    ручка публично объявлена в OpenAPI, поэтому просто закрываем авторизацией.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{settings.VALHALLA_URL}/route",
            json=body
        )
        if not response.is_success:
            raise HTTPException(status_code=response.status_code, detail="Valhalla error")
        return response.json()
