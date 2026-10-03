"""Read-tool: поиск мест (ТЗ-Meili M2.4).

Ищет по БД мест (сид Overpass + пользовательские). Каждый результат
аннотируется фактами, посчитанными системой: is_open_now (is_open_at + время
юзера) и ценовая метка (реальные цены ТЗ-E / price_level). Модель получает
факты готовыми и не выдумывает их.

Ревью — почему матчинг переписан. Раньше условие было буквально
`name ILIKE '%вся фраза целиком%'`, и на живых данных это почти никогда не
срабатывало: «Куршская коса» не находила «Музей Куршской косы» (склонение),
«Куршская коса Зеленоградск» не находила ничего вообще. Модель получала
пустой список и — вопреки промпту — дописывала в ответ выдуманные места с
выдуманными ценами. Теперь запрос бьётся на слова, каждое ищется по
триграммному сходству ИЛИ вхождению подстроки, а результаты ранжируются по
близости к названию. Пустой ответ теперь означает «действительно нет».
"""
import re
from datetime import datetime

from geoalchemy2 import Geography
from geoalchemy2.functions import ST_DWithin, ST_MakePoint, ST_SetSRID
from sqlalchemy import String, and_, case, cast, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from geoalchemy2.shape import to_shape

from app.models.place import Place
from app.services.meili.pricing import resolve_price
from app.services.places.geo import REGION_CITIES, haversine_m
from app.services.places.opening import is_open_at

MAX_RESULTS = 8
# запрос к БД берём с запасом: дубли и сам ориентир отсеиваются после
FETCH_LIMIT = MAX_RESULTS * 2
# слова короче — предлог или шум, по ним не ищем («в», «на», «и»)
MIN_WORD_LEN = 3
# порог word_similarity: подобран так, что «коса» находит «косы» и «косе»,
# но не тащит случайные совпадения по паре букв
TRIGRAM_THRESHOLD = 0.6
# больше слов в запросе смысла не добавляет, а план запроса портит
MAX_WORDS = 6


# радиус поиска вокруг ориентира по умолчанию — «пешком рядом»
NEAR_PLACE_RADIUS_M = 1500

# QA: слово-тип места — это категория, а не кусок названия. По подстроке
# «кафе» находился «КАФЕдральный собор», «бар» — «БАРбарис»: строгий проход
# цеплял их первыми, и до настоящих кафе каскад не доходил. Ключ — начало
# слова (ловит словоформы: «кафешка», «музеи», «ресторанчик»).
CATEGORY_WORDS: dict[str, str] = {
    "кафе": "cafe", "кофейн": "cafe", "кофе": "cafe", "пекарн": "cafe",
    "кондитерск": "cafe", "cafe": "cafe", "coffee": "cafe",
    "ресторан": "restaurant", "поесть": "restaurant", "пообедать": "restaurant",
    "поужинать": "restaurant", "restaurant": "restaurant",
    "музе": "museum", "museum": "museum", "галере": "museum",
    "парк": "park", "сквер": "park", "сад": "park", "park": "park",
    "театр": "theatre", "theatre": "theatre", "theater": "theatre",
    "достопримечательн": "landmark",
}


def _category_from_words(words: list[str]) -> tuple[str | None, str | None, list[str]]:
    """(категория, слово-тип, оставшиеся слова) — первое слово-тип = категория."""
    for i, word in enumerate(words):
        for stem, cat in CATEGORY_WORDS.items():
            # «сад» — только целиком: иначе «садовая улица» стала бы парком
            if word == stem or (len(stem) >= 4 and word.startswith(stem)):
                return cat, word, words[:i] + words[i + 1:]
    return None, None, words


def _region_city(name: str | None) -> str | None:
    """Город области по названию (без регистра) или None."""
    if not name:
        return None
    key = name.strip().lower()
    for city, _, _ in REGION_CITIES:
        if city.lower() == key:
            return city
    return None


async def _resolve_anchor(db: AsyncSession, name: str) -> dict | None:
    """QA: ориентир по названию → координаты. Факт считает система (§0):
    модель знает «Рыбная деревня», но не её координаты. Сначала город
    области, потом место из базы — все слова названия, ближайшее по имени."""
    for city, lat, lon in REGION_CITIES:
        if city.lower() == name.strip().lower():
            return {"lat": lat, "lon": lon, "name": city}
    words = _words(name)
    if not words:
        return None
    anchor = (await db.execute(
        select(Place)
        .where(and_(*(_word_matches(w) for w in words)), Place.location.is_not(None))
        .order_by(func.similarity(cast(Place.name, String), " ".join(words)).desc())
        .limit(1)
    )).scalar_one_or_none()
    if anchor is None:
        return None
    point = to_shape(anchor.location)
    return {"lat": point.y, "lon": point.x, "name": anchor.name}


