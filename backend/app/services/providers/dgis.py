"""2ГИС: поиск своего объекта для места из OSM и факты о нём (этап B).

Формат ответа — по справочнику catalog.api.2gis.com/3.0/items: items[] с
`point {lat, lon}`, `reviews {general_rating, general_review_count}`,
`schedule {Mon: {working_hours: [{from, to}]}, …, is_24x7}` и
`attribute_groups [{name, attributes: [{name, tag}]}]`.

ВАЖНО: на момент написания живого ключа не было — парсер написан по
документации и примерам, а не по живым ответам. Особенно гипотетичны
атрибуты цены («Средний счёт 1000–1500 ₽», «Номер от 3500 ₽»): разбираем
текст названий, а не теги. Первый живой прогон — `python -m scripts.dgis_probe`,
он печатает сырые атрибуты; правь парсер по нему.
"""
import re
from decimal import Decimal
from difflib import SequenceMatcher

import httpx

from app.core.config import settings
from app.services.places.geo import haversine_m
from app.services.providers import Enrichment

FIELDS = "items.point,items.reviews,items.schedule,items.attribute_groups"
# своё место ищем рядом с точкой OSM: дальше — уже другое заведение
MATCH_RADIUS_M = 150
MIN_NAME_SIMILARITY = 0.6
REQUEST_TIMEOUT_S = 5.0

DAYS = {"Mon": "mo", "Tue": "tu", "Wed": "we", "Thu": "th", "Fri": "fr", "Sat": "sa", "Sun": "su"}

# валюта по тексту атрибута. Порядок важен: «бел. руб» раньше «руб»
CURRENCY_MARKERS: list[tuple[str, str]] = [
    ("byn", "BYN"), ("бел. руб", "BYN"), ("бел.руб", "BYN"),
    ("₽", "RUB"), ("руб", "RUB"), ("₸", "KZT"), ("тенге", "KZT"),
    ("сум", "UZS"), ("сом", "KGS"), ("֏", "AMD"), ("драм", "AMD"),
    ("₾", "GEL"), ("лари", "GEL"), ("₼", "AZN"), ("манат", "AZN"),
    ("aed", "AED"), ("дирхам", "AED"),
]
CHECK_WORDS = ("чек", "счёт", "счет")
LODGING_WORDS = ("номер", "ночь", "проживан", "сутки")
_NUMBER = re.compile(r"\d[\d\s  ]*")


class DgisUnavailable(Exception):
    """2ГИС не ответил (сеть, 5xx, 429) — «не знаем», а не «не нашли»."""


def _numbers(text: str) -> list[Decimal]:
    return [Decimal(re.sub(r"\D", "", m)) for m in _NUMBER.findall(text) if re.sub(r"\D", "", m)]


def _currency(text: str) -> str | None:
    low = text.lower()
    for marker, code in CURRENCY_MARKERS:
        if marker in low:
            return code
    return None


def parse_price_attributes(texts: list[str]) -> tuple[Decimal | None, Decimal | None, str | None]:
    """(средний счёт, номер от, валюта) из названий атрибутов.

    «Средний счёт 1000–1500 ₽» -> 1250 (середина — это и есть «средний»);
    «Номер от 3 500 ₽» -> 3500 (нижняя граница, только для показа).
    Без распознанной валюты суммы не возвращаем: «1500 чего?» — не факт.
    """
    avg_check = lodging = currency = None
    for text in texts:
        low = text.lower()
        nums = _numbers(text)
        code = _currency(text)
        if not nums or code is None:
            continue
        if avg_check is None and any(w in low for w in CHECK_WORDS):
            avg_check = (nums[0] + nums[1]) / 2 if len(nums) >= 2 else nums[0]
            currency = currency or code
        elif lodging is None and any(w in low for w in LODGING_WORDS):
            lodging = min(nums)
            currency = currency or code
    return (
        avg_check.quantize(Decimal("0.01")) if avg_check is not None else None,
        lodging.quantize(Decimal("0.01")) if lodging is not None else None,
        currency,
    )


