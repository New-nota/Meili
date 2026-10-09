"""Часы работы места: детерминированная проверка (ТЗ-Meili M2.3).

НЕ tool — обычная функция; факты считает система, модель получает готовое.

Поддерживаемые формы places.opening_hours (JSONB):
1. {"open": "09:00", "close": "18:00"} — одно окно, одинаковое каждый день
   (исторический формат проекта, его же читает optimizer).
2. {"mo": [["09:00","18:00"]], "sa": [["10:00","02:00"]], "su": []} —
   интервалы по дням недели (mo|tu|we|th|fr|sa|su). Пустой список = закрыто
   в этот день; отсутствие ключа дня = нет данных (None).
Интервал с close <= open — через полночь (перетекает в следующий день).
Кривой/неизвестный формат или отсутствие данных -> None («не знаем»).
"""
from datetime import datetime

WEEKDAYS = ("mo", "tu", "we", "th", "fr", "sa", "su")


def _to_minutes(value: str) -> int | None:
    try:
        hours, minutes = value.split(":")
        h, m = int(hours), int(minutes)
    except (ValueError, AttributeError):
        return None
    if h == 24 and m == 0:  # "24:00" — конец суток
        return 24 * 60
    if not (0 <= h < 24 and 0 <= m < 60):
        return None
    return h * 60 + m


def _intervals_for(opening_hours: dict, day_key: str) -> list[tuple[int, int]] | None:
    """Интервалы (минуты от полуночи) для дня недели. None = нет данных."""
    if "open" in opening_hours or "close" in opening_hours:
        start = _to_minutes(opening_hours.get("open", ""))
        end = _to_minutes(opening_hours.get("close", ""))
        if start is None or end is None:
            return None
        return [(start, end)]

    if day_key not in opening_hours:
        return None
    raw = opening_hours[day_key]
    if not isinstance(raw, list):
        return None
    intervals = []
    for pair in raw:
        try:
            start, end = _to_minutes(pair[0]), _to_minutes(pair[1])
        except (TypeError, IndexError, KeyError):
            return None
        if start is None or end is None:
            return None
        intervals.append((start, end))
    return intervals  # [] = явно закрыто весь день


def is_open_at(opening_hours: dict | None, at: datetime) -> bool | None:
    """Открыто ли место в момент `at` (наивный datetime в локальном времени места).

    True/False — знаем ответ; None — данных нет или формат не разобрать.
    """
    if not isinstance(opening_hours, dict) or not opening_hours:
        return None

    minute = at.hour * 60 + at.minute
    today = WEEKDAYS[at.weekday()]
    yesterday = WEEKDAYS[(at.weekday() - 1) % 7]

    today_intervals = _intervals_for(opening_hours, today)
    yesterday_intervals = _intervals_for(opening_hours, yesterday)
    if today_intervals is None and yesterday_intervals is None:
        return None

    # хвост вчерашнего интервала через полночь: ("22:00","02:00") вчера
    # держит место открытым сегодня до 02:00
    for start, end in yesterday_intervals or []:
        if end <= start and minute < end:
            return True

    for start, end in today_intervals or []:
        if end <= start:  # через полночь: открыто с start до конца суток
            if minute >= start:
                return True
        elif start <= minute < end:
            return True

    # интервалы сегодняшнего дня известны, ни один не подошёл -> закрыто
    return False if today_intervals is not None else None


# --- meili_upgrade: часы из OSM-строки ---------------------------------------
# Сид из pbf и Overpass раньше выкидывали тег opening_hours, и is_open_now у
# всех OSM-мест был «не знаем». Разбираем только простое подмножество
# синтаксиса OSM; всё хитрое (праздники с часами, sunrise, месяцы, недели,
# «+», комментарии) -> None: лучше «не знаем», чем угаданное «открыто».

_OSM_DAYS = {"mo": 0, "tu": 1, "we": 2, "th": 3, "fr": 4, "sa": 5, "su": 6}
_OSM_OFF = {"off", "closed"}


def _osm_days(spec: str) -> list[int] | None:
    """«Mo-Fr,Su» -> [0..4, 6]; диапазон через воскресенье («Fr-Mo») тоже."""
    days: list[int] = []
    for part in spec.split(","):
        bounds = part.strip().lower().split("-")
        if len(bounds) == 1 and bounds[0] in _OSM_DAYS:
            days.append(_OSM_DAYS[bounds[0]])
        elif len(bounds) == 2 and bounds[0] in _OSM_DAYS and bounds[1] in _OSM_DAYS:
            a, b = _OSM_DAYS[bounds[0]], _OSM_DAYS[bounds[1]]
            days.extend((a + i) % 7 for i in range((b - a) % 7 + 1))
        else:
            return None
    return days


def _osm_time(value: str) -> str | None:
    """«9:00» -> «09:00»; «26:00» (после полуночи) -> «02:00»."""
    try:
        h, m = (int(x) for x in value.split(":"))
    except ValueError:
        return None
    if not (0 <= m < 60 and 0 <= h <= 48):
        return None
    if h == 24 and m == 0:
        return "24:00"
    return f"{h % 24:02d}:{m:02d}"


def _osm_intervals(spec: str) -> list[list[str]] | None:
    if spec.strip().lower() in _OSM_OFF:
        return []
    intervals = []
    for part in spec.split(","):
        bounds = part.strip().split("-")
        if len(bounds) != 2:
            return None
        start, end = _osm_time(bounds[0]), _osm_time(bounds[1])
        if start is None or end is None:
            return None
        intervals.append([start, end])
    return intervals


def parse_osm_hours(raw: str | None) -> dict | None:
    """OSM opening_hours -> формат 2 (по дням недели) или None.

    Правила через «;», более позднее правило перекрывает дни более раннего
    (семантика OSM). Дни, не упомянутые ни одним правилом, по OSM закрыты.
    «PH off» / «SH off» пропускаем: про будни это ничего не меняет.
    """
    if not raw or not isinstance(raw, str):
        return None
    text = raw.strip()
    if text == "24/7":
        return {d: [["00:00", "24:00"]] for d in WEEKDAYS}
    week: dict[str, list] = {}
    for rule in filter(None, (r.strip() for r in text.split(";"))):
        head, _, rest = rule.partition(" ")
        if head.upper() in ("PH", "SH") and rest.strip().lower() in _OSM_OFF:
            continue
        days = _osm_days(head) if head[:2].lower() in _OSM_DAYS else None
        if days is None:
            # правило без дней — на всю неделю («10:00-22:00»)
            if head[:1].isdigit() or head.lower() in _OSM_OFF:
                days, rest = list(range(7)), rule
            else:
                return None
        intervals = _osm_intervals(rest)
        if intervals is None:
            return None
        for day in days:
            week[WEEKDAYS[day]] = intervals
    if not week:
        return None
    return {d: week.get(d, []) for d in WEEKDAYS}
