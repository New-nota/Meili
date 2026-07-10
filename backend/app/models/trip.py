import uuid
from datetime import datetime, date, time
from sqlalchemy import String, Integer, Boolean, ARRAY, TIMESTAMP, DATE, TIME, TEXT, ForeignKey, UniqueConstraint
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
    start_address: Mapped[str| None] = mapped_column(String, nullable=True)
    start_lat: Mapped[float | None] = mapped_column(nullable=True)
    start_lon: Mapped[float| None] = mapped_column(nullable=True)
    start_time: Mapped[time|None] = mapped_column(TIME, nullable=True)
    # S8 WP-3: диапазон поездки; дни (trip_days) — источник истины маршрута,
    # одиночные start_* выше остаются для обратной совместимости
    start_date: Mapped[date | None] = mapped_column(DATE, nullable=True)
    end_date: Mapped[date | None] = mapped_column(DATE, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, default=datetime.utcnow)

    stops: Mapped[list["TripStop"]] = relationship("TripStop", back_populates="trip", passive_deletes=True)


class TripLocation(Base):
    """История стартов/финишей поездки: отели, адреса, вокзалы (S8 WP-3)."""
    __tablename__ = "trip_locations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    address: Mapped[str | None] = mapped_column(String, nullable=True)
    lat: Mapped[float] = mapped_column(nullable=False)
    lon: Mapped[float] = mapped_column(nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False, default="lodging", server_default="lodging")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, default=datetime.utcnow)


class TripDay(Base):
    """День поездки со своими стартом/финишем и временными рамками (S8 WP-3)."""
    __tablename__ = "trip_days"
    __table_args__ = (
        UniqueConstraint("trip_id", "date", name="uq_trip_days_trip_date"),
        UniqueConstraint("trip_id", "day_index", name="uq_trip_days_trip_index"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False)
    date: Mapped[date] = mapped_column(DATE, nullable=False)
    day_index: Mapped[int] = mapped_column(Integer, nullable=False)  # 0-based
    start_location_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("trip_locations.id"), nullable=True)
    end_location_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("trip_locations.id"), nullable=True)
    start_time: Mapped[time] = mapped_column(TIME, nullable=False, default=time(9, 0), server_default="09:00")
    end_time: Mapped[time] = mapped_column(TIME, nullable=False, default=time(21, 0), server_default="21:00")

    start_location: Mapped["TripLocation | None"] = relationship("TripLocation", foreign_keys=[start_location_id])
    end_location: Mapped["TripLocation | None"] = relationship("TripLocation", foreign_keys=[end_location_id])

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
    # S8 WP-3: принадлежность дню — источник истины (visit_date — зеркало)
    day_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("trip_days.id", ondelete="CASCADE"), nullable=True)
    # S8 WP-4: selective TSP — 0 обычный, 1 высокий, 2 обязательный (must-visit)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # false = стоп исключён селективным прогоном («не влезло в день»)
    included_in_route: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    trip: Mapped["Trip"] = relationship("Trip", back_populates="stops")
    place: Mapped["Place"] = relationship("Place")
    
