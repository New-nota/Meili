import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, Integer, TEXT, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
class TripLike(Base):
    __tablename__ = "trip_likes"

    # Ревью: ON DELETE CASCADE. Без него DELETE /trips/{id} падал 500-кой на
    # любой залайканной поездке — то есть ровно на публичных, которые для того
    # и публикуют. Лайк без поездки бессмыслен, поэтому удаляется вместе с ней.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"), primary_key=True
    )

class UserVisitedPlace(Base):
    __tablename__ = "user_visited_places"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    place_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("places.id"), primary_key=True)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # S15: опциональное впечатление (панель стопа / вечерний опрос)
    comment: Mapped[str | None] = mapped_column(TEXT, nullable=True)
    visited_at: Mapped[datetime] = mapped_column(TIMESTAMP, default=datetime.utcnow)