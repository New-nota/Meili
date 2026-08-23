"""Инкрементальная суммаризация истории Meili (ТЗ-Meili M5.3).

Триггер — токены (`messages.token_count`), не число сообщений: когда
непокрытая summary история перерастает MEILI_WINDOW_TOKENS, «выпавшая» из
окна дельта сворачивается в существующий summary малой моделью
(LLM_MODEL_SUMMARY). Выполняется в Celery — пользователь латентности не ждёт.

Ядро (`summarize_conversation`) — обычная корутина: тесты зовут её напрямую,
Celery-таск — тонкая обёртка со своим engine (воркер — отдельный процесс).
"""
import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.logging import get_logger
from app.models.conversation import Conversation
from app.services.llm.factory import get_client
from app.services.meili.loop import load_uncovered_history
from app.workers.celery_app import celery_app

logger = get_logger("meili.summarize")

SUMMARY_PROMPT = (
    "Ты сворачиваешь историю диалога о планировании поездки. Обнови краткое "
    "резюме: сохрани договорённости (город, даты, состав группы, бюджет, "
    "пожелания), выкинь пустую болтовню. Ответь ТОЛЬКО текстом резюме, 5-8 строк."
)


async def summarize_conversation(db: AsyncSession, conversation_id) -> bool:
    """Свернуть выпавшую из окна дельту в summary. True — если свернули."""
    conversation = (await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )).scalar_one_or_none()
    if conversation is None:
        return False

    # непокрытые summary сообщения, старые -> новые (общая граница с loop)
    messages = await load_uncovered_history(db, conversation)

    total = sum(m.token_count or 0 for m in messages)
    if total <= settings.MEILI_WINDOW_TOKENS:
        return False  # окно ещё не переполнено

    # окно держим с хвоста; всё, что старше границы, — «выпавшая дельта»
    budget = settings.MEILI_WINDOW_TOKENS
    kept = 0
    boundary = len(messages)
    for i in range(len(messages) - 1, -1, -1):
        kept += messages[i].token_count or 0
        if kept > budget:
            boundary = i + 1
            break
    # последний обмен (user+assistant) всегда остаётся живым в окне
    boundary = min(boundary, max(0, len(messages) - 2))
    fallen = messages[:boundary]
    if not fallen:
        return False

    old_summary = conversation.summary or "(резюме ещё нет)"
    delta_text = "\n".join(f"{m.role}: {m.content}" for m in fallen)
    client = get_client()

    new_summary = ""
    try:
        async for event in client.stream(
            [
                {"role": "system", "content": SUMMARY_PROMPT},
                {"role": "user",
                 "content": f"Текущее резюме:\n{old_summary}\n\nНовые сообщения:\n{delta_text}"},
            ],
            tools=None,
            model=client.model_summary,
        ):
            if event.type == "token":
                new_summary += event.text
    finally:
        if closer := getattr(client, "aclose", None):
            await closer()

    if not new_summary.strip():
        return False  # модель промолчала — резюме не портим
    conversation.summary = new_summary.strip()
    conversation.summary_covers_until = fallen[-1].created_at
    await db.commit()
    logger.info("meili_summarized", conversation_id=str(conversation_id),
                folded=len(fallen))
    return True


@celery_app.task(name="meili.summarize_conversation")
def summarize_conversation_task(conversation_id: str) -> None:
    """Celery-обёртка: свой engine на прогон (воркер — отдельный процесс)."""
    async def _run():
        engine = create_async_engine(settings.DATABASE_URL)
        try:
            session_factory = async_sessionmaker(engine, expire_on_commit=False)
            async with session_factory() as db:
                await summarize_conversation(db, conversation_id)
        finally:
            await engine.dispose()

    asyncio.run(_run())
