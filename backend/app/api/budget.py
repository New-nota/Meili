"""Бюджет поездки: статьи расходов + сводка (S9 WP-A)."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.stops import get_trip_or_404
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.trip import TripDay, TripExpense
from app.models.user import User
from app.schemas.expenses import ExpenseCreate, ExpenseResponse, ExpenseUpdate
from app.services.budget import BudgetSummary, compute_budget
from app.services.budget_estimate import recompute_auto_stops

router = APIRouter(prefix="/trips", tags=["budget"])


@router.get("/{trip_id}/budget", response_model=BudgetSummary)
async def get_budget(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    trip = await get_trip_or_404(trip_id, current_user.id, db)
    return await compute_budget(db, trip)


@router.post("/{trip_id}/recompute-estimates")
async def recompute_estimates(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ТЗ-E: ручной пересчёт авто-оценок (кнопка «обновить оценки»).

    Нужен после массового ре-сида цен — он авто-пересчёт не триггерит.
    """
    trip = await get_trip_or_404(trip_id, current_user.id, db)
    updated = await recompute_auto_stops(db, trip)
    await db.commit()
    return {"updated": updated}


@router.get("/{trip_id}/expenses", response_model=list[ExpenseResponse])
async def list_expenses(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_trip_or_404(trip_id, current_user.id, db)
    result = await db.execute(
        select(TripExpense)
        .where(TripExpense.trip_id == trip_id)
        .order_by(TripExpense.created_at)
    )
    return result.scalars().all()


@router.post("/{trip_id}/expenses", response_model=ExpenseResponse, status_code=201)
async def add_expense(
    trip_id: UUID,
    data: ExpenseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    trip = await get_trip_or_404(trip_id, current_user.id, db)

    # одна валюта на поездку, без конвертаций
    currency = (data.currency or trip.currency).upper()
    if currency != trip.currency:
        raise HTTPException(status_code=400, detail="expense_currency_mismatch")

    if data.day_id is not None:
        await _day_of_trip_or_404(db, trip_id, data.day_id)

    expense = TripExpense(
        trip_id=trip_id,
        day_id=data.day_id,
        category=data.category,
        title=data.title,
        amount=data.amount,
        currency=currency,
    )
    db.add(expense)
    await db.commit()
    await db.refresh(expense)
    return expense


async def _day_of_trip_or_404(db, trip_id, day_id) -> None:
    day = await db.execute(
        select(TripDay.id).where(TripDay.id == day_id, TripDay.trip_id == trip_id)
    )
    if day.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Day not found")


async def _expense_or_404(db, trip_id, expense_id) -> TripExpense:
    result = await db.execute(
        select(TripExpense).where(
            TripExpense.id == expense_id, TripExpense.trip_id == trip_id
        )
    )
    expense = result.scalar_one_or_none()
    if expense is None:
        raise HTTPException(status_code=404, detail="Expense not found")
    return expense


@router.patch("/{trip_id}/expenses/{expense_id}", response_model=ExpenseResponse)
async def update_expense(
    trip_id: UUID,
    expense_id: UUID,
    data: ExpenseUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_trip_or_404(trip_id, current_user.id, db)
    expense = await _expense_or_404(db, trip_id, expense_id)
    updates = data.model_dump(exclude_unset=True)
    # QA: в create день проверялся, в update — нет: статью можно было
    # привязать к дню ЧУЖОЙ поездки (id существует — FK молчит), а к
    # несуществующему дню — уронить FK в 500
    if updates.get("day_id") is not None:
        await _day_of_trip_or_404(db, trip_id, updates["day_id"])
    for field, value in updates.items():
        setattr(expense, field, value)
    await db.commit()
    await db.refresh(expense)
    return expense


@router.delete("/{trip_id}/expenses/{expense_id}", status_code=204)
async def delete_expense(
    trip_id: UUID,
    expense_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_trip_or_404(trip_id, current_user.id, db)
    expense = await _expense_or_404(db, trip_id, expense_id)
    await db.delete(expense)
    await db.commit()
