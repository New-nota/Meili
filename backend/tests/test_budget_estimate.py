"""ТЗ-E: юнит-тесты чистой функции estimate_stop_cost — все ветки."""
from decimal import Decimal

from app.models.place import Place
from app.services.budget_estimate import estimate_stop_cost


def make_place(**kwargs) -> Place:
    defaults = dict(
        name="Тестовое место", pricing_model="free",
        avg_check=None, ticket_adult=None, ticket_child=None, price_currency=None,
    )
    defaults.update(kwargs)
    return Place(**defaults)


def test_free_is_zero_not_none():
    """free -> 0.00: «Бесплатно» отличимо от «нет данных» (None)."""
    place = make_place(pricing_model="free")
    assert estimate_stop_cost(place, 2, 1, "EUR") == Decimal("0.00")


def test_free_ignores_prices_and_currency():
    # даже с заполненными ценами и чужой валютой free = 0
    place = make_place(pricing_model="free", avg_check=Decimal("100"), price_currency="USD")
    assert estimate_stop_cost(place, 2, 0, "EUR") == Decimal("0.00")


def test_per_person_counts_full_heads():
    place = make_place(pricing_model="per_person", avg_check=Decimal("12.50"))
    # 2 взрослых + 2 ребёнка = 4 полные головы
    assert estimate_stop_cost(place, 2, 2, "EUR") == Decimal("50.00")


def test_per_person_no_avg_check_is_none():
    place = make_place(pricing_model="per_person")
    assert estimate_stop_cost(place, 2, 0, "EUR") is None


def test_ticketed_with_children():
    place = make_place(
        pricing_model="ticketed",
        ticket_adult=Decimal("10.00"), ticket_child=Decimal("4.00"),
    )
    assert estimate_stop_cost(place, 2, 3, "EUR") == Decimal("32.00")


def test_ticketed_without_child_price_children_free():
    # (ticket_child or 0) * children — детская цена не задана -> дети 0
    place = make_place(pricing_model="ticketed", ticket_adult=Decimal("10.00"))
    assert estimate_stop_cost(place, 2, 3, "EUR") == Decimal("20.00")


def test_ticketed_no_adult_price_is_none():
    place = make_place(pricing_model="ticketed", ticket_child=Decimal("4.00"))
    assert estimate_stop_cost(place, 2, 1, "EUR") is None


def test_currency_mismatch_is_none():
    """Валюта места != валюты поездки -> None (FX вне ТЗ, не выдумываем)."""
    place = make_place(
        pricing_model="per_person", avg_check=Decimal("500.00"), price_currency="RUB",
    )
    assert estimate_stop_cost(place, 1, 0, "EUR") is None


def test_currency_match_case_insensitive():
    place = make_place(
        pricing_model="per_person", avg_check=Decimal("15.00"), price_currency="eur",
    )
    assert estimate_stop_cost(place, 1, 0, "EUR") == Decimal("15.00")


def test_no_place_currency_assumes_trip_currency():
    # валюта места не задана -> считаем в валюте поездки
    place = make_place(pricing_model="per_person", avg_check=Decimal("15.00"))
    assert estimate_stop_cost(place, 2, 0, "EUR") == Decimal("30.00")


def test_rounding_two_places_decimal():
    place = make_place(pricing_model="per_person", avg_check=Decimal("10.33"))
    result = estimate_stop_cost(place, 3, 0, "EUR")
    assert result == Decimal("30.99")
    assert isinstance(result, Decimal)
