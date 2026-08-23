from math import sqrt
import uuid
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.user import User
from app.models.social import UserVisitedPlace, TripLike
from app.models.place import Place
from app.models.trip import Trip


STYLE_WEIGHT = 0.4
PLACE_WEIGHT = 0.6
IMPLICIT_RATING = 3.0
CONFIDENCE_K = 2

def jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 0.0
    return len(a & b) / len(a | b)

def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    # косинус между разреженными вектораи оценок
    common = a.keys() & b.keys()
    if not common:
        return 0.0
    dot = sum(a[p] * b[p] for p in common)
    norm_a = sqrt(sum(v * v for v in a.values()))
    norm_b = sqrt(sum(v * v for v in b.values()))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)

async def find_similar_users(db: AsyncSession, user_id: str, k: int = 10, ) -> list[tuple[str, float]]:
    # вернет топ k пользователей похожих на юзера
    rows = (await db.execute(select(User.id, User.travel_style))).all()
    styles: dict[str, set] ={
        str(uid): set(ts or []) for uid, ts in rows # travel style всех пользователей 
    }

    # посещения всех пользователей
    visit_rows = (
        await db.execute(select(
            UserVisitedPlace.user_id, UserVisitedPlace.place_id, UserVisitedPlace.rating,
        ))
    ).all()

    visits: dict[str, dict[str, float]] = {}
    for uid, place_id, rating in visit_rows:
        uid, place_id = str(uid), str(place_id)
        value = float(rating) if rating is not None else IMPLICIT_RATING
        visits.setdefault(uid, {})[place_id] = value
    
    # данные текущего пользователя
    me_style = styles.get(user_id, set())
    me_visits = visits.get(user_id, {})

    # считаем score для остальных
    scored: list[tuple[str, float]] = []
    for other_id in styles:
        if other_id == user_id:
            continue
        style_sim = jaccard(me_style, styles[other_id])
        place_sim = cosine(me_visits, visits.get(other_id, {}))
        score = STYLE_WEIGHT * style_sim + PLACE_WEIGHT * place_sim
        if score > 0:
            scored.append((other_id, score))
    
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:k]

async def _my_visited_ids(db: AsyncSession, user_id: str) -> set[str]:
    # выкинет места где юзер уже был
    rows = (await db.execute(select(UserVisitedPlace.place_id).where(UserVisitedPlace.user_id == uuid.UUID(user_id)))
            ).scalars().all()
    return {str(pid) for pid in rows}

async def _popular_places(
        db: AsyncSession, city: str | None, exclude: set[str], limit: int
        ) -> list[Place]:
    # самые посещаемые места с лучшим рейтингом в городе
    stmt = (
        select(Place).join(UserVisitedPlace, UserVisitedPlace.place_id == Place.id)
        .group_by(Place.id).order_by(
            func.count(UserVisitedPlace.user_id).desc(), func.avg(UserVisitedPlace.rating).desc().nulls_last(), 
        )
    )
    if city:
        stmt = stmt.where(Place.city == city)
    
    places = (await db.execute(stmt)).scalars().all()
    out: list[Place] = []
    for place in places:
        if str(place.id) in exclude:
            continue
        out.append(place)
        if len(out) >= limit:
            break
    return out

