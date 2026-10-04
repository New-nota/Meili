"""Тексты, которые бэкенд отдаёт людям сам (PDF, .ics, письма) — ru/en.

Ошибки API сюда не относятся: там машинные коды, локализует фронт (S9 WP-C).
Язык приходит из Accept-Language — фронт кладёт туда язык интерфейса
(api/client.ts). de/fr/es отдаём по-английски — тот же фолбэк, что у фронта
(fallbackLng: 'en'). Нет заголовка (curl, тесты, старые клиенты) — русский,
как было до перевода.
"""
from typing import Literal

from fastapi import Header

Lang = Literal["ru", "en"]
DEFAULT_LANG: Lang = "ru"

MESSAGES: dict[Lang, dict[str, str]] = {
    "ru": {
        # PDF-итинерарий
        "pdf.day": "День {num}",
        "pdf.start": "Старт: {place} в {time}",
        "pdf.finish": "Финиш: {place}",
        "pdf.minutes": "{count} мин",
        "pdf.hours": "часы: {hours}",
        "pdf.budget": "Бюджет",
        "pdf.planned": "Запланировано",
        "pdf.booked": "Забронировано",
        "pdf.limit": "Лимит",
        "pdf.remaining": "Остаток",
        "cost.booked": "{amount} {currency} (бронь)",
        "cost.free": "бесплатно",
        # .ics
        "ics.booking": "Бронь: {ref}",
        # письма
        "mail.booking.subject": "Hermod: бронь подтверждена — {place}",
        "mail.booking.placeFallback": "место в маршруте",
        "mail.booking.title": "Ваша бронь подтверждена!",
        "mail.booking.place": "Место: {place}",
        "mail.booking.provider": "Провайдер: {provider}",
        "mail.booking.ref": "Номер брони: {ref}",
        "mail.booking.date": "Дата визита: {date}",
        "mail.booking.bye": "Хорошей поездки!",
        "mail.code.subject": "Hermod: код подтверждения регистрации",
        "mail.code.code": "Ваш код подтверждения: {code}",
        "mail.code.ttl": "Код действует 10 минут. Если вы не регистрировались в Hermod —",
        "mail.code.ignore": "просто проигнорируйте это письмо.",
        "mail.signature": "Hermod. Маршрут доставлен.",
    },
    "en": {
        "pdf.day": "Day {num}",
        "pdf.start": "Start: {place} at {time}",
        "pdf.finish": "Finish: {place}",
        "pdf.minutes": "{count} min",
        "pdf.hours": "hours: {hours}",
        "pdf.budget": "Budget",
        "pdf.planned": "Planned",
        "pdf.booked": "Booked",
        "pdf.limit": "Limit",
        "pdf.remaining": "Remaining",
        "cost.booked": "{amount} {currency} (booked)",
        "cost.free": "free",
        "ics.booking": "Booking: {ref}",
        "mail.booking.subject": "Hermod: booking confirmed — {place}",
        "mail.booking.placeFallback": "a place on your route",
        "mail.booking.title": "Your booking is confirmed!",
        "mail.booking.place": "Place: {place}",
        "mail.booking.provider": "Provider: {provider}",
        "mail.booking.ref": "Booking ref: {ref}",
        "mail.booking.date": "Visit date: {date}",
        "mail.booking.bye": "Have a great trip!",
        "mail.code.subject": "Hermod: your sign-up code",
        "mail.code.code": "Your confirmation code: {code}",
        "mail.code.ttl": "The code is valid for 10 minutes. If you didn't sign up for Hermod,",
        "mail.code.ignore": "just ignore this email.",
        "mail.signature": "Hermod. Route delivered.",
    },
}


def t(lang: Lang, key: str, **params) -> str:
    return MESSAGES[lang][key].format(**params)


def lang_from_header(accept_language: str | None) -> Lang:
    """Самый приоритетный язык из Accept-Language → ru|en."""
    if not accept_language:
        return DEFAULT_LANG
    ranked: list[tuple[float, str]] = []
    for part in accept_language.split(","):
        tag, _, params = part.strip().partition(";")
        tag = tag.strip().lower()
        if not tag or tag == "*":
            continue
        q = 1.0
        if params.strip().startswith("q="):
            try:
                q = float(params.strip()[2:])
            except ValueError:
                continue  # битый q — пропускаем запись, а не роняем запрос
        if q <= 0:
            continue  # q=0 по RFC 9110 — «этот язык не нужен»
        ranked.append((q, tag.split("-")[0]))
    if not ranked:
        return DEFAULT_LANG
    # sorted стабилен: при равных q побеждает тот, что раньше в заголовке
    best = sorted(ranked, key=lambda r: -r[0])[0][1]
    return "ru" if best == "ru" else "en"


async def get_lang(accept_language: str | None = Header(default=None)) -> Lang:
    """FastAPI-зависимость: язык ответа для текстов из MESSAGES."""
    return lang_from_header(accept_language)
