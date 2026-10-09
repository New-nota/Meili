"""Резолв и проверка ссылок плана на реальные сущности (ревью).

ProposedPlan (schemas/plan.py) держит ФОРМУ плана: закрытый enum действий,
типы, обязательные поля. Но «place_id — валидный UUID» и «такое место есть»
это разные утверждения, и второе схема проверить не может.

Что здесь происходит и почему.

Результат search_places живёт только внутри своего хода: в окно истории
подмешивается лишь текст реплик, а tool_calls — это JSONB-аудит. Поэтому на
следующем ходе (типичное «готов» -> propose_plan) у модели не оставалось ни
одного настоящего place_id, и она принималась их сочинять: наблюдались и
правдоподобные UUID, и вовсе невозможные «a1b2c3d4-e5f6-7890-g1h2-…» с
буквами g/h/i, которых в hex нет. Планы отклонялись, модель извинялась,
пробовала снова — и ход уходил в цикл на весь бюджет шагов.

Лечим с двух сторон:
1. диалог помнит найденные места (conversations.recent_places_json) и
   показывает их в снапшоте — id снова на виду;
2. ссылаться можно ПО ИМЕНИ: place_name -> place_id превращает система,
   здесь, при заморозке плана. Дальше по системе едет уже нормальный id,
   поэтому executor ничего про имена не знает.

Правило §0 не нарушено: сопоставление делает система по своей базе, модель
по-прежнему только компонует. Имени нет в базе — плана не будет.
"""
from uuid import UUID

from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.place import Place
from app.models.trip import TripDay, TripStop
from app.schemas.plan import (
    AddStopAction,
    ProposedPlan,
    RemoveStopAction,
    SetLodgingAction,
    SetStopCostAction,
)

# ниже этого сходства имя считается другим местом, а не опечаткой
NAME_MATCH_THRESHOLD = 0.45
# сколько вариантов показать модели, когда сослаться не на что
SUGGEST_LIMIT = 12


async def _place_by_name(db: AsyncSession, name: str) -> Place | None:
    """Место по названию: точное вхождение, иначе ближайшее по триграммам."""
    cleaned = name.strip()
    if not cleaned:
        return None

    exact = (await db.execute(
        select(Place).where(Place.name.ilike(cleaned)).limit(1)
    )).scalar_one_or_none()
    if exact is not None:
        return exact

    similarity = func.similarity(cast(Place.name, String), cleaned)
    return (await db.execute(
        select(Place)
        .where(or_(Place.name.ilike(f"%{cleaned}%"), similarity >= NAME_MATCH_THRESHOLD))
        .order_by(similarity.desc())
        .limit(1)
    )).scalar_one_or_none()


def _suggestions(recent: list | None) -> str:
    """Подсказка «вот на что сослаться можно» — иначе модель гадает по кругу."""
    if not recent:
        return " Сначала вызови search_places и бери place_id из его ответа."
    listed = "; ".join(
        f"{p.get('name')} = {p.get('id')}" for p in recent[:SUGGEST_LIMIT]
    )
    return f" Доступные места этого диалога: {listed}."


async def resolve_references(
    db: AsyncSession,
    plan: ProposedPlan,
    trip_id: UUID | None,
    recent_places: list | None = None,
) -> list[str]:
    """Дорезолвить ссылки плана НА МЕСТЕ и вернуть список претензий.

    Пусто — план можно замораживать: у каждого add_stop стоит настоящий
    place_id. trip_id берётся из conversation (правило 1.9), не из плана.
    """
    problems: list[str] = []

    for action in plan.actions:
        # meili_upgrade: set_lodging ссылается на место так же, как add_stop
        if not isinstance(action, (AddStopAction, SetLodgingAction)):
            continue

        if action.place_id is not None:
            exists = (await db.execute(
                select(Place.id).where(Place.id == action.place_id)
            )).scalar_one_or_none()
            if exists is not None:
                continue
            # id выдуман — пробуем спасти действие по названию, если оно есть
            if not (action.place_name or "").strip():
                problems.append(
                    f"place_id {action.place_id} не существует."
                    + _suggestions(recent_places)
                )
                continue

        match = await _place_by_name(db, action.place_name or "")
        if match is None:
            problems.append(
                f"места «{action.place_name}» нет в базе."
                + _suggestions(recent_places)
            )
            continue
        # дальше по системе едет только настоящий id
        action.place_id = match.id
        action.place_name = match.name

    # QA: стоп по названию места (+ день) -> настоящий stop_id этой поездки
    for action in plan.actions:
        if not isinstance(action, (RemoveStopAction, SetStopCostAction)):
            continue
        if action.stop_id is not None or trip_id is None:
            continue
        name = (action.stop_name or "").strip()
        similarity = func.similarity(cast(Place.name, String), name)
        stmt = (
            select(TripStop.id, Place.name, TripDay.position)
            .join(Place, Place.id == TripStop.place_id)
            .join(TripDay, TripDay.id == TripStop.day_id)
            .where(
                TripStop.trip_id == trip_id,
                or_(Place.name.ilike(f"%{name}%"), similarity >= NAME_MATCH_THRESHOLD),
            )
            .order_by(similarity.desc())
        )
        if action.day_index is not None:
            stmt = stmt.where(TripDay.position == action.day_index + 1)
        matches = (await db.execute(stmt)).all()
        if not matches:
            problems.append(f"в поездке нет остановки «{name}» — смотри названия в снапшоте")
            continue
        exact = [m for m in matches if m.name.strip().lower() == name.lower()]
        pool = exact or matches
        if len({m.id for m in pool}) > 1 and action.day_index is None:
            days = ", ".join(sorted({f"день {m.position}" for m in pool}))
            problems.append(f"«{name}» есть в нескольких днях ({days}) — укажи day_index")
            continue
        action.stop_id = pool[0].id
        action.stop_name = pool[0].name

    stop_ids = {
        a.stop_id
        for a in plan.actions
        if isinstance(a, (RemoveStopAction, SetStopCostAction)) and a.stop_id is not None
    }
    if stop_ids and trip_id is not None:
        known = set((await db.execute(
            select(TripStop.id).where(
                TripStop.id.in_(stop_ids), TripStop.trip_id == trip_id
            )
        )).scalars().all())
        for missing in sorted(stop_ids - known, key=str):
            problems.append(f"stop_id {missing} не найден в этой поездке")
    elif stop_ids:
        problems.append("поездки ещё нет — ссылаться на stop_id пока не на что")

    return problems
