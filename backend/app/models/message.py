"""Сообщение диалога Meili (ТЗ-Meili M1).

tool_calls — сырые tool-вызовы и их результаты (аудит); в LLM-окно
они НЕ подмешиваются (правило M2.6), живут только в этом JSONB.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, TEXT, TIMESTAMP, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String, nullable=False)  # 'user' | 'assistant' | 'tool'
    content: Mapped[str] = mapped_column(TEXT, nullable=False)
    # список {name, arguments, result} за ход
    tool_calls: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)  # триггер суммаризации (M5)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, default=datetime.utcnow, nullable=False)
