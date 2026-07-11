"""Экспорт маршрута: PDF-итинерарий и календарь .ics (S9 WP-B)."""
import re
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.stops import get_trip_or_404
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.export_ics import render_trip_ics
from app.services.export_pdf import render_itinerary_pdf

router = APIRouter(prefix="/trips", tags=["export"])


def _safe_filename(title: str, ext: str) -> str:
    stem = re.sub(r"[^\w\- ]", "", title, flags=re.UNICODE).strip() or "trip"
    return f"{stem}.{ext}"


@router.get("/{trip_id}/export/pdf")
async def export_pdf(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    trip = await get_trip_or_404(trip_id, current_user.id, db)
    pdf = await render_itinerary_pdf(db, trip)
    filename = _safe_filename(trip.title, "pdf")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="trip.pdf"; '
                f"filename*=UTF-8''{quote(filename)}"
            )
        },
    )


@router.get("/{trip_id}/export/ics")
async def export_ics(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    trip = await get_trip_or_404(trip_id, current_user.id, db)
    ics_text = await render_trip_ics(db, trip)
    filename = _safe_filename(trip.title, "ics")
    return Response(
        content=ics_text,
        media_type="text/calendar",
        headers={
            "Content-Disposition": (
                f'attachment; filename="trip.ics"; '
                f"filename*=UTF-8''{quote(filename)}"
            )
        },
    )
