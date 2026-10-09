"""meili_upgrade: часы работы из OSM-строки -> формат по дням недели."""
from datetime import datetime

import pytest

from app.services.places.opening import is_open_at, parse_osm_hours


def test_weekdays_and_closed_weekend():
    h = parse_osm_hours("Mo-Fr 09:00-18:00")
    assert h["mo"] == [["09:00", "18:00"]] and h["fr"] == [["09:00", "18:00"]]
    assert h["sa"] == [] and h["su"] == []  # не упомянуты — по OSM закрыто


def test_later_rule_overrides_and_split_intervals():
    h = parse_osm_hours("Mo-Su 10:00-22:00; Mo off; Sa 10:00-14:00,15:00-23:00")
    assert h["mo"] == [] and h["tu"] == [["10:00", "22:00"]]
    assert h["sa"] == [["10:00", "14:00"], ["15:00", "23:00"]]


def test_overnight_and_wrapping_day_range():
    h = parse_osm_hours("Fr-Mo 18:00-26:00")
    assert h["fr"] == [["18:00", "02:00"]] and h["mo"] == [["18:00", "02:00"]]
    assert h["we"] == []
    # пятница 18:00-02:00 -> в субботу в 01:00 ещё открыто (2026-10-10 — суббота)
    assert is_open_at(h, datetime(2026, 10, 10, 1, 0)) is True


def test_all_week_shortcuts():
    assert parse_osm_hours("24/7")["we"] == [["00:00", "24:00"]]
    assert parse_osm_hours("10:00-20:00")["su"] == [["10:00", "20:00"]]
    assert parse_osm_hours("Mo-Fr 9:00-17:00; PH off")["mo"] == [["09:00", "17:00"]]


@pytest.mark.parametrize("raw", [
    None, "", "sunrise-sunset", "Mo-Fr 09:00-18:00, Sa 10:00-14:00",
    "Jan-Mar Mo 10:00-12:00", "Mo 10:00+", 'Mo-Fr 10:00-18:00 "по записи"',
    "PH 10:00-14:00", "Mo 25:99-26:00",
])
def test_unparseable_is_unknown_not_guess(raw):
    assert parse_osm_hours(raw) is None
