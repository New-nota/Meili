import uuid
from datetime import datetime, date, time
from sqlalchemy import String, Integer, Boolean, ARRAY, TIMESTAMP, DATE, TIME, TEXT, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.place import Place

class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(TEXT, nullable=True)
    city: Mapped[str | None] = mapped_column(String, nullable=True)
    country: Mapped[str | None] = mapped_column(String, nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    adults_count: Mapped[int] = mapped_column(Integer, default=1)
    children_count: Mapped[int] = mapped_column(Integer, default=0)
    children_ages: Mapped[list[int] | None] = mapped_column(ARRAY(Integer), nullable=True)
    transport_default: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, default=datetime.utcnow)

    stops: Mapped[list["TripStop"]] = relationship("TripStop", back_populates="trip")

class TripStop(Base):
    __tablename__ = "trip_stops"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False)
    place_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("places.id"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    visit_date: Mapped[date | None] = mapped_column(DATE, nullable=True)
    visit_time: Mapped[time | None] = mapped_column(TIME, nullable=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    transport_to_next: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(TEXT, nullable=True)
    is_booked: Mapped[bool] = mapped_column(Boolean, default=False)
    booking_ref: Mapped[str | None] = mapped_column(String, nullable=True)

    trip: Mapped["Trip"] = relationship("Trip", back_populates="stops")
    place: Mapped["Place"] = relationship("Place")
    