async def recommended_places(
        db: AsyncSession, user_id: str, city: str | None = None, children: int = 0, limit: int = 10
                             ) -> list[Place]:
    similar = await find_similar_users(db, user_id)
    sim_map = {uid: score for uid, score in similar}
    my_visited = await _my_visited_ids(db, user_id)

    if not sim_map:
        return await _popular_places(db, city, exclude=my_visited, limit=limit)
    
    similar_ids = [uuid.UUID(uid) for uid in sim_map]
    stmt = (
        select(UserVisitedPlace.user_id, UserVisitedPlace.rating, Place,)
        .join(Place, Place.id == UserVisitedPlace.place_id)
        .where(UserVisitedPlace.user_id.in_(similar_ids))
    )
    if city:
        stmt = stmt.where(Place.city == city)
    rows = (await db.execute(stmt)).all()

    num: dict[str, float] = {}
    den: dict[str, float] = {}
    cnt: dict[str, int] = {}
    place_objs: dict[str, Place] = {}
    for row in rows:
        place = row.Place
        pid = str(place.id)

        if pid in my_visited:
            continue
        if children > 0 and place.suitable_for_children is False:
            continue

        rating = float(row.rating) if row.rating is not None else IMPLICIT_RATING
        sim = sim_map[str(row.user_id)]

        num[pid] = num.get(pid, 0.0) + sim * rating
        den[pid] = den.get(pid, 0.0) + sim
        cnt[pid] = cnt.get(pid, 0) + 1
        place_objs[pid] = place
    scores: dict[str, float] = {}
    for pid in num:
        predicted = num[pid] / den[pid]
        confidence = cnt[pid] / (cnt[pid] + CONFIDENCE_K)
        scores[pid] = predicted * confidence

    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    result = [place_objs[pid] for pid, _ in ranked[:limit]]

    if len(result) < limit:
        have = {str(p.id) for p in result}
        fallback = await _popular_places(db, city, exclude=my_visited | have, limit=limit - len(result))
        result.extend(fallback)
    
    return result

async def _popular_trips(
        db: AsyncSession, city: str | None, exclude: set[str], limit: int
) -> list[Trip]:
    # S17: outerjoin, а не join — на молодом сервисе лайков ещё нет, и с INNER
    # JOIN блок рекомендаций оставался пустым навсегда. Сначала залайканные,
    # потом остальные публичные.
    stmt = (
        select(Trip).outerjoin(TripLike, TripLike.trip_id == Trip.id)
        .where(Trip.is_public.is_(True)).group_by(Trip.id)
        .order_by(func.count(TripLike.user_id).desc(), Trip.created_at.desc())
    )
    if city:
        stmt = stmt.where(Trip.city == city)
    
    trips = (await db.execute(stmt)).scalars().all()
    out: list[Trip] = []
    for trip in trips:
        if str(trip.id) in exclude:
            continue
        out.append(trip)
        if len(out) >= limit:
            break
    return out

async def recommend_trips(
        db: AsyncSession, user_id: str, city: str | None = None, limit: int = 10
) -> list[Trip]:
    user_uuid = uuid.UUID(user_id)
    my_trips = (await db.execute(select(Trip.id).where(Trip.user_id == user_uuid))).scalars().all()
    my_liked = (await db.execute(select(TripLike.trip_id).where(TripLike.user_id == user_uuid))).scalars().all()

    exclude = {str(t) for t in my_trips} | {str(t) for t in my_liked}

    similar = await find_similar_users(db, user_id)
    sim_map = {uid: score for uid, score in similar}

    if not sim_map:
        return await _popular_trips(db, city, exclude, limit)
    
    similar_ids = [uuid.UUID(uid) for uid in sim_map]
    stmt = (
        select(TripLike.user_id, Trip).join(Trip, Trip.id == TripLike.trip_id)
        .where(TripLike.user_id.in_(similar_ids)).where(Trip.is_public.is_(True))
        .where(Trip.user_id != user_uuid)
    )
    if city:
        stmt = stmt.where(Trip.city == city)
    rows = (await db.execute(stmt)).all()
    scores: dict[str, float] = {}
    trip_objs: dict[str, Trip] = {}
    for liker_id, trip in rows:
        tid = str(trip.id)
        if tid in exclude:
            continue
        scores[tid] = scores.get(tid, 0.0) + sim_map[str(liker_id)]
        trip_objs[tid] = trip
    
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    result = [trip_objs[tid] for tid, _ in ranked[:limit]]

    if len(result) < limit:
        have = {str(t.id) for t in result}
        result += await _popular_trips(db, city, exclude | have, limit - len(result))
    
    return result