def parse_schedule(schedule: dict | None) -> dict | None:
    """schedule 2ГИС -> наш формат 2 (opening.py). Нет дня — закрыто."""
    if not isinstance(schedule, dict) or not schedule:
        return None
    if schedule.get("is_24x7"):
        return {d: [["00:00", "24:00"]] for d in DAYS.values()}
    week: dict[str, list] = {}
    for key, day in DAYS.items():
        hours = (schedule.get(key) or {}).get("working_hours") or []
        intervals = [
            [h["from"], h["to"]] for h in hours
            if isinstance(h, dict) and h.get("from") and h.get("to")
        ]
        week[day] = intervals
    return week if any(week.values()) else None


def attribute_texts(item: dict) -> list[str]:
    texts = []
    for group in item.get("attribute_groups") or []:
        group_name = group.get("name") or ""
        for attr in group.get("attributes") or []:
            name = attr.get("name") or ""
            # бывает «Средний счёт» группой и «1000–1500 ₽» атрибутом
            texts.append(f"{group_name} {name}".strip())
    return texts


def parse_item(item: dict) -> Enrichment:
    reviews = item.get("reviews") or {}
    rating = reviews.get("general_rating")
    count = reviews.get("general_review_count")
    texts = attribute_texts(item)
    avg_check, lodging, currency = parse_price_attributes(texts)
    return Enrichment(
        provider="2gis",
        provider_id=str(item["id"]),
        # рейтинг без отзывов — шум, такой не берём
        rating=Decimal(str(rating)).quantize(Decimal("0.01")) if rating and count else None,
        rating_count=int(count) if count else None,
        opening_hours=parse_schedule(item.get("schedule")),
        avg_check=avg_check,
        lodging_price_from=lodging,
        currency=currency,
        raw_attributes=texts,
    )


def _norm(name: str) -> str:
    cleaned = re.sub(r"[«»\"'“”„]", "", name.lower()).replace("ё", "е")
    return " ".join(cleaned.split())


def name_similarity(a: str, b: str) -> float:
    a, b = _norm(a), _norm(b)
    if not a or not b:
        return 0.0
    if a in b or b in a:  # «Пушкин» и «Кафе Пушкин»
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def best_match(name: str, lat: float, lon: float, items: list[dict]) -> dict | None:
    """Свой объект: похож по имени и рядом. Без точки — не матчим (не проверить)."""
    best, best_score = None, 0.0
    for item in items:
        point = item.get("point") or {}
        if "lat" not in point or "lon" not in point:
            continue
        if haversine_m(lat, lon, point["lat"], point["lon"]) > MATCH_RADIUS_M:
            continue
        score = name_similarity(name, item.get("name") or "")
        if score >= MIN_NAME_SIMILARITY and score > best_score:
            best, best_score = item, score
    return best


async def search_near(client: httpx.AsyncClient, name: str, lat: float, lon: float) -> list[dict]:
    """Объекты 2ГИС с таким именем рядом с точкой. Бросает DgisUnavailable."""
    try:
        r = await client.get(f"{settings.DGIS_BASE_URL}/items", params={
            "q": name[:200], "point": f"{lon},{lat}", "radius": MATCH_RADIUS_M,
            "type": "branch", "fields": FIELDS, "page_size": 5,
            "locale": "ru_RU", "key": settings.DGIS_API_KEY,
        })
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise DgisUnavailable(str(e)) from e
    code = (data.get("meta") or {}).get("code")
    if code == 404:
        return []  # так 2ГИС отвечает «ничего не нашлось»
    if code != 200:
        raise DgisUnavailable(f"meta.code={code}")
    return (data.get("result") or {}).get("items") or []


async def find(client: httpx.AsyncClient, name: str, lat: float, lon: float) -> Enrichment | None:
    """Факты 2ГИС о месте или None («в 2ГИС такого нет»)."""
    match = best_match(name, lat, lon, await search_near(client, name, lat, lon))
    return parse_item(match) if match else None
