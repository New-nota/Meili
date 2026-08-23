"""Замороженный план Meili (ТЗ-Meili M3.2).

plan_json — прошедший валидацию ProposedPlan как есть; применяется executor'ом
ровно в замороженном виде (никаких «додумываний» между превью и записью).
"""
import uuid
from datetime import datetime

from sqlalchemy import String, TIMESTAMP, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MeiliPlan(Base):
    __tablename__ = "meili_plans"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    plan_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # 'proposed' | 'applied' | 'discarded' (строкой — стиль проекта)
    status: Mapped[str] = mapped_column(
        String, nullable=False, default="proposed", server_default="proposed"
    )
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, default=datetime.utcnow, nullable=False)
    applied_at: Mapped[datetime | None] = mapped_column(TIMESTAMP, nullable=True)
