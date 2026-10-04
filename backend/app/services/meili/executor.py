"""Executor планов Meili (ТЗ-Meili M4.2–M4.4) — единственная точка записи.

Тупой диспетчер: одна транзакция, actions по порядку, маппинг 1:1 на
существующие сервисы. Никакой новой бизнес-логики и никаких вызовов LLM.
trip_id берётся ТОЛЬКО из conversation (правило 1.9) — никогда из плана.
Ownership-guard перед каждой записью; любая ошибка -> ROLLBACK, план
остаётся proposed. Повторный apply applied-плана идемпотентен.
"""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.logging import get_logger
from app.models.conversation import Conversation
from app.models.meili_plan import MeiliPlan
from app.models.place import Place
from app.models.trip import Trip, TripDay, TripStop
from app.schemas.plan import (
    AddStopAction, CreateTripAction, OptimizeAction, ProposedPlan,
    RemoveStopAction, SetBudgetAction, SetStopCostAction,
)
from app.services import stops as stops_service
from app.services.budget_estimate import recompute_auto_stops
from app.services.optimizer import apply_day_optimization
from app.services.trips import DayError, sync_trip_days

logger = get_logger("meili.executor")


class ApplyError(Exception):
    """Доменная ошибка применения — роутер конвертирует в HTTP."""

    def __init__(self, detail: str, status_code: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class ApplyResult(BaseModel):
    plan_id: UUID
    status: str
    trip_id: UUID | None


async def _get_trip_owned(db: AsyncSession, trip_id: UUID, user_id: UUID) -> Trip:
    """Ownership-guard (M4.3): чужая поездка -> 403, записи не будет."""
    trip = (await db.execute(select(Trip).where(Trip.id == trip_id))).scalar_one_or_none()
    if trip is None:
        raise ApplyError("trip_not_found", 404)
    if trip.user_id != user_id:
        raise ApplyError("not_your_trip", 403)
    return trip


async def _stop_in_trip(db: AsyncSession, trip: Trip, stop_id: UUID) -> TripStop:
    stop = (await db.execute(
        select(TripStop).where(TripStop.id == stop_id, TripStop.trip_id == trip.id)
    )).scalar_one_or_none()
    if stop is None:
        raise ApplyError("stop_not_found", 400)
    return stop


def _apply_cost_fields(stop: TripStop, trip: Trip, *, amount, cost_min, cost_max,
                       currency, is_estimate, source) -> None:
    """Стоимость стопа из action. Валюта одна на поездку — mismatch = ошибка,
    конвертаций нет (доменное правило S9)."""
    if currency is not None and currency.upper() != trip.currency:
        raise ApplyError("currency_mismatch", 400)
    stop.estimated_cost = amount
    stop.cost_min = cost_min
    stop.cost_max = cost_max
    stop.cost_is_estimate = is_estimate
    if source is not None:
        stop.cost_source = source


async def _optimize_trip(db: AsyncSession, trip: Trip) -> None:
    """optimize-action: существующий сервис по каждому дню (Valhalla + OR-Tools).

    Дни без старта/финиша или без стопов пропускаются — у свежесозданной
    планом поездки локаций ещё нет, и это не ошибка плана.
    """
    days = (await db.execute(
        select(TripDay)
        .where(TripDay.trip_id == trip.id)
        .options(selectinload(TripDay.start_location), selectinload(TripDay.end_location))
        .order_by(TripDay.position)
    )).scalars().all()

    for day in days:
        # QA: дни без старта/финиша тоже оптимизируются (открытый путь)
        stops = list((await db.execute(
            select(TripStop)
            .where(TripStop.day_id == day.id)
            .options(selectinload(TripStop.place))
            .order_by(TripStop.position)
        )).scalars().all())
        if not stops:
            continue
        # оптимизация + запись позиций — общий сервис с api/optimize
        await apply_day_optimization(day, stops, trip.transport_default)


async def apply_plan(db: AsyncSession, plan_id: UUID, user_id: UUID) -> ApplyResult:
    # FOR UPDATE: два конкурентных apply не пройдут проверку статуса оба
    plan = (await db.execute(
        select(MeiliPlan).where(MeiliPlan.id == plan_id).with_for_update()
    )).scalar_one_or_none()
    if plan is None:
        raise ApplyError("plan_not_found", 404)

    conversation = (await db.execute(
        select(Conversation).where(Conversation.id == plan.conversation_id)
    )).scalar_one()
    if conversation.user_id != user_id:
        raise ApplyError("not_your_conversation", 403)

    # идемпотентность (M4.4): повторный вызов возвращает прежний результат
    if plan.status == "applied":
        prior_trip_id = conversation.trip_id
        await db.rollback()  # снимаем FOR UPDATE
        return ApplyResult(plan_id=plan_id, status="applied", trip_id=prior_trip_id)
    if plan.status == "discarded":
        await db.rollback()
        raise ApplyError("plan_discarded", 409)

    parsed = ProposedPlan.model_validate(plan.plan_json)  # замороженный план как есть

    try:
        trip: Trip | None = None
        if conversation.trip_id is not None:
            trip = await _get_trip_owned(db, conversation.trip_id, user_id)

        for action in parsed.actions:
            match action:
                case CreateTripAction():
                    if trip is not None:
                        raise ApplyError("trip_already_exists", 400)
                    # Ревью: черновик мастера (S17) — источник того, чего модель
                    # знать не может (координаты города) и что регулярно роняла
                    # (город, валюта, бюджет). Явное значение из плана главнее,
                    # черновик — фолбэк; координаты только из черновика.
                    draft = conversation.draft_json or {}
                    currency = (action.currency or draft.get("currency") or "").upper()
                    trip = Trip(
                        user_id=user_id,
                        title=action.title,
                        city=action.city or draft.get("city"),
                        country=action.country or draft.get("country"),
                        city_lat=draft.get("city_lat"),
                        city_lon=draft.get("city_lon"),
                        adults_count=action.adults_count,
                        children_count=action.children_count,
                        children_ages=action.children_ages,
                        transport_default=action.transport_default,
                        start_date=action.start_date,
                        end_date=action.end_date,
                        budget_total=draft.get("budget_total"),
                        **({"currency": currency} if currency else {}),
                    )
                    db.add(trip)
                    await db.flush()
                    await sync_trip_days(db, trip)  # существующий сервис дней
                    await db.flush()

                case AddStopAction():
                    if trip is None:
                        raise ApplyError("no_trip_in_conversation", 400)
                    place = (await db.execute(
                        select(Place).where(Place.id == action.place_id)
                    )).scalar_one_or_none()
                    if place is None:
                        raise ApplyError("place_not_found", 400)
                    # DSL плана остался 0-based; в БД position 1-based (S16).
                    # Без явного дня стоп идёт в первый день поездки —
                    # висящих стопов больше не бывает (day_id NOT NULL)
                    wanted_position = (action.day_index or 0) + 1
                    day = (await db.execute(
                        select(TripDay).where(
                            TripDay.trip_id == trip.id,
                            TripDay.position == wanted_position,
                        )
                    )).scalar_one_or_none()
                    if day is None:
                        raise ApplyError("day_not_found", 400)
                    try:
                        stop = await stops_service.add_stop(
                            db, trip, place, day=day,
                            duration_minutes=action.duration_minutes,
                            transport_to_next=trip.transport_default or "walking",
                        )
                    except stops_service.StopError as e:
                        raise ApplyError(str(e), 400)
                    if any(v is not None for v in (
                        action.cost_amount, action.cost_min, action.cost_max,
                    )):
                        _apply_cost_fields(
                            stop, trip,
                            amount=action.cost_amount,
                            cost_min=action.cost_min, cost_max=action.cost_max,
                            currency=action.cost_currency,
                            is_estimate=action.cost_is_estimate,
                            source=action.cost_source or "estimate",
                        )

                case RemoveStopAction():
                    if trip is None:
                        raise ApplyError("no_trip_in_conversation", 400)
                    stop = await _stop_in_trip(db, trip, action.stop_id)
                    await stops_service.remove_stop(db, stop)

                case SetBudgetAction():
                    if trip is None:
                        raise ApplyError("no_trip_in_conversation", 400)
                    # бюджет живёт в budget_total/currency (S9) — см. миграцию M4.1
                    trip.budget_total = action.amount
                    if action.currency.upper() != trip.currency:
                        # смена валюты — пересчёт авто-оценок, как в PUT /trips
                        trip.currency = action.currency.upper()
                        await recompute_auto_stops(db, trip)

                case SetStopCostAction():
                    if trip is None:
                        raise ApplyError("no_trip_in_conversation", 400)
                    stop = await _stop_in_trip(db, trip, action.stop_id)
                    _apply_cost_fields(
                        stop, trip,
                        amount=action.amount,
                        cost_min=action.cost_min, cost_max=action.cost_max,
                        currency=action.currency,
                        is_estimate=action.is_estimate,
                        source=action.source,
                    )

                case OptimizeAction():
                    if trip is None:
                        raise ApplyError("no_trip_in_conversation", 400)
                    await _optimize_trip(db, trip)

        # проставляем связь диалога с созданной поездкой (M4.2 шаг 4)
        if trip is not None and conversation.trip_id is None:
            conversation.trip_id = trip.id

        plan.status = "applied"
        plan.applied_at = datetime.utcnow()
        # id — до commit: после него атрибуты ORM экспарятся (MissingGreenlet)
        result_trip_id = trip.id if trip else conversation.trip_id
        await db.commit()  # одна транзакция на весь план
    except ApplyError:
        await db.rollback()  # план остаётся proposed
        raise
    except DayError as e:
        # Ревью: sync_trip_days теперь режет слишком длинный диапазон
        # (create_trip-action тоже ходит мимо TripCreate). Это ошибка ПЛАНА,
        # а не сбой сервера — отдаём доменный код, не «apply_failed» 500.
        await db.rollback()
        raise ApplyError(str(e), e.status_code)
    except Exception:
        await db.rollback()
        logger.exception("plan_apply_failed", plan_id=str(plan_id))
        raise ApplyError("apply_failed", 500)

    return ApplyResult(plan_id=plan_id, status="applied", trip_id=result_trip_id)
