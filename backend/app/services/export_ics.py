"""Экспорт календаря .ics (S9 WP-B): VEVENT на каждый included-стоп.

DTSTART = visit_date + visit_time в таймзоне поездки; без visit_time —
start_time дня. Длительность из duration_minutes (дефолт 60 минут).
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from ics import Calendar, Event
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.trip import Trip
from app.services.export_pdf import collect_itinerary

DEFAULT_EVENT_MINUTES = 60


async def render_trip_ics(db: AsyncSession, trip: Trip) -> str:
    tz = ZoneInfo(trip.timezone)
    data = await collect_itinerary(db, trip)

    cal = Calendar()
    for day_block in data["days"]:
        day = day_block["day"]
        for item in day_block["stops"]:
            stop, place = item["stop"], item["place"]
            date = stop.visit_date or day.date
            time_ = stop.visit_time or day.start_time
            begin = datetime.combine(date, time_, tzinfo=tz)
            minutes = stop.duration_minutes or DEFAULT_EVENT_MINUTES

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
                description.append(f"Бронь: {stop.booking_ref}")
            if description:
                event.description = "\n".join(description)
            cal.events.add(event)

    return cal.serialize()
