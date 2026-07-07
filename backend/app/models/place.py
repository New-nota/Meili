import uuid
from sqlalchemy import String, Integer, Boolean, ARRAY, DECIMAL, JSON, Index, text
from sqlalchemy.orm import Mapped, mapped_column
from geoalchemy2 import Geometry
from app.core.database import Base

class Place(Base):
    __tablename__ = "places"

    __table_args__ = (
        Index("uq_places_osm_id", "osm_id", unique=True, postgresql_where=text("osm_id IS NOT NULL"),),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    osm_id: Mapped[str | None] = mapped_column(String, nullable=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    address: Mapped[str | None] = mapped_column(String, nullable=True)
    city: Mapped[str | None] = mapped_column(String, nullable=True)
    country: Mapped[str | None] = mapped_column(String, nullable=True)
    location: Mapped[str | None] = mapped_column(Geometry(geometry_type="POINT", srid=4326), nullable=True)
    rating: Mapped[float | None] = mapped_column(DECIMAL(3,2), nullable=True)
    price_level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    suitable_for_children: Mapped[bool] = mapped_column(Boolean, nullable=True)
    min_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    opening_hours: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    booking_url: Mapped[str | None] = mapped_column(String, nullable=True)
    booking_provider: Mapped[str | None] = mapped_column(String, nullable=True)
    photos: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
