"""Расчёт бюджета поездки (S9 WP-A). Все деньги — Decimal, без конвертаций.

Активности считаются из стопов (единый источник, без двойного учёта):
для забронированного стопа — фактическая сумма брони, иначе оценка
estimated_cost. Остальные категории — из trip_expenses.
"""
from decimal import Decimal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.booking import Booking
from app.models.trip import Trip, TripExpense, TripStop

EXPENSE_CATEGORIES = ("lodging", "transport", "food", "other")

ZERO = Decimal("0")


class BudgetSummary(BaseModel):
    budget_total: Decimal | None
    currency: str
    activities_total: Decimal
    expenses_total: Decimal
    planned_total: Decimal
    booked_total: Decimal
    remaining: Decimal | None
    over_budget: bool
    per_day: dict[str, Decimal]        # day_id (или "unassigned") -> planned
    per_category: dict[str, Decimal]   # activity/lodging/transport/food/other


async def compute_budget(db: AsyncSession, trip: Trip) -> BudgetSummary:
    stops = (await db.execute(
        select(TripStop).where(TripStop.trip_id == trip.id)
    )).scalars().all()

    # подтверждённые брони по стопам поездки
    stop_ids = [s.id for s in stops]
    bookings_by_stop: dict = {}
    if stop_ids:
        rows = (await db.execute(
            select(Booking).where(
                Booking.trip_stop_id.in_(stop_ids),
                Booking.status == "confirmed",
            )
        )).scalars().all()
        for b in rows:
            bookings_by_stop[b.trip_stop_id] = b

    per_day: dict[str, Decimal] = {}
    per_category: dict[str, Decimal] = {c: ZERO for c in ("activity", *EXPENSE_CATEGORIES)}

    def add_day(day_id, amount: Decimal):
        key = str(day_id) if day_id else "unassigned"
        per_day[key] = per_day.get(key, ZERO) + amount

    activities_total = ZERO
    booked_total = ZERO
    for stop in stops:
        booking = bookings_by_stop.get(stop.id)
        if booking is not None and booking.amount is not None:
            cost = Decimal(booking.amount)
            booked_total += cost
        elif not stop.included_in_route:
            # QA: «не влезло в день» — места нет в маршруте, PDF и календаре,
            # а в «Запланировано» оно сидело. Не считаем; бронь — считаем
            # (выше): подтверждённые деньги потрачены, где бы ни было место
            continue
        else:
            cost = Decimal(stop.estimated_cost) if stop.estimated_cost is not None else ZERO
        if cost != ZERO:
            activities_total += cost
            per_category["activity"] += cost
            add_day(stop.day_id, cost)

    expenses = (await db.execute(
        select(TripExpense).where(TripExpense.trip_id == trip.id)
    )).scalars().all()
    expenses_total = ZERO
    for e in expenses:
        amount = Decimal(e.amount)
        expenses_total += amount
        per_category[e.category] = per_category.get(e.category, ZERO) + amount
        add_day(e.day_id, amount)

    planned_total = activities_total + expenses_total
    budget_total = Decimal(trip.budget_total) if trip.budget_total is not None else None
    remaining = budget_total - planned_total if budget_total is not None else None
    over_budget = budget_total is not None and planned_total > budget_total

    return BudgetSummary(
        budget_total=budget_total,
        currency=trip.currency,
        activities_total=activities_total,
        expenses_total=expenses_total,
        planned_total=planned_total,
        booked_total=booked_total,
        remaining=remaining,
        over_budget=over_budget,
        per_day=per_day,
        per_category=per_category,
    )
