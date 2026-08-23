"""Доменные enum'ы (S16).

Хранятся строками (конвенция проекта: String + Literal/Enum в схемах,
не PG ENUM) — значение enum'а равно значению в БД.
"""
from enum import Enum


class TransportMode(str, Enum):
    """Способ перемещения между точками. Ровно три значения (ТЗ S16 §1.6).

    В БД лежит именно это значение; costing Valhalla получается через
    VALHALLA_COSTING (services/valhalla.py) и больше нигде не дублируется.
    """

    WALKING = "walking"
    DRIVING = "driving"
    TRANSIT = "transit"


DEFAULT_TRANSPORT = TransportMode.WALKING
