"""Оптимизация маршрута дня (S8 WP-3): путь от старта дня к финишу дня.

Прежний trip-level эндпоинт заменён на per-day (см. ТЗ S8).
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update as sql_update
from sqlalchemy.orm import selectinload

from app.api.days import _day_or_404
from app.api.stops import get_trip_or_404
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.trip import Trip, TripStop
from app.models.user import User
from app.schemas.optimize import OptimizeRequest, OptimizeResponse
from app.services.optimizer import (
    MustVisitOverBudgetError,
    OutOfCoverageError,
    optimize_day_stops,
)

router = APIRouter(tags=["optimize"])


@router.post("/trips/{trip_id}/days/{day_id}/optimize", response_model=OptimizeResponse)
async def optimize_day(
    trip_id: UUID,
    day_id: UUID,
    body: OptimizeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    trip = await get_trip_or_404(trip_id, current_user.id, db)
    day = await _day_or_404(db, trip_id, day_id)

    if day.start_location is None or day.end_location is None:
        raise HTTPException(
            status_code=400, detail="day_locations_missing"
        )

    result = await db.execute(
        select(TripStop)
        .where(TripStop.day_id == day_id)
        .options(selectinload(TripStop.place))
        .order_by(TripStop.position)
    )
    stops = list(result.scalars().all())
    if not stops:
        raise HTTPException(status_code=400, detail="day_no_stops")

    try:
        ordered_ids, dropped_ids = await optimize_day_stops(
            day,
            stops,
            trip.transport_default,
            mode=body.mode,
            time_budget_minutes=body.time_budget_minutes,
        )
    except OutOfCoverageError:
        raise HTTPException(status_code=422, detail="day_out_of_coverage")
    except MustVisitOverBudgetError:
        # 409: обязательные не влезают — стопы НЕ перезаписываем
        raise HTTPException(status_code=409, detail="must_visit_over_budget")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # вошедшие в маршрут: порядок + included_in_route=true
    for new_pos, stop_id in enumerate(ordered_ids):
        await db.execute(
            sql_update(TripStop)
            .where(TripStop.id == stop_id)
            .values(position=new_pos, included_in_route=True)
        )
    # исключённые селективным прогоном: included=false, позиции — после
    # включённых (position NOT NULL в модели, семантику несёт флаг)
    for offset, stop_id in enumerate(dropped_ids):
        await db.execute(
            sql_update(TripStop)
            .where(TripStop.id == stop_id)
            .values(position=len(ordered_ids) + offset, included_in_route=False)
        )
    await db.commit()

    return OptimizeResponse(
        ordered_stop_ids=[UUID(s) for s in ordered_ids],
        dropped_stop_ids=[UUID(s) for s in dropped_ids],
    )
