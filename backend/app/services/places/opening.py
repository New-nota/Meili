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
