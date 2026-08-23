"""ТЗ-Meili M2.3: is_open_at — будни/выходные, через полночь, закрыто, нет данных."""
from datetime import datetime

from app.services.places.opening import is_open_at

# якорные даты: 2026-07-13 — понедельник, 2026-07-18 — суббота, 2026-07-19 — воскресенье
MON_NOON = datetime(2026, 7, 13, 12, 0)
MON_NIGHT = datetime(2026, 7, 13, 23, 30)
TUE_EARLY = datetime(2026, 7, 14, 1, 30)
SAT_NOON = datetime(2026, 7, 18, 12, 0)
SUN_NOON = datetime(2026, 7, 19, 12, 0)

DAILY = {"open": "09:00", "close": "18:00"}
WEEKLY = {
    "mo": [["09:00", "18:00"]],
    "tu": [["09:00", "13:00"], ["14:00", "18:00"]],
    "sa": [["10:00", "16:00"]],
    "su": [],  # выходной
}


def test_no_data_is_none():
    assert is_open_at(None, MON_NOON) is None
    assert is_open_at({}, MON_NOON) is None


def test_garbage_format_is_none():
    assert is_open_at({"open": "чепуха", "close": "18:00"}, MON_NOON) is None
    assert is_open_at({"mo": "не список"}, MON_NOON) is None
    assert is_open_at({"mo": [["09:00"]]}, MON_NOON) is None  # пара без close


def test_daily_window_open_and_closed():
    assert is_open_at(DAILY, MON_NOON) is True
    assert is_open_at(DAILY, MON_NIGHT) is False


def test_daily_window_boundaries():
    # [open, close): открытие включительно, закрытие — уже закрыто
    assert is_open_at(DAILY, datetime(2026, 7, 13, 9, 0)) is True
    assert is_open_at(DAILY, datetime(2026, 7, 13, 18, 0)) is False


def test_weekday_open():
    assert is_open_at(WEEKLY, MON_NOON) is True


def test_weekend_closed_vs_saturday_open():
    assert is_open_at(WEEKLY, SAT_NOON) is True
    assert is_open_at(WEEKLY, SUN_NOON) is False  # явный [] = закрыто, не None


def test_lunch_break_between_intervals():
    assert is_open_at(WEEKLY, datetime(2026, 7, 14, 13, 30)) is False  # обед
    assert is_open_at(WEEKLY, datetime(2026, 7, 14, 14, 30)) is True


def test_day_absent_is_none():
    assert is_open_at(WEEKLY, datetime(2026, 7, 15, 12, 0)) is None  # среды нет в данных


def test_overnight_same_day_side():
    bar = {"fr": [["22:00", "03:00"]]}
    assert is_open_at(bar, datetime(2026, 7, 17, 23, 0)) is True  # пятница ночь


def test_overnight_spills_to_next_day():
    bar = {"fr": [["22:00", "03:00"]], "sa": [["22:00", "03:00"]]}
    # суббота 01:30 — хвост пятничного интервала
    assert is_open_at(bar, datetime(2026, 7, 18, 1, 30)) is True
    # суббота 04:00 — хвост кончился, субботний ещё не начался
    assert is_open_at(bar, datetime(2026, 7, 18, 4, 0)) is False


def test_overnight_daily_format():
    club = {"open": "22:00", "close": "04:00"}
    assert is_open_at(club, MON_NIGHT) is True
    assert is_open_at(club, TUE_EARLY) is True
    assert is_open_at(club, MON_NOON) is False


def test_end_of_day_2400():
    allday = {"mo": [["00:00", "24:00"]]}
    assert is_open_at(allday, MON_NOON) is True
    assert is_open_at(allday, MON_NIGHT) is True
