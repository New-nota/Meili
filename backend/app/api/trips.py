from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sql_delete
from sqlalchemy.orm import selectinload
from uuid import UUID
from sqlalchemy.exc import IntegrityError
from geoalchemy2.shape import to_shape

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.trip import Trip, TripStop, TripDay
from app.models.user import User
from app.schemas.trips import TripCreate, TripDetailResponse, TripUpdate, TripResponse
from app.models.social import TripLike
from app.api.days import days_to_response
from app.api.stops import get_trip_readable
from app.schemas.route import RouteLeg, RouteRead
from app.services.budget import compute_budget
from app.services.budget_estimate import recompute_auto_stops
from app.services.places.geo import DEFAULT_TIMEZONE, timezone_at
from app.services.trips import DayError, decorate_trip_rows, sync_trip_days
from app.services.valhalla import RouteError, route_legs

router = APIRouter(prefix="/trips", tags=["trips"])


def _mark_draft(trip: Trip) -> None:
    """S16: черновик — поездка без диапазона дат.

    Отдельной колонки нет: мастер создания (S11) требует даты, поэтому без
    них остаются только незавершённые/старые поездки. Фронт получает готовый
    флаг и не гадает (см. getTripStatus).
    """
    trip.is_draft = trip.start_date is None or trip.end_date is None


def _place_coords(place) -> dict | None:
    """Координаты места из PostGIS-точки; без геометрии — None."""
    if place is None or place.location is None:
        return None
    point = to_shape(place.location)
    return {"lat": point.y, "lon": point.x}


