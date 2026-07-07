"""Сервис бронирования — Спринт 6.

Стратегия S6 (см. PROGRESS.md): сначала deep-link — ведём пользователя на
страницу партнёра (Viator / OpenTable / TheFork), позже, где партнёр даёт API, —
встроенное бронирование.

Здесь пока только каркас: сигнатуры + контракты. Логику наполняем в S6.
Модель `Booking`, схемы `BookingCreate/BookingResponse` и миграция `bookings`
уже готовы — этот модуль связывает их с trip_stops и провайдерами.
"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.booking import Booking
from app.models.place import Place
from app.schemas.bookings import BookingCreate

# Провайдеры, для которых строим deep-link на этапе 1 S6.
SUPPORTED_PROVIDERS: tuple[str, ...] = ("viator", "opentable", "thefork")


def build_deep_link(provider: str, place: Place) -> str | None:
    """Собрать ссылку на страницу бронирования у партнёра.

    Приоритет: если у места уже есть `place.booking_url` — используем его.
    Иначе строим поисковый deep-link под конкретного провайдера по
    названию/координатам места.

    TODO(S6):
      - форматы ссылок Viator / OpenTable / TheFork;
      - партнёрский affiliate/partner id из настроек;
      - валидация `provider` по SUPPORTED_PROVIDERS.
    """
    raise NotImplementedError("S6: построение deep-link")


async def create_booking(
    db: AsyncSession,
    user_id: str,
    trip_stop_id: str,
    data: BookingCreate,
) -> Booking:
    """Создать бронь в статусе 'pending' и вернуть её вместе с deep_link.

    TODO(S6):
      - проверить, что trip_stop принадлежит поездке пользователя;
      - собрать deep_link через build_deep_link(data.provider, place);
      - записать Booking(status='pending'), выставить TripStop.is_booked /
        booking_ref;
      - вернуть объект под BookingResponse (deep_link прокидывается отдельно).
    """
    raise NotImplementedError("S6: создание брони")
