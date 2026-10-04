"""Тексты бэкенда на ru/en (app/core/i18n.py): выбор языка + письма/PDF."""
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.core.i18n import MESSAGES, lang_from_header
from app.services.email import booking_confirmation_body, registration_code_body
from app.services.export_pdf import _cost_str


@pytest.mark.parametrize("header, expected", [
    (None, "ru"),                       # curl/тесты/старый клиент — как раньше
    ("", "ru"),
    ("ru", "ru"),
    ("en", "en"),
    ("en-US", "en"),
    ("ru-RU,ru;q=0.9,en;q=0.8", "ru"),
    ("en;q=0.5,ru;q=0.9", "ru"),        # решает q, а не порядок
    ("de", "en"),                       # de/fr/es — фолбэк фронта (en)
    ("fr-FR,fr;q=0.9", "en"),
    ("*", "ru"),
    ("en;q=abc", "ru"),                 # битый q не роняет запрос
    ("en;q=0", "ru"),                   # q=0 — «не надо»
])
def test_lang_from_header(header, expected):
    assert lang_from_header(header) == expected


def test_ru_and_en_have_same_keys():
    assert MESSAGES["ru"].keys() == MESSAGES["en"].keys()


def test_registration_code_body_en():
    subject, body = registration_code_body("123456", "en")
    assert subject == "Hermod: your sign-up code"
    assert "123456" in body
    assert not any("а" <= ch <= "я" for ch in subject + body.lower())


def test_booking_confirmation_body_en_fallback_place():
    subject, body = booking_confirmation_body(None, "viator", "VIA-1", "2026-08-01", "en")
    assert "a place on your route" in subject
    assert "Visit date: 2026-08-01" in body


def _stop(**kw):
    base = dict(cost_min=None, cost_max=None, cost_source="manual",
                estimated_cost=None, cost_is_estimate=False)
    return SimpleNamespace(**{**base, **kw})


def test_cost_str_localized():
    free_place = SimpleNamespace(pricing_model="free")
    assert _cost_str(_stop(cost_source="auto"), free_place, None, "EUR", "en") == "free"
    assert _cost_str(_stop(cost_source="auto"), free_place, None, "EUR") == "бесплатно"
    booked = _cost_str(_stop(), free_place, Decimal("12.50"), "EUR", "en")
    assert booked == "12.50 EUR (booked)"


def test_pdf_renderer_never_fetches():
    """Ревью: WeasyPrint не ходит ни в сеть, ни в файлы — даже если в HTML
    окажется <img src=…>, рендер не обращается по адресу."""
    from weasyprint import HTML

    from app.services.export_pdf import offline_fetcher

    html = ('<p>x</p><img src="http://169.254.169.254/latest/meta-data/">'
            '<img src="file:///etc/passwd">')
    pdf = HTML(string=html, url_fetcher=offline_fetcher()).write_pdf()
    assert pdf.startswith(b"%PDF")
    fetcher = offline_fetcher()
    for url in ("http://169.254.169.254/", "file:///etc/passwd"):
        try:
            fetcher.fetch(url)
        except Exception:
            continue
        raise AssertionError(f"fetcher открыл {url}")
