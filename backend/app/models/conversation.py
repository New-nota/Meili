"""Диалог с ассистентом Meili (ТЗ-Meili M1).

conversation.trip_id — NULL до «Применить» для новых поездок; executor
проставляет его сам. trip_id ВСЕГДА берётся отсюда (серверная сессия),
никогда из вывода модели (правило 1.9).
"""
import uuid
from datetime import datetime

from sqlalchemy import String, TEXT, TIMESTAMP, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # поездка удалена -> диалог живёт дальше без привязки
    trip_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("trips.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    # Ревью (S17): черновик мастера создания — город с координатами, даты,
    # группа, бюджет и валюта. Раньше всё это уезжало в модель одной текстовой
    # строкой первого сообщения, и она их теряла: созданные ассистентом
    # поездки выходили с city=NULL и валютой EUR вместо выбранной.
    # Здесь факты лежат структурно: снапшот их показывает, executor берёт
    # оттуда то, чего модель знать не может (координаты города).
    draft_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Ревью: места, найденные search_places в этом диалоге — [{id, name}].
    # Результаты инструментов живут только внутри своего хода (в окно истории
    # они намеренно не подмешиваются, там JSONB-аудит), поэтому на следующем
    # ходе модель оставалась без единого настоящего place_id и СОЧИНЯЛА их —
    # вплоть до «a1b2c3d4-e5f6-7890-g1h2-...», где букв g/h/i в hex не бывает.
    # Executor такие планы отклонял, и ход превращался в цикл извинений.
    recent_places_json: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # M5: свёрнутая история; сообщения старше summary_covers_until уже в summary
    summary: Mapped[str | None] = mapped_column(TEXT, nullable=True)
    summary_covers_until: Mapped[datetime | None] = mapped_column(TIMESTAMP, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
