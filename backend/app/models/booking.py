import uuid
from datetime import datetime
from sqlalchemy import String, ForeignKey, DateTime, Numeric
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class Booking(Base):
    __tablename__ = "bookings"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    trip_stop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("trip_stops.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    external_id: Mapped[str | None] = mapped_column(String, nullable=True)
    amount: Mapped[float | None] = mapped_column(Numeric(10,2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    booked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    booking_details: Mapped[dict| None] = mapped_column(JSONB, nullable=True)
