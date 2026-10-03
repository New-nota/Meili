import uuid
from datetime import datetime
from sqlalchemy import ARRAY, TIMESTAMP, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    travel_style: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)
    home_city: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, default=datetime.utcnow)

    # QA: email регистронезависимый (миграция a6b78a4d003a) — дубль по
    # регистру не пролезет даже мимо нормализации в схемах
    __table_args__ = (
        Index("ix_users_email_lower", func.lower(email), unique=True),
    )

