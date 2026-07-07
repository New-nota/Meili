"""Deep-link логика бронирования (app/services/booking.py) — Sprint 6."""
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.models.place import Place
from app.services.booking import (
    SUPPORTED_PROVIDERS,
    booking_to_dict,
    build_deep_link,
)


def _place(**kwargs) -> Place:
    defaults = dict(name="Рыбная деревня", city="Калининград")
    defaults.update(kwargs)
    return Place(**defaults)


class TestBuildDeepLink:
    def test_place_booking_url_wins(self):
        # прямой url у места приоритетнее поискового deep-link
        place = _place(booking_url="https://partner.example/book/123")
        assert build_deep_link("viator", place) == "https://partner.example/book/123"

    def test_viator_search_link(self):
        link = build_deep_link("viator", _place())
        assert link.startswith("https://www.viator.com/searchResults/all?text=")
        # кириллица закодирована, city попал в запрос
        assert "%" in link

    def test_opentable_includes_coords_when_present(self):
        place = _place(location=from_shape(Point(20.5118, 54.7068), srid=4326))
        link = build_deep_link("opentable", place)
        assert link.startswith("https://www.opentable.com/s?term=")
        assert "latitude=54.7068" in link
        assert "longitude=20.5118" in link

    def test_opentable_without_coords(self):
        link = build_deep_link("opentable", _place())
        assert "latitude" not in link

    def test_thefork_link(self):
        link = build_deep_link("thefork", _place())
        assert link.startswith("https://www.thefork.com/search?queryText=")

    def test_unknown_provider_returns_none(self):
        assert build_deep_link("booking_com", _place()) is None

    def test_all_supported_providers_produce_links(self):
        for provider in SUPPORTED_PROVIDERS:
            assert build_deep_link(provider, _place()) is not None


class TestBookingToDict:
    def test_extracts_deep_link_from_details(self):
        from types import SimpleNamespace

        booking = SimpleNamespace(
            id="b1",
            trip_stop_id="s1",
            provider="viator",
            status="pending",
            booked_at=None,
            external_id=None,
            amount=None,
            currency=None,
            booking_details={"deep_link": "https://x.example/y"},
        )
        assert booking_to_dict(booking)["deep_link"] == "https://x.example/y"

    def test_handles_null_details(self):
        from types import SimpleNamespace

        booking = SimpleNamespace(
            id="b1",
            trip_stop_id="s1",
            provider="viator",
            status="pending",
            booked_at=None,
            external_id=None,
            amount=None,
            currency=None,
            booking_details=None,
        )
        assert booking_to_dict(booking)["deep_link"] is None
