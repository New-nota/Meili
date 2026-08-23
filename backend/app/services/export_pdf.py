"""PDF-итинерарий (S9 WP-B): Jinja2-шаблон -> WeasyPrint.

Только стопы с included_in_route=true (S8 WP-4), в порядке position.
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.place import Place
from app.models.trip import Trip, TripDay, TripStop
from app.services.budget import compute_budget

_env = Environment(
    loader=FileSystemLoader(Path(__file__).parent.parent / "templates"),
    autoescape=select_autoescape(["html"]),
)


async def collect_itinerary(db: AsyncSession, trip: Trip) -> dict:
    """Общие данные для PDF и ICS: дни -> стопы (included, по position)."""
    days = (await db.execute(
        select(TripDay)
        .where(TripDay.trip_id == trip.id)
        .order_by(TripDay.position)
        .options(
            selectinload(TripDay.start_location),
            selectinload(TripDay.end_location),
        )
    )).scalars().all()

    result = []
    for day in days:
        rows = (await db.execute(
            select(TripStop, Place)
            .join(Place, TripStop.place_id == Place.id)
            .where(
                TripStop.day_id == day.id,
                TripStop.included_in_route.is_(True),
            )
            .order_by(TripStop.position)
        )).all()
        result.append({
            "day": day,
            "start_location": day.start_location,
            "end_location": day.end_location,
            "stops": [
                {
                    "stop": stop,
                    "place": place,
                    "opening": _opening_str(place.opening_hours),
                }
                for stop, place in rows
            ],
        })
    return {"days": result}


def _opening_str(opening_hours) -> str | None:
    if isinstance(opening_hours, dict) and "open" in opening_hours and "close" in opening_hours:
        return f"{opening_hours['open']}–{opening_hours['close']}"
    if isinstance(opening_hours, str):
        return opening_hours
    return None


async def render_itinerary_pdf(db: AsyncSession, trip: Trip) -> bytes:
    from weasyprint import HTML  # импорт тут: тяжёлый и нужен только на экспорт

    data = await collect_itinerary(db, trip)
    budget = await compute_budget(db, trip)
    html = _env.get_template("itinerary.html").render(
        trip=trip, days=data["days"], budget=budget
    )
    return HTML(string=html).write_pdf()
