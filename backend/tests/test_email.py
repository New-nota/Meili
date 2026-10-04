"""Email-уведомления (app/services/email.py) — Sprint 7."""
from unittest.mock import patch

from app.services.email import (
    booking_confirmation_body,
    build_message,
    send_email,
)


def test_build_message_headers():
    msg = build_message("user@wanderown.dev", "Тема", "Тело письма")
    assert msg["To"] == "user@wanderown.dev"
    assert msg["Subject"] == "Тема"
    assert "Тело письма" in msg.get_content()


def test_booking_confirmation_body_full():
    subject, body = booking_confirmation_body(
        "Рыбная деревня", "viator", "VIA-42", "2026-08-01"
    )
    assert "Рыбная деревня" in subject
    assert "VIA-42" in body
    assert "viator" in body
    assert "2026-08-01" in body


def test_booking_confirmation_body_minimal():
    subject, body = booking_confirmation_body(None, "thefork", "abc123")
    assert "место в маршруте" in subject
    assert "abc123" in body
    assert "Дата визита" not in body  # без даты строка не добавляется


async def test_send_email_dev_mode_logs_and_succeeds(caplog):
    # SMTP_HOST не задан (dev) -> письмо в лог, результат True.
    # Явно гасим SMTP_HOST: в .env он может быть задан, а тест про dev-ветку
    import logging

    from app.services import email as email_module

    with patch.object(email_module.settings, "SMTP_HOST", ""):
        with caplog.at_level(logging.INFO, logger="meili.email"):
            ok = await send_email("user@wanderown.dev", "Тест", "Привет")
    assert ok is True
    assert "user@wanderown.dev" in caplog.text


async def test_send_email_smtp_failure_returns_false():
    # SMTP настроен, но сервер недоступен -> False, без исключения
    from app.services import email as email_module

    with patch.object(email_module.settings, "SMTP_HOST", "smtp.invalid.local"):
        with patch.object(
            email_module, "_send_sync", side_effect=ConnectionError("boom")
        ):
            ok = await send_email("user@wanderown.dev", "Тест", "Привет")
    assert ok is False


async def test_reserved_domains_never_hit_smtp():
    """Ревью: тестовые регистрации на живом стеке слали настоящие письма.
    RFC 2606-домены (example.com, *.example) — только в лог, даже с SMTP."""
    from app.services import email as email_module

    with patch.object(email_module.settings, "SMTP_HOST", "smtp.real.local"):
        with patch.object(email_module, "_send_sync", side_effect=AssertionError("ушло в SMTP")):
            assert await send_email("e2e_1@e2e.example", "Тест", "x") is True
            assert await send_email("x@EXAMPLE.com", "Тест", "x") is True
