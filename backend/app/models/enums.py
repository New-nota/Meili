"""Доменные enum'ы (S16).

Хранятся строками (конвенция проекта: String + Literal/Enum в схемах,
не PG ENUM) — значение enum'а равно значению в БД.
"""
from enum import Enum


class TransportMode(str, Enum):
    """Способ перемещения между точками (ТЗ S16 §1.6).

    Был и TRANSIT (costing multimodal): без GTFS-тайлов Valhalla на любой такой
    перегон отвечала 400 «unconnected regions» — режим выбирался и ломал
    маршрут. Убран до появления расписаний (миграция d4f9a2b3c5e7 перевела
    сохранённые transit в walking).

    В БД лежит именно это значение; costing Valhalla получается через
    VALHALLA_COSTING (services/valhalla.py) и больше нигде не дублируется.
    """

    WALKING = "walking"
    DRIVING = "driving"


DEFAULT_TRANSPORT = TransportMode.WALKING
