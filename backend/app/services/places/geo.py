"""Геометрия без привязки к региону.

Раньше здесь жил «регион MVP» (bbox Калининградской области + справочник её
городов), и приложение физически не пускало точки за его пределы. Теперь
граница — это покрытие маршрутизатора из конфига (ROUTING_COVERAGE): N
прямоугольников под тайлы Valhalla или пусто, если маршруты есть везде.
Справочник области переехал к сид-скриптам (scripts/kaliningrad.py).
"""
from math import asin, cos, radians, sin, sqrt

from tzfpy import get_tz

from app.core.config import settings

# у поездки без координат города — нейтральный UTC, а не чужой город
DEFAULT_TIMEZONE = "UTC"


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(a))


def in_coverage(lat: float, lon: float) -> bool:
    """Строит ли маршрутизатор маршруты в этой точке. Пустое покрытие — везде.

    QA (было in_region): точка вне тайлов ломает весь день — маршрут не
    строится, оптимизация падает «вне покрытия». Поэтому стоп туда не
    добавляем сразу, а не на полпути.
    """
    boxes = settings.ROUTING_COVERAGE
    if not boxes:
        return True
    return any(s <= lat <= n and w <= lon <= e for s, w, n, e in boxes)


def timezone_at(lat: float | None, lon: float | None) -> str | None:
    """IANA-таймзона точки (офлайн, tzfpy). Раньше все поездки жили в
    Europe/Kaliningrad: у поездки в Токио .ics съезжал на 7 часов."""
    if lat is None or lon is None:
        return None
    return get_tz(lon, lat) or None
