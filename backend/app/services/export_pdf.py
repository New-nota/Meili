"""PDF-итинерарий (S9 WP-B): Jinja2-шаблон -> WeasyPrint.

Только стопы с included_in_route=true (S8 WP-4), в порядке position.
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.i18n import DEFAULT_LANG, Lang, t
from app.models.place import Place
from app.models.trip import Trip, TripDay, TripStop
from app.services.budget import compute_budget

_env = Environment(
    loader=FileSystemLoader(Path(__file__).parent.parent / "templates"),
    autoescape=select_autoescape(["html"]),
)


async def collect_itinerary(db: AsyncSession, trip: Trip, lang: Lang = DEFAULT_LANG) -> dict:
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

    from app.api.stops import booked_amounts  # поздний импорт: цикл api <-> services

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
        booked = await booked_amounts(db, [stop.id for stop, _ in rows])
        result.append({
            "day": day,
            "start_location": day.start_location,
            "end_location": day.end_location,
            "stops": [
                {
                    "stop": stop,
                    "place": place,
                    "opening": _opening_str(place.opening_hours),
                    "cost": _cost_str(stop, place, booked.get(stop.id), trip.currency, lang),
                }
                for stop, place in rows
            ],
        })
    return {"days": result}


def _cost_str(stop, place, booked_amount, currency: str, lang: Lang = DEFAULT_LANG) -> str | None:
    """QA: стоимость стопа в PDF по тем же правилам, что UI (utils/costLabel).

    Раньше печаталось «~estimated_cost» всегда: и для ручной суммы (должна
    быть без «~»), и для забронированного места (должен быть факт брони),
    а диапазон-оценка Meili и «бесплатно» не печатались вовсе.
    """
    if booked_amount is not None:
        return t(lang, "cost.booked", amount=booked_amount, currency=currency)
    if stop.cost_min is not None and stop.cost_max is not None:
        return f"~{stop.cost_min}–{stop.cost_max} {currency}"
    if stop.cost_source == "auto" and getattr(place, "pricing_model", None) == "free":
        return t(lang, "cost.free")
    if stop.estimated_cost is None:
        return None
    approx = stop.cost_is_estimate or stop.cost_source in ("auto", "estimate")
    return f"{'~' if approx else ''}{stop.estimated_cost} {currency}"


def _opening_str(opening_hours) -> str | None:
    if isinstance(opening_hours, dict) and "open" in opening_hours and "close" in opening_hours:
        return f"{opening_hours['open']}–{opening_hours['close']}"
    if isinstance(opening_hours, str):
        return opening_hours
    return None


async def render_itinerary_pdf(db: AsyncSession, trip: Trip, lang: Lang = DEFAULT_LANG) -> bytes:
    from weasyprint import HTML  # импорт тут: тяжёлый и нужен только на экспорт

    data = await collect_itinerary(db, trip, lang)
    budget = await compute_budget(db, trip)
    html = _env.get_template("itinerary.html").render(
        trip=trip, days=data["days"], budget=budget,
        lang=lang, t=lambda key, **kw: t(lang, key, **kw),
    )
    return HTML(string=html).write_pdf()