def _words(query: str) -> list[str]:
    """Значимые слова запроса. Пунктуацию режем — «кафе, музей» это два слова."""
    cleaned = "".join(ch if ch.isalnum() else " " for ch in query.lower())
    seen: list[str] = []
    for word in cleaned.split():
        if len(word) >= MIN_WORD_LEN and word not in seen:
            seen.append(word)
    return seen[:MAX_WORDS]


def _word_matches(word: str):
    """Условие «место похоже на это слово».

    word_similarity ловит словоформы («коса» -> «косы»), ILIKE — точные
    вхождения и короткие слова, до которых триграммам не дотянуться.
    """
    pattern = f"%{word}%"
    return or_(
        func.word_similarity(word, Place.name) >= TRIGRAM_THRESHOLD,
        Place.name.ilike(pattern),
        Place.description.ilike(pattern),
        Place.address.ilike(pattern),
    )


async def search_places(
    db: AsyncSession,
    now: datetime,
    query: str,
    category: str | None = None,
    city: str | None = None,     # ревью: город из снапшота — иначе ищем по всей базе
    near: dict | None = None,        # {"lat": .., "lon": ..}
    radius: int | None = None,       # метры, с near
    day: str | None = None,          # ISO-дата: открытость смотрим в полдень этого дня
    near_place: str | None = None,   # QA: ориентир по названию — координаты ищет система
) -> list[dict]:
    words = _words(query or "")
    # категория из слова запроса — мягкая: место С категорией матчится по
    # ней, место БЕЗ категории (добавлено юзером) — по слову в названии
    soft_category, type_word = None, None
    if not category:
        soft_category, type_word, words = _category_from_words(words)
    else:
        # QA: query «парк» + category=park — слово-тип дублирует категорию и
        # строгим проходом отсекало «Königsgarten» и скверы без «парк» в имени
        same, _, rest = _category_from_words(words)
        if same == category:
            words = rest

    # QA: «кафе рядом с Рыбной деревней» — модель клала район в city, город
    # не находился, и поиск уходил «вне запрошенного города» с ответом «там
    # ничего нет». Не-город области в city — это ориентир, а не город.
    if city and not _region_city(city) and not near_place:
        near_place, city = city, None
    anchor = None
    if near_place and not (near and "lat" in near and "lon" in near):
        anchor = await _resolve_anchor(db, near_place)
        if anchor is not None:
            near = {"lat": anchor["lat"], "lon": anchor["lon"]}
            radius = radius or NEAR_PLACE_RADIUS_M
    if near and "lat" in near and "lon" in near:
        # QA: точка/ориентир точнее города — фильтр по городу при ней только
        # теряет места без адреса (из 6 парков у собора оставался один)
        city = None
    if radius is not None:
        # модель иногда шлёт радиус в километрах или 0 — держим в разумных рамках
        radius = max(100, min(int(radius), 50_000))

    def build(with_city: bool, word_mode: str):
        stmt = select(Place)
        if words and word_mode == "all":
            # строгий проход: «рыбный ресторан» это не любой ресторан
            stmt = stmt.where(and_(*(_word_matches(w) for w in words)))
        elif words and word_mode == "any":
            stmt = stmt.where(or_(*(_word_matches(w) for w in words)))
        if category:
            stmt = stmt.where(Place.category == category)
        elif soft_category:
            # без категории — слово-тип ЦЕЛЫМ словом (+ до 2 букв окончания:
            # «музея», «кафе»), иначе «кафе» снова тащит «Кафедральный собор».
            # type_word — только буквы/цифры (_words), в regex безопасен
            whole_word = rf"\m{type_word}[а-яёa-z]{{0,2}}\M"
            stmt = stmt.where(or_(
                Place.category == soft_category,
                and_(Place.category.is_(None), Place.name.op("~*")(whole_word)),
            ))
        if with_city and city:
            # город в каталоге пишут по-разному (Калининград/Kaliningrad),
            # поэтому нестрого; заодно ловим адрес — POI часто без city
            # QA: в адресе — только ЦЕЛЫМ словом: «%Калининград%» совпадал с
            # «Калининградская область» в адресе любого места области, и в
            # «музеях Калининграда» оказывались Кауп и Багратионовск
            city_word = rf"\m{re.escape(city.strip())}\M"
            stmt = stmt.where(or_(
                Place.city.ilike(f"%{city.strip()}%"), Place.address.op("~*")(city_word)
            ))
        if near and "lat" in near and "lon" in near:
            # geography-каст: радиус в метрах, не в градусах
            point = ST_SetSRID(ST_MakePoint(near["lon"], near["lat"]), 4326)
            stmt = stmt.where(ST_DWithin(
                cast(Place.location, Geography), cast(point, Geography), radius or 1000,
            ))
        if words and word_mode != "none":
            # QA: сначала — сколько слов запроса буквально есть в названии
            # («Кант» → «Иммануил Кант», а не похожее по буквам «Кано»),
            # потом триграммная близость: имя ценнее описания
            exact_hits = sum(
                (case((Place.name.ilike(f"%{w}%"), 1), else_=0) for w in words),
                literal(0),
            )
            stmt = stmt.order_by(
                exact_hits.desc(),
                func.similarity(cast(Place.name, String), " ".join(words)).desc(),
            )
        if near and "lat" in near and "lon" in near and not (words and word_mode != "none"):
            # без слов — ближайшие к точке первыми, а не в порядке вставки
            point = ST_SetSRID(ST_MakePoint(near["lon"], near["lat"]), 4326)
            stmt = stmt.order_by(func.ST_Distance(cast(Place.location, Geography), cast(point, Geography)))
        return stmt.limit(FETCH_LIMIT)

    # Каскад ослабления (ревью). Строгий поиск на живых данных обнулялся до
    # смешного легко: «мясной ресторан» требовал обоих слов в названии и давал
    # ноль, хотя ресторанов в городе восемь — а модель на пустом ответе честно
    # заключала «в базе ничего нет» и шла выдумывать. Поэтому: сузили — ничего
    # не нашли — отпускаем по одному ограничению за раз, помечая, что именно
    # ослабили. Пустой ответ теперь действительно значит «нет ничего».
    attempts: list[tuple[bool, str]] = [(True, "all")]
    if len(words) > 1:
        attempts.append((True, "any"))
    if category or soft_category or near:
        # запрос не лёг, но категория/точка сами по себе осмысленны
        attempts.append((True, "none"))
    if city:
        attempts += [(False, "all")] + ([(False, "any")] if len(words) > 1 else [])
        if category or soft_category or near:
            attempts.append((False, "none"))

    places, widened, relaxed = [], False, False
    for with_city, word_mode in attempts:
        places = (await db.execute(build(with_city, word_mode))).scalars().all()
        if places:
            widened = not with_city and bool(city)
            relaxed = bool(words) and word_mode != "all"
            break

    at = now
    if day:
        try:
            at = datetime.fromisoformat(day).replace(hour=12, minute=0)
        except ValueError:
            pass

    results = []
    seen_keys: set[tuple] = set()
    for p in places:
        # QA: в каталоге бывают дубли одного места (разные osm_id у node/way) —
        # модель показывала «Иммануил Кант» дважды подряд
        pt_key = None
        if p.location is not None:
            pt0 = to_shape(p.location)
            pt_key = (round(pt0.y, 3), round(pt0.x, 3))
        key = ((p.name or "").strip().lower(), pt_key)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        open_now = is_open_at(p.opening_hours, at)
        price = await resolve_price(p)  # ценовой гибрид (M5.1)
        distance = None
        if near and "lat" in near and "lon" in near and p.location is not None:
            pt = to_shape(p.location)
            distance = round(haversine_m(near["lat"], near["lon"], pt.y, pt.x))
        if anchor is not None and p.name == anchor["name"] and distance is not None and distance < 50:
            continue  # сам ориентир — не «место рядом с ним»
        results.append({
            "place_id": str(p.id),
            "name": p.name,
            "category": p.category,
            "address": p.address,
            # город места — не города поездки: см. widened ниже
            "city": p.city,
            # true = в запрошенном городе не нашлось, это находка из другого
            # города региона. Скажи об этом пользователю, не выдавай за местное
            **({"outside_requested_city": True} if widened else {}),
            # true = точный запрос не дал ничего, показываем по категории
            **({"loose_match": True} if relaxed else {}),
            "is_open_now": open_now,  # true/false/null («не знаем»)
            "price": price.label,
            "price_is_estimate": price.is_estimate,
            "duration_minutes": p.duration_minutes,
            # расстояние до точки/ориентира — считает система, не модель
            **({"distance_m": distance} if distance is not None else {}),
            **({"near": anchor["name"]} if anchor is not None else {}),
        })
    if anchor is not None:
        results.sort(key=lambda r: r.get("distance_m", 10**9))
    return results[:MAX_RESULTS]
