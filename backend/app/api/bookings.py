from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.bookings import BookingConfirm, BookingCreate, BookingResponse
from app.services.booking import (
    BookingError,
    booking_to_dict,
    cancel_booking,
    confirm_booking,
    create_booking,
    list_bookings,
)
from app.services.email import send_booking_confirmation

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.post("/", response_model=BookingResponse, status_code=201)
async def create(
    data: BookingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        booking = await create_booking(db, current_user.id, data)
    except BookingError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    return booking_to_dict(booking)


@router.get("/", response_model=list[BookingResponse])
async def my_bookings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    bookings = await list_bookings(db, current_user.id)
    return [booking_to_dict(b) for b in bookings]


@router.post("/{booking_id}/confirm", response_model=BookingResponse)
async def confirm(
    booking_id: UUID,
    data: BookingConfirm,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        booking = await confirm_booking(db, current_user.id, booking_id, data)
    except BookingError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))

    # email-подтверждение — best effort, сбой почты не роняет бронь (S7)
    details = booking.booking_details or {}
    await send_booking_confirmation(
        to=current_user.email,
        place_name=details.get("place_name"),
        provider=booking.provider,
        booking_ref=booking.external_id or str(booking.id)[:8],
        visit_date=details.get("visit_date"),
    )
    return booking_to_dict(booking)


@router.post("/{booking_id}/cancel", response_model=BookingResponse)
async def cancel(
    booking_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        booking = await cancel_booking(db, current_user.id, booking_id)
    except BookingError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    return booking_to_dict(booking)
