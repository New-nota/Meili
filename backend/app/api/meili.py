"""API ассистента Meili (ТЗ-Meili M1.5): диалоги + SSE-стриминг.

Все эндпоинты требуют авторизации; владелец диалога проверяется на входе
(403 чужому). Без LLM_API_KEY отправка сообщения отвечает 501 (паттерн R2/OAuth).
"""
import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.redis import acquire_turn_lock, release_turn_lock, take_meili_turn_slot
from app.core.security import get_current_user
from app.services.meili.plan_refs import resolve_references
from app.models.conversation import Conversation
from app.models.meili_plan import MeiliPlan
from app.models.message import Message
from app.models.trip import Trip
from app.models.user import User
from app.schemas.meili import (
    ConversationRead, MessageRead, PlanRead, TripDraftIn, UserMessageIn,
)
from app.schemas.plan import ProposedPlan
from app.services.meili.executor import ApplyError, ApplyResult, apply_plan
from app.services.meili.loop import run_turn

router = APIRouter(prefix="/api/meili", tags=["meili"])


async def get_conversation_or_403(
    conversation_id: UUID, user_id: UUID, db: AsyncSession
) -> Conversation:
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not your conversation")
    return conversation


@router.post("/conversations", response_model=ConversationRead, status_code=201)
async def create_conversation(
    trip_id: UUID | None = None,  # query-параметр: открыт со страницы поездки
    # S17: чат открыт из мастера создания — черновик приходит структурно,
    # а не пересказом в первом сообщении (см. TripDraftIn)
    draft: TripDraftIn | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if trip_id is not None:
        trip = (await db.execute(
            select(Trip).where(Trip.id == trip_id, Trip.user_id == current_user.id)
        )).scalar_one_or_none()
        if trip is None:
            raise HTTPException(status_code=404, detail="Trip not found")

    conversation = Conversation(
        user_id=current_user.id,
        trip_id=trip_id,
        # mode="json": Decimal/date должны лечь в JSONB, а не упасть сериализацией
        draft_json=draft.model_dump(mode="json", exclude_none=True) if draft else None,
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return conversation


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageRead])
async def get_messages(
    conversation_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_conversation_or_403(conversation_id, current_user.id, db)
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id, Message.role.in_(["user", "assistant"]))
        .order_by(Message.created_at)
    )
    return result.scalars().all()


def sse(event: dict) -> str:
    """Событие агент-цикла -> проволочный формат SSE."""
    return f"event: {event['event']}\ndata: {json.dumps(event['data'], ensure_ascii=False)}\n\n"


@router.post("/conversations/{conversation_id}/messages")
async def post_message(
    conversation_id: UUID,
    data: UserMessageIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_conversation_or_403(conversation_id, current_user.id, db)
    if not settings.LLM_API_KEY:
        raise HTTPException(status_code=501, detail="llm_not_configured")
    if not await take_meili_turn_slot(current_user.id):
        raise HTTPException(status_code=429, detail="too_many_requests")
    # QA: один ход на диалог — второй параллельный получает 409, а не
    # перемешивает историю первого
    lock_ttl = settings.LLM_MAX_STEPS * settings.LLM_STEP_TIMEOUT_S + 30
    if not await acquire_turn_lock(conversation_id, lock_ttl):
        raise HTTPException(status_code=409, detail="turn_in_progress")

    async def event_stream():
        try:
            async for event in run_turn(db, conversation_id, data.content, data.client_tz):
                yield sse(event)
        finally:
            # и на обрыве клиента: генератор закрывается, finally отрабатывает
            await release_turn_lock(conversation_id)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        # SSE не кэшируется и не буферизуется прокси
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --- планы (M3) ---


async def get_plan_or_403(plan_id: UUID, user_id: UUID, db: AsyncSession) -> MeiliPlan:
    plan = (await db.execute(
        select(MeiliPlan).where(MeiliPlan.id == plan_id)
    )).scalar_one_or_none()
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    await get_conversation_or_403(plan.conversation_id, user_id, db)
    return plan


@router.post("/plans/{plan_id}/apply", response_model=ApplyResult)
async def apply_plan_endpoint(
    plan_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """✔ Применить (M4): единственная точка записи плана в поездку.
    Идемпотентен: повторный вызов applied-плана возвращает прежний результат."""
    try:
        return await apply_plan(db, plan_id, current_user.id)
    except ApplyError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


@router.post("/plans/{plan_id}/discard", response_model=PlanRead)
async def discard_plan(
    plan_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """✕ закрыть: план отклонён, к записи не ведёт."""
    plan = await get_plan_or_403(plan_id, current_user.id, db)
    if plan.status == "applied":
        raise HTTPException(status_code=409, detail="plan_already_applied")
    plan.status = "discarded"
    await db.commit()
    await db.refresh(plan)
    return plan


@router.post("/plans/{plan_id}/refreeze", response_model=PlanRead)
async def refreeze_plan(
    plan_id: UUID,
    data: ProposedPlan,  # правки валидируются той же схемой — граница держится
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """✎ виртуальный редактор (M3.5): правки формируют НОВЫЙ замороженный план,
    старый — discarded. Поездка не тронута: запись — только «Применить»."""
    old = await get_plan_or_403(plan_id, current_user.id, db)
    if old.status != "proposed":
        raise HTTPException(status_code=409, detail=f"plan_{old.status}")
    # QA: правленый план проходит ту же проверку ссылок, что и план модели —
    # иначе через refreeze можно было заморозить несуществующие place/stop id
    conversation = await db.get(Conversation, old.conversation_id)
    problems = await resolve_references(
        db, data, conversation.trip_id, conversation.recent_places_json,
    )
    if problems:
        raise HTTPException(status_code=422, detail="; ".join(problems))
    old.status = "discarded"
    new_plan = MeiliPlan(
        conversation_id=old.conversation_id,
        plan_json=data.model_dump(mode="json"),
    )
    db.add(new_plan)
    await db.commit()
    await db.refresh(new_plan)
    return new_plan
