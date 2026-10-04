"""Email-уведомления — Спринт 7.

Dev-режим: SMTP_HOST не задан → письмо пишется в лог (видно в docker logs).
Prod-режим: SMTP_HOST задан → отправка через smtplib (STARTTLS) в отдельном
потоке (asyncio.to_thread), чтобы не блокировать event loop.

Отправка намеренно «best effort»: сбой почты никогда не роняет запрос —
подтверждение брони важнее письма о нём.

Язык письма — из Accept-Language запроса, который его вызвал (core/i18n).
"""
import asyncio
import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings
from app.core.i18n import DEFAULT_LANG, Lang, t

logger = logging.getLogger("meili.email")


def _send_sync(msg: EmailMessage) -> None:
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
        smtp.starttls()
        if settings.SMTP_USER and settings.SMTP_PASSWORD:
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        smtp.send_message(msg)


def build_message(to: str, subject: str, body: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = settings.EMAIL_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    return msg


async def send_email(to: str, subject: str, body: str) -> bool:
    """True — письмо ушло (или залогировано в dev-режиме), False — ошибка."""
    msg = build_message(to, subject, body)
    if not settings.SMTP_HOST:
        logger.info("[dev email] to=%s subject=%r\n%s", to, subject, body)
        return True
    try:
        await asyncio.to_thread(_send_sync, msg)
        return True
    except Exception:  # noqa: BLE001 — почта не должна ронять запрос
        logger.exception("Не удалось отправить письмо to=%s", to)
        return False


def booking_confirmation_body(
    place_name: str | None,
    provider: str,
    booking_ref: str,
    visit_date: str | None = None,
    lang: Lang = DEFAULT_LANG,
) -> tuple[str, str]:
    """(subject, body) письма о подтверждённой брони."""
    # письмо шлёт сервис (Hermod), не ассистент; сухая подпись — ТЗ-rename шаг 5
    subject = t(lang, "mail.booking.subject",
                place=place_name or t(lang, "mail.booking.placeFallback"))
    lines = [
        t(lang, "mail.booking.title"),
        "",
        t(lang, "mail.booking.place", place=place_name or "—"),
        t(lang, "mail.booking.provider", provider=provider),
        t(lang, "mail.booking.ref", ref=booking_ref),
    ]
    if visit_date:
        lines.append(t(lang, "mail.booking.date", date=visit_date))
    lines += ["", t(lang, "mail.booking.bye"), "", t(lang, "mail.signature")]
    return subject, "\n".join(lines)


async def send_booking_confirmation(
    to: str,
    place_name: str | None,
    provider: str,
    booking_ref: str,
    visit_date: str | None = None,
    lang: Lang = DEFAULT_LANG,
) -> bool:
    subject, body = booking_confirmation_body(
        place_name, provider, booking_ref, visit_date, lang
    )
    return await send_email(to, subject, body)


def registration_code_body(code: str, lang: Lang = DEFAULT_LANG) -> tuple[str, str]:
    """(subject, body) письма с кодом подтверждения регистрации (S14)."""
    body = "\n".join([
        t(lang, "mail.code.code", code=code),
        "",
        t(lang, "mail.code.ttl"),
        t(lang, "mail.code.ignore"),
        "",
        t(lang, "mail.signature"),
    ])
    return t(lang, "mail.code.subject"), body


async def send_registration_code(to: str, code: str, lang: Lang = DEFAULT_LANG) -> bool:
    subject, body = registration_code_body(code, lang)
    return await send_email(to, subject, body)
