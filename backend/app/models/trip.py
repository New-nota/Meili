import uuid
from datetime import datetime, date, time
from decimal import Decimal
from sqlalchemy import String, Integer, Boolean, ARRAY, TIMESTAMP, DATE, TIME, TEXT, ForeignKey, Index, Numeric, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.place import Place

class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(TEXT, nullable=True)
    city: Mapped[str | None] = mapped_column(String, nullable=True)
    country: Mapped[str | None] = mapped_column(String, nullable=True)
    # S11: центр карты по городу из автокомплита (отдельно от start_* — «дома»)
    city_lat: Mapped[float | None] = mapped_column(nullable=True)
    city_lon: Mapped[float | None] = mapped_column(nullable=True)
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
    # S9 WP-A: бюджет — одна валюта на поездку, деньги только Numeric
    budget_total: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR", server_default="EUR")
    # S9 WP-B: таймзона для времён в календарном экспорте. Ставится по
    # координатам города (geo.timezone_at); без них — UTC, не Калининград
    timezone: Mapped[str] = mapped_column(String, nullable=False, default="UTC", server_default="UTC")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, default=datetime.utcnow)

    stops: Mapped[list["TripStop"]] = relationship("TripStop", back_populates="trip", passive_deletes=True)


class TripLocation(Base):
    """История стартов/финишей поездки: отели, адреса, вокзалы (S8 WP-3)."""
    __tablename__ = "trip_locations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    address: Mapped[str | None] = mapped_column(String, nullable=True)
    lat: Mapped[float] = mapped_column(nullable=False)
    lon: Mapped[float] = mapped_column(nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False, default="lodging", server_default="lodging")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, default=datetime.utcnow)


class TripExpense(Base):
    """Нефиксированные траты поездки, кроме активностей (S9 WP-A).

    Активности НЕ хранятся здесь (категория 'activity' запрещена) —
    они считаются из стопов: bookings.amount / trip_stops.estimated_cost.
    """
    __tablename__ = "trip_expenses"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    day_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("trip_days.id", ondelete="SET NULL"), nullable=True)
    category: Mapped[str] = mapped_column(String, nullable=False)  # lodging|transport|food|other
    title: Mapped[str] = mapped_column(String, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)  # = trips.currency
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, default=datetime.utcnow)


class TripDay(Base):
    """День поездки со своими стартом/финишем и временными рамками (S8 WP-3).

    S16: у дня появилось имя. title=NULL — день не переименован; строка
    «День N» НЕ хранится в базе, её рисует фронт из position (1-based),
    чтобы смена формата подписи не оставляла в БД протухших копий.
    """
    __tablename__ = "trip_days"
    __table_args__ = (
        # S16: реордер дней переставляет даты/позиции в одной транзакции —
        # промежуточные состояния конфликтуют, проверка отложена до commit
        UniqueConstraint(
            "trip_id", "date", name="uq_trip_days_trip_date",
            deferrable=True, initially="DEFERRED",
        ),
        UniqueConstraint(
            "trip_id", "position", name="uq_trip_days_trip_position",
            deferrable=True, initially="DEFERRED",
        ),
        Index("ix_trip_days_trip_id", "trip_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False)
    date: Mapped[date] = mapped_column(DATE, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)  # 1-based (S16)
    title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    start_location_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("trip_locations.id"), nullable=True)
    end_location_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("trip_locations.id"), nullable=True)
    start_time: Mapped[time] = mapped_column(TIME, nullable=False, default=time(9, 0), server_default="09:00")
    end_time: Mapped[time] = mapped_column(TIME, nullable=False, default=time(21, 0), server_default="21:00")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    start_location: Mapped["TripLocation | None"] = relationship("TripLocation", foreign_keys=[start_location_id])
    end_location: Mapped["TripLocation | None"] = relationship("TripLocation", foreign_keys=[end_location_id])
    stops: Mapped[list["TripStop"]] = relationship(
        "TripStop", back_populates="day", passive_deletes=True,
        order_by="TripStop.position",
    )

class TripStop(Base):
    __tablename__ = "trip_stops"
    __table_args__ = (
        Index("ix_trip_stops_day_id", "day_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    place_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("places.id"), nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    visit_time: Mapped[time | None] = mapped_column(TIME, nullable=True)
    # S16: длительность визита есть всегда (дефолт из place, иначе 60)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=60, server_default="60")
    # S16: false — подставлено из places.duration_minutes (UI рисует «≈»),
    # true — юзер задал руками. На оптимизацию флаг не влияет.
    duration_is_custom: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    transport_to_next: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(TEXT, nullable=True)
    is_booked: Mapped[bool] = mapped_column(Boolean, default=False)
    booking_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    # S8 WP-3 / S16: день — единственный источник даты стопа (visit_date снесён)
    day_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trip_days.id", ondelete="CASCADE"), nullable=False)
    # S9 WP-A: оценка стоимости активности (на группу целиком)
    estimated_cost: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    # ТЗ-E: auto — сумму пересчитывает движок оценок; manual — ввёл юзер,
    # авто-пересчёт её не трогает. ТЗ-Meili расширяет значения источниками
    # цен: viator | price_level | estimate (движок трогает только auto)
    cost_source: Mapped[str] = mapped_column(String(20), nullable=False, default="auto", server_default="auto")
    # ТЗ-Meili M4.1: диапазон-оценка цены (M5.1) — когда точной цены нет;
    # cost_is_estimate помечает любую оценку (рисуется с «≈», не как факт).
    # Точная сумма живёт в estimated_cost (не дублируем поле, правило 1.6);
    # валюта — одна на поездку (trips.currency), отдельной колонки нет
    cost_min: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    cost_max: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    cost_is_estimate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # S8 WP-4: selective TSP — 0 обычный, 1 высокий, 2 обязательный (must-visit)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # false = стоп исключён селективным прогоном («не влезло в день»)
    included_in_route: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    trip: Mapped["Trip"] = relationship("Trip", back_populates="stops")
    place: Mapped["Place"] = relationship("Place")
    # S16: дата стопа = дата его дня (см. stop.day.date)
    day: Mapped["TripDay"] = relationship("TripDay", back_populates="stops")
    
