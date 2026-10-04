"""Экспорт календаря .ics (S9 WP-B): VEVENT на каждый included-стоп.

DTSTART = дата дня + visit_time в таймзоне поездки; без visit_time —
стопы идут цепочкой от start_time дня (QA). Длительность из
duration_minutes (дефолт 60 минут).
"""
import asyncio
import httpx
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from geoalchemy2.shape import to_shape
from ics import Calendar, Event
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.i18n import DEFAULT_LANG, Lang, t
from app.models.trip import Trip
from app.services.export_pdf import collect_itinerary
from app.services.valhalla import RouteError, route_legs

DEFAULT_EVENT_MINUTES = 60


async def _travel_after(day_block: dict, trip: Trip) -> tuple[int, list[int]]:
    """(секунды от старта дня до первого стопа, [секунды дороги ПОСЛЕ стопа i]).

    Та же цепочка точек, что у GET /trips/{id}/route. Valhalla недоступна или
    точки вне покрытия — дорога считается нулевой: календарь всё равно лучше,
    чем без него (раньше дороги не было вовсе).
    """
    stops = day_block["stops"]
    zero = (0, [0] * len(stops))
    points: list[dict] = []
    stop_point: list[int | None] = []   # индекс точки стопа (None — без координат)
    start, end = day_block["start_location"], day_block["end_location"]
    if start is not None:
        first_mode = stops[0]["stop"].transport_to_next if stops else None
        points.append({"lat": start.lat, "lon": start.lon, "mode": first_mode or trip.transport_default})
    for item in stops:
        place = item["place"]
        if place.location is None:
            stop_point.append(None)
            continue
        pt = to_shape(place.location)
        stop_point.append(len(points))
        points.append({"lat": pt.y, "lon": pt.x,
                       "mode": item["stop"].transport_to_next or trip.transport_default})
    if end is not None:
        points.append({"lat": end.lat, "lon": end.lon, "mode": None})
    if len(points) < 2:
        return zero
    try:
        legs = await route_legs(points)
    except (RouteError, httpx.HTTPError):
        return zero
    lead = legs[0]["duration_seconds"] if start is not None and stop_point and stop_point[0] == 1 else 0
    after = []
    for idx in stop_point:
        # перегон ПОСЛЕ стопа ведёт к следующему стопу; к финишу — не нужен
        if idx is None or idx >= len(legs) or idx + 1 >= len(points) - (1 if end is not None else 0):
            after.append(0)
        else:
            after.append(legs[idx]["duration_seconds"])
    return lead, after


async def render_trip_ics(db: AsyncSession, trip: Trip, lang: Lang = DEFAULT_LANG) -> str:
    tz = ZoneInfo(trip.timezone)
    data = await collect_itinerary(db, trip, lang)

    # ревью (профиль): дороги считались по дню за раз — 10 дней = 10
    # последовательных походов в Valhalla, .ics отдавался ~4 с. Дни независимы —
    # считаем параллельно (семафор, чтобы не завалить Valhalla 60-дневной поездкой)
    await db.commit()  # данные собраны — соединение в пул до походов в Valhalla
    gate = asyncio.Semaphore(6)

    async def travel(day_block):
        async with gate:
            return await _travel_after(day_block, trip)

    travels = await asyncio.gather(*(travel(b) for b in data["days"]))

    cal = Calendar()
    for day_block, (lead, travel_after) in zip(data["days"], travels):
        day = day_block["day"]
        # QA: без visit_time все стопы дня стартовали в start_time дня — в
        # календаре 3-5 событий в 09:00 друг на друге. Теперь цепочка:
        # старт дня → дорога → стоп → его длительность → дорога → следующий
        cursor = datetime.combine(day.date, day.start_time, tzinfo=tz) + timedelta(seconds=lead)
        for i, item in enumerate(day_block["stops"]):
            stop, place = item["stop"], item["place"]
            # S16: дата стопа = дата его дня (visit_date снесён)
            begin = (
                datetime.combine(day.date, stop.visit_time, tzinfo=tz)
                if stop.visit_time else cursor
            )
            minutes = stop.duration_minutes or DEFAULT_EVENT_MINUTES
            cursor = begin + timedelta(minutes=minutes, seconds=travel_after[i])

            event = Event(
                name=place.name,
                begin=begin,
                end=begin + timedelta(minutes=minutes),
                location=place.address or None,
            )
            description = []
            if stop.notes:
                description.append(stop.notes)
            if stop.is_booked and stop.booking_ref:
                description.append(t(lang, "ics.booking", ref=stop.booking_ref))
            if description:
                event.description = "\n".join(description)
            cal.events.add(event)

    return cal.serialize()
