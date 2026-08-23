"""Диалог с ассистентом Meili (ТЗ-Meili M1).

conversation.trip_id — NULL до «Применить» для новых поездок; executor
проставляет его сам. trip_id ВСЕГДА берётся отсюда (серверная сессия),
никогда из вывода модели (правило 1.9).
"""
import uuid
from datetime import datetime

from sqlalchemy import String, TEXT, TIMESTAMP, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    # поездка удалена -> диалог живёт дальше без привязки
    trip_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("trips.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    # M5: свёрнутая история; сообщения старше summary_covers_until уже в summary
    summary: Mapped[str | None] = mapped_column(TEXT, nullable=True)
    summary_covers_until: Mapped[datetime | None] = mapped_column(TIMESTAMP, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
