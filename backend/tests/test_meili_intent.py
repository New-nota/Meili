"""meili_upgrade: интент «ищу места» -> tool_choice на первом шаге."""
import pytest

from app.services.meili.tools.search_places import _category_from_words, _subtype_of, wants_places


@pytest.mark.parametrize("text", [
    "найди отель в Светлогорске", "где поесть рядом с Рыбной деревней",
    "посоветуй бар", "хочу хостел подешевле", "что посмотреть в Тбилиси?",
    "музеи", "find a hotel in Paris",
])
def test_place_requests_are_detected(text):
    assert wants_places(text)


@pytest.mark.parametrize("text", [
    "спасибо!", "сделай бюджет 50000 рублей", "убери второй день", "привет",
])
def test_other_requests_are_not_forced(text):
    assert not wants_places(text)


def test_new_category_words():
    assert _category_from_words(["гостиница"])[0] == "hotel"
    assert _category_from_words(["пляжи"])[0] == "beach"
    assert _category_from_words(["зоопарк"])[0] == "attraction"
    assert _category_from_words(["бары"])[0] == "bar"
    assert _category_from_words(["барбарис"])[0] is None   # «бар» — только целиком
    assert _subtype_of("хостелы") == "hostel"
