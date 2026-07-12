"""Email-уведомления — Спринт 7.

Dev-режим: SMTP_HOST не задан → письмо пишется в лог (видно в docker logs).
Prod-режим: SMTP_HOST задан → отправка через smtplib (STARTTLS) в отдельном
потоке (asyncio.to_thread), чтобы не блокировать event loop.

Отправка намеренно «best effort»: сбой почты никогда не роняет запрос —
подтверждение брони важнее письма о нём.
"""
import asyncio
import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings

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
) -> tuple[str, str]:
    """(subject, body) письма о подтверждённой брони."""
    subject = f"Meili: бронь подтверждена — {place_name or 'место в маршруте'}"
    lines = [
        "Ваша бронь подтверждена!",
        "",
        f"Место: {place_name or '—'}",
        f"Провайдер: {provider}",
        f"Номер брони: {booking_ref}",
    ]
    if visit_date:
        lines.append(f"Дата визита: {visit_date}")
    lines += ["", "Хорошей поездки!", "— Meili"]
    return subject, "\n".join(lines)


async def send_booking_confirmation(
    to: str,
    place_name: str | None,
    provider: str,
    booking_ref: str,
    visit_date: str | None = None,
) -> bool:
    subject, body = booking_confirmation_body(
        place_name, provider, booking_ref, visit_date
    )
    return await send_email(to, subject, body)