@router.get("/", response_model=list[TripResponse])
async def get_my_trips(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # QA: без order_by Postgres отдавал строки как придётся — после правки
    # поездка «прыгала» по сетке Discover. Свежие — первыми, как в профиле
    result = await db.execute(
        select(Trip).where(Trip.user_id == current_user.id)
        .order_by(Trip.created_at.desc())
    )
    # S16: строки профиля/Discover обогащает общий сервис
    return await decorate_trip_rows(db, list(result.scalars().all()))

@router.post("/", response_model=TripResponse, status_code=status.HTTP_201_CREATED)
async def create_trip(
    data: TripCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # exclude_none: не задан currency -> отработает server_default 'EUR'
    # (одна валюта на поездку, S11 мастер обычно шлёт валюту явно)
    trip = Trip(user_id=current_user.id, **data.model_dump(exclude_none=True))
    # таймзона — из координат города: факт системы, клиент её не шлёт
    trip.timezone = timezone_at(trip.city_lat, trip.city_lon) or DEFAULT_TIMEZONE
    db.add(trip)
    await db.flush()
    # диапазон дат задан -> генерируем trip_days (S8 WP-3)
    try:
        await sync_trip_days(db, trip)
    except DayError as e:
        await db.rollback()
        raise HTTPException(status_code=e.status_code, detail=str(e))
    await db.commit()
    await db.refresh(trip)
    return trip

@router.get("/{trip_id}", response_model=TripDetailResponse)
async def get_trip(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # S13: чтение и для превью (владелец ИЛИ публичная); приватная чужая -> 404
    trip = await get_trip_readable(trip_id, current_user.id, db)
    # состояние лайка текущего юзера — для иконки ❤ в превью
    liked = await db.execute(
        select(TripLike).where(
            TripLike.trip_id == trip_id, TripLike.user_id == current_user.id
        ).limit(1)
    )
    trip.liked_by_me = liked.scalar_one_or_none() is not None

    # S16 §1.4: карточка поездки = дни по возрастанию position со стопами внутри
    day_rows = (await db.execute(
        select(TripDay)
        .where(TripDay.trip_id == trip_id)
        .order_by(TripDay.position)
        .options(
            selectinload(TripDay.start_location),
            selectinload(TripDay.end_location),
        )
    )).scalars().all()
    owner = trip.user_id == current_user.id
    days = await days_to_response(db, list(day_rows), owner)
    trip.stops_count = sum(d["stops_count"] for d in days)
    _mark_draft(trip)
    trip.planned_total = (await compute_budget(db, trip)).planned_total
    data = TripResponse.model_validate(trip).model_dump()
    if not owner:
        # QA: «дом»/точка старта автора — личное (превью её не рисует, Q9)
        data.update(start_address=None, start_lat=None, start_lon=None)
    return TripDetailResponse(**data, days=days)

async def _has_days(db: AsyncSession, trip_id: UUID) -> bool:
    return (await db.execute(
        select(TripDay.id).where(TripDay.trip_id == trip_id).limit(1)
    )).scalar_one_or_none() is not None


@router.put("/{trip_id}", response_model=TripResponse)
@router.patch("/{trip_id}", response_model=TripResponse)
async def update_trip(
    trip_id: UUID,
    data: TripUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.user_id == current_user.id)
    )
    trip = result.scalar_one_or_none()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(trip, field, value)
    # город переехал — таймзона за ним (без координат старую не трогаем)
    if updates.keys() & {"city_lat", "city_lon"}:
        trip.timezone = timezone_at(trip.city_lat, trip.city_lon) or trip.timezone

    # QA: группа проверяется по ИТОГОВОМУ состоянию. Схема видит только
    # присланные поля, и PATCH одного children_count оставлял возраста от
    # старого состава («3 ребёнка, возраст: 7») — авто-оценка билетов врала.
    if trip.children_ages is not None and len(trip.children_ages) != trip.children_count:
        await db.rollback()
        raise HTTPException(status_code=422, detail="children_ages_mismatch")
    # QA: даты у поездки с днями стереть нельзя — дни (и стопы в них)
    # остались бы с датами, а поездка стала бы «черновиком без дат»
    if ("start_date" in updates or "end_date" in updates) and (
        (trip.start_date is None) != (trip.end_date is None)
        or (trip.start_date is None and await _has_days(db, trip.id))
    ):
        await db.rollback()
        raise HTTPException(status_code=422, detail="dates_required")

    # изменение диапазона дат -> пересинхронизация дней (S8 WP-3)
    if "start_date" in updates or "end_date" in updates:
        try:
            await sync_trip_days(db, trip)
        except DayError as e:
            await db.rollback()
            raise HTTPException(status_code=e.status_code, detail=str(e))

    # ТЗ-E: смена группы или валюты -> пересчёт авто-оценок стопов
    # (manual-стопы recompute не трогает)
    if updates.keys() & {"adults_count", "children_count", "currency"}:
        await recompute_auto_stops(db, trip)

    await db.commit()
    await db.refresh(trip)
    return trip

@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trip(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.user_id == current_user.id)
    )
    trip = result.scalar_one_or_none()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    await db.delete(trip)
    await db.commit()

@router.get("/{trip_id}/route", response_model=RouteRead)
async def get_day_route(
    trip_id: UUID,
    day_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """S16 §1.6: маршрут дня, разбитый по перегонам.

    Каждый перегон считается своим costing — из transport_to_next точки-
    источника, а если он пуст — из trips.transport_default. Перегонов
    len(точек)-1: [старт дня] + стопы + [финиш дня].
    """
    trip = await get_trip_readable(trip_id, current_user.id, db)
    day = (await db.execute(
        select(TripDay)
        .where(TripDay.id == day_id, TripDay.trip_id == trip_id)
        .options(
            selectinload(TripDay.start_location),
            selectinload(TripDay.end_location),
        )
    )).scalar_one_or_none()
    if day is None:
        raise HTTPException(status_code=404, detail="Day not found")

    stops = (await db.execute(
        select(TripStop)
        .where(TripStop.day_id == day_id, TripStop.included_in_route.is_(True))
        .options(selectinload(TripStop.place))
        .order_by(TripStop.position)
    )).scalars().all()

    # цепочка точек: у каждой — режим перемещения К СЛЕДУЮЩЕЙ точке
    points: list[dict] = []
    ids: list[UUID | None] = []
    # QA: зрителю превью — маршрут только по стопам: перегоны от отеля/дома
    # автора раскрывали бы его координаты через геометрию линии
    owner = trip.user_id == current_user.id
    if owner and day.start_location is not None:
        points.append({
            "lat": day.start_location.lat, "lon": day.start_location.lon,
            # свой режим старта дня; не задан — режимом первого стопа (или дефолтом)
            "mode": day.start_transport
                    or (stops[0].transport_to_next if stops else None) or trip.transport_default,
        })
        ids.append(None)
    for stop in stops:
        coords = _place_coords(stop.place)
        if coords is None:
            continue
        points.append({**coords, "mode": stop.transport_to_next or trip.transport_default})
        ids.append(stop.id)
    if owner and day.end_location is not None:
        points.append({"lat": day.end_location.lat, "lon": day.end_location.lon, "mode": None})
        ids.append(None)

    # ревью (нагрузка): чтение закончено — отдаём соединение в пул ДО Valhalla.
    # Иначе запрос держал его (idle in transaction) ~1,5 с ожидания маршрута,
    # и под нагрузкой пул выбирали маршруты: всё API замедлялось вдвое
    await db.commit()
    try:
        raw_legs = await route_legs(points)
    except RouteError:
        # вне покрытия тайлов — маршрут не строится, но день показать можно
        raise HTTPException(status_code=422, detail="day_out_of_coverage")

    legs = [
        RouteLeg(from_stop_id=ids[i], to_stop_id=ids[i + 1], **leg)
        for i, leg in enumerate(raw_legs)
    ]
    return RouteRead(
        day_id=day_id,
        legs=legs,
        total_duration_seconds=sum(l.duration_seconds for l in legs),
        total_distance_meters=sum(l.distance_meters for l in legs),
    )


@router.post("/{trip_id}/like", status_code=204)
async def like_trip(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Ревью: лайк ставился вообще без проверки поездки — IntegrityError на
    # несуществующем id молча превращался в 204, а чужой ПРИВАТНЫЙ маршрут
    # (который лайкер даже прочитать не может) копил likes_count.
    await get_trip_readable(trip_id, current_user.id, db)
    like = TripLike(user_id=current_user.id, trip_id=trip_id)
    db.add(like)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
       
@router.delete("/{trip_id}/like", status_code=204)
async def unlike_trip(
    trip_id:UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    unlike = sql_delete(TripLike).where(TripLike.user_id==current_user.id, TripLike.trip_id==trip_id)
    res = await db.execute(unlike)
    await db.commit()
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Like not found")
    
@router.post("/{trip_id}/clone", response_model=TripResponse)
async def clone_trip(trip_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user), ):
    # Ревью: trip_id был `str` + ручной UUID(...) в теле — на кривом пути
    # ValueError улетал в 500 вместо 422. Тип пути делает это FastAPI.
    source = (
        await db.execute(select(Trip).where(Trip.id == trip_id))
    ).scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    
    if not source.is_public and source.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot clone a private trip")
    
    new_trip = Trip(
        user_id=current_user.id, title=f"{source.title} (копия)", description=source.description,
        city=source.city, country=source.country, is_public=False, adults_count=source.adults_count,
        children_count=source.children_count, children_ages=source.children_ages, transport_default=source.transport_default,
        start_address=source.start_address, start_lat=source.start_lat, start_lon=source.start_lon, start_time=source.start_time,
        # S13: копия должна остаться цельной — даты/валюта/бюджет/центр карты
        start_date=source.start_date, end_date=source.end_date, currency=source.currency,
        budget_total=source.budget_total, city_lat=source.city_lat, city_lon=source.city_lon,
        timezone=source.timezone,
    )
    db.add(new_trip)
    await db.flush()

    # S13: регенерируем дни копии; S16: стоп принадлежит дню, поэтому
    # связываем дни оригинала и копии по позиции (даты у копии те же)
    try:
        await sync_trip_days(db, new_trip)
    except DayError:
        pass  # старая поездка без корректных дат — копия просто без дней
    await db.flush()
    new_days_by_position = {
        d.position: d.id
        for d in (await db.execute(
            select(TripDay).where(TripDay.trip_id == new_trip.id)
        )).scalars().all()
    }
    src_day_position = {
        d.id: d.position
        for d in (await db.execute(
            select(TripDay).where(TripDay.trip_id == source.id)
        )).scalars().all()
    }
    # имена дней — часть маршрута, переносим вместе с содержимым
    for d in (await db.execute(
        select(TripDay).where(TripDay.trip_id == source.id)
    )).scalars().all():
        if d.title and (new_id := new_days_by_position.get(d.position)):
            new_day = await db.get(TripDay, new_id)
            new_day.title = d.title

    stops = (
        await db.execute(select(TripStop).where(TripStop.trip_id == source.id).order_by(TripStop.position))
        ).scalars().all()

    # QA: позиции по-дневные и 1-based (как add_stop/reorder/optimize);
    # «не влезло в день» тоже часть маршрута — флаг копируется, иначе
    # выкинутые селективной оптимизацией стопы оживали в копии
    pos_in_day: dict = {}
    for s in stops:
        day_id = new_days_by_position.get(src_day_position.get(s.day_id))
        if day_id is None:
            continue  # у копии нет такого дня (диапазон дат оригинала кривой)
        pos = pos_in_day.get(day_id, 0) + 1
        pos_in_day[day_id] = pos
        db.add(TripStop(
            trip_id=new_trip.id, place_id=s.place_id, position=pos,
            day_id=day_id, priority=s.priority, included_in_route=s.included_in_route,
            visit_time=s.visit_time, duration_minutes=s.duration_minutes,
            duration_is_custom=s.duration_is_custom,
            transport_to_next=s.transport_to_next,
            notes=s.notes, is_booked=False, booking_ref=None,
            # ТЗ-E/ТЗ-Meili: группа копируется как есть — оценки, их источник
            # и диапазоны переносим целиком
            estimated_cost=s.estimated_cost, cost_source=s.cost_source,
            cost_min=s.cost_min, cost_max=s.cost_max, cost_is_estimate=s.cost_is_estimate,
        ))
    await db.commit()
    await db.refresh(new_trip)
    return new_trip
    