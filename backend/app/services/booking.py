"""Сервис бронирования — Спринт 6, этап deep-link.

Флоу: пользователь жмёт «Забронировать» у остановки → мы создаём Booking
(status='pending') и отдаём deep_link на сайт партнёра → пользователь бронирует
там → возвращается и подтверждает (confirm) с номером брони → статус
'confirmed', у остановки выставляется is_booked / booking_ref.

Встроенное API-бронирование (Viator/OpenTable) — следующий этап, когда будут
партнёрские ключи; структура Booking это уже поддерживает (external_id,
booking_details JSONB).
"""
from urllib.parse import quote_plus

from geoalchemy2.shape import to_shape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.booking import Booking
from app.models.place import Place
from app.models.trip import Trip, TripStop
from app.schemas.bookings import BookingConfirm, BookingCreate

SUPPORTED_PROVIDERS: tuple[str, ...] = ("viator", "opentable", "thefork")


class BookingError(Exception):
    """Доменная ошибка бронирования — роутер конвертирует в HTTP-статус."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def _coords(place: Place) -> tuple[float | None, float | None]:
    if place.location is None:
        return None, None
    point = to_shape(place.location)
    return point.y, point.x  # lat, lon


def build_deep_link(provider: str, place: Place) -> str | None:
    """Ссылка на страницу бронирования у партнёра.

    Если у места уже есть прямой booking_url — он приоритетнее, чем
    поисковый deep-link.
    """
    if place.booking_url:
        return place.booking_url

    query = quote_plus(" ".join(filter(None, [place.name, place.city])))
    lat, lon = _coords(place)

    if provider == "viator":
        return f"https://www.viator.com/searchResults/all?text={query}"
    if provider == "opentable":
        url = f"https://www.opentable.com/s?term={query}"
        if lat is not None and lon is not None:
            url += f"&latitude={lat}&longitude={lon}"
        return url
    if provider == "thefork":
        return f"https://www.thefork.com/search?queryText={query}"
    return None


async def _get_stop_with_place(
    db: AsyncSession, user_id, trip_stop_id
) -> tuple[TripStop, Place]:
    """Остановка + место, с проверкой что поездка принадлежит пользователю."""
    result = await db.execute(
        select(TripStop, Place)
        .join(Trip, TripStop.trip_id == Trip.id)
        .join(Place, TripStop.place_id == Place.id)
        .where(TripStop.id == trip_stop_id, Trip.user_id == user_id)
    )
    row = result.first()
    if row is None:
        raise BookingError("Trip stop not found", status_code=404)
    return row[0], row[1]


async def _get_own_booking(db: AsyncSession, user_id, booking_id) -> Booking:
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id, Booking.user_id == user_id)
    )
    booking = result.scalar_one_or_none()
    if booking is None:
        raise BookingError("Booking not found", status_code=404)
    return booking


async def create_booking(
    db: AsyncSession, user_id, data: BookingCreate
) -> Booking:
    if data.provider not in SUPPORTED_PROVIDERS:
        raise BookingError(
            f"Unknown provider '{data.provider}'. Supported: {', '.join(SUPPORTED_PROVIDERS)}"
        )
    _, place = await _get_stop_with_place(db, user_id, data.trip_stop_id)

    deep_link = build_deep_link(data.provider, place)
    booking = Booking(
        user_id=user_id,
        trip_stop_id=data.trip_stop_id,
        provider=data.provider,
        status="pending",
        booking_details={
            "deep_link": deep_link,
            "visit_date": data.visit_date.isoformat() if data.visit_date else None,
            "place_name": place.name,
        },
    )
    db.add(booking)
    await db.commit()
    await db.refresh(booking)
    return booking


async def confirm_booking(
    db: AsyncSession, user_id, booking_id, data: BookingConfirm
) -> Booking:
    booking = await _get_own_booking(db, user_id, booking_id)
    if booking.status == "cancelled":
        raise BookingError("Booking is cancelled, create a new one")

    booking.status = "confirmed"
    booking.external_id = data.external_id
    booking.amount = data.amount
    booking.currency = data.currency.upper() if data.currency else None

    stop, _ = await _get_stop_with_place(db, user_id, booking.trip_stop_id)
    stop.is_booked = True
    stop.booking_ref = data.external_id or str(booking.id)[:8]

    await db.commit()
    await db.refresh(booking)
    return booking


async def cancel_booking(db: AsyncSession, user_id, booking_id) -> Booking:
    booking = await _get_own_booking(db, user_id, booking_id)
    booking.status = "cancelled"

    stop, _ = await _get_stop_with_place(db, user_id, booking.trip_stop_id)
    stop.is_booked = False
    stop.booking_ref = None

    await db.commit()
    await db.refresh(booking)
    return booking


async def list_bookings(db: AsyncSession, user_id) -> list[Booking]:
    result = await db.execute(
        select(Booking)
        .where(Booking.user_id == user_id)
        .order_by(Booking.booked_at.desc())
    )
    return list(result.scalars().all())


def booking_to_dict(booking: Booking) -> dict:
    """Booking -> dict под BookingResponse (deep_link лежит в booking_details)."""
    details = booking.booking_details or {}
    return {
        "id": booking.id,
        "trip_stop_id": booking.trip_stop_id,
        "provider": booking.provider,
        "status": booking.status,
        "booked_at": booking.booked_at,
        "external_id": booking.external_id,
        "amount": booking.amount,
        "currency": booking.currency,
        "deep_link": details.get("deep_link"),
    }
