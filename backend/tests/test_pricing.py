"""ТЗ-Meili M5.1: ценовой гибрид — реальный источник vs помеченная оценка."""
from decimal import Decimal

import pytest

from app.models.place import Place
from app.services.meili.pricing import resolve_price


def make_place(**kwargs) -> Place:
    defaults = dict(
        name="Место", pricing_model="free", avg_check=None,
        ticket_adult=None, ticket_child=None, price_currency=None, price_level=None,
    )
    defaults.update(kwargs)
    return Place(**defaults)


@pytest.mark.asyncio
async def test_real_ticket_price_not_estimate():
    place = make_place(pricing_model="ticketed", ticket_adult=Decimal("12.00"),
                       price_currency="EUR")
    info = await resolve_price(place)
    assert info.is_estimate is False
    assert info.source == "price_level"
    assert info.amount == Decimal("12.00")


@pytest.mark.asyncio
async def test_price_level_is_real_source():
    """M5.1 DoD: место с price_level -> реальная цена, is_estimate=false."""
    place = make_place(pricing_model="per_person", price_level=3)  # avg_check нет
    info = await resolve_price(place)
    assert info.is_estimate is False
    assert info.price_level == 3
    assert "₽₽₽" in info.label


@pytest.mark.asyncio
async def test_no_source_is_estimate():
    """M5.1 DoD: без источника -> только диапазон-оценка, is_estimate=true."""
    place = make_place(pricing_model="per_person")  # ни цен, ни price_level
    info = await resolve_price(place)
    assert info.is_estimate is True
    assert info.source == "estimate"
    assert info.amount is None  # число не выдумывается


@pytest.mark.asyncio
async def test_free_is_real_zero():
    info = await resolve_price(make_place(pricing_model="free"))
    assert info.is_estimate is False
    assert info.amount == Decimal("0.00")
