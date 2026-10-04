import json
import time

import redis.asyncio as aioredis
from app.core.config import settings

# создает пул соеденений и fast api переиспользует соединения из пула вместо создания каждый раз новых
redis_client = aioredis.from_url(
    settings.REDIS_URL,
    encoding="utf-8",
    decode_responses=True # вернет строки а не байты
)


# --- Хранилище валидных refresh-jti (S8 WP-1) --------------------------------
# Валидным считается только jti, лежащий в Redis. Ротация = DEL старого +
# SET нового. Отзыв (logout/компрометация) = DEL.

def refresh_key(user_id: str, jti: str) -> str:
    return f"refresh:{user_id}:{jti}"


async def store_refresh(user_id: str, jti: str) -> None:
    ttl = settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600
    await redis_client.set(refresh_key(user_id, jti), "1", ex=ttl)


async def is_refresh_valid(user_id: str, jti: str) -> bool:
    return bool(await redis_client.exists(refresh_key(user_id, jti)))


async def revoke_refresh(user_id: str, jti: str) -> None:
    await redis_client.delete(refresh_key(user_id, jti))


# QA: окно «параллельного» refresh. Два запроса с одной кукой — норма, а не
# кража: StrictMode дважды зовёт bootstrap-эффект, вкладки рефрешатся разом,
# пачка запросов TripPlanner одновременно ловит 401. Раньше это была гонка
# check-then-delete: если второй запрос опаздывал за DEL первого, срабатывал
# «reuse detected» и юзера выкидывало из ВСЕХ сессий; если успевал — оба
# проходили, и лишний jti висел валидным 30 дней. Теперь гашение атомарное
# (GETDEL), а погашенный jti ещё REFRESH_GRACE_S секунд помнится как «только
# что ротирован» — повтор в этом окне получает свою пару без revoke-all.
REFRESH_GRACE_S = 30


def _refresh_grace_key(user_id: str, jti: str) -> str:
    return f"refresh_grace:{user_id}:{jti}"


async def consume_refresh(user_id: str, jti: str) -> str:
    """Атомарно погасить refresh-jti при ротации.

    "ok"      — jti был валиден, погашен сейчас;
    "grace"   — jti погашен только что параллельным запросом (не кража);
    "invalid" — jti неизвестен/отозван давно: подозрение на переиспользование.
    """
    if await redis_client.getdel(refresh_key(user_id, jti)) is not None:
        await redis_client.set(_refresh_grace_key(user_id, jti), "1", ex=REFRESH_GRACE_S)
        return "ok"
    if await redis_client.exists(_refresh_grace_key(user_id, jti)):
        return "grace"
    return "invalid"


async def revoke_all_refresh(user_id: str) -> int:
    """Отозвать все refresh пользователя (реакция на переиспользование)."""
    revoked = 0
    async for key in redis_client.scan_iter(match=f"refresh:{user_id}:*"):
        await redis_client.delete(key)
        revoked += 1
    # grace-окно тоже гасим: иначе только что ротированный (возможно,
    # украденный) jti прожил бы ещё REFRESH_GRACE_S после тотального отзыва
    async for key in redis_client.scan_iter(match=f"refresh_grace:{user_id}:*"):
        await redis_client.delete(key)
    return revoked


# --- Pending-регистрация по коду на почту (S14) ------------------------------
# До подтверждения кода User в БД НЕ создаём: черновик регистрации живёт здесь
# (TTL 1ч, сама протухнет — фоновой чистки нет). Код валиден 10 мин внутри
# черновика; попытки ввода ограничены. Resend — с кулдауном 60с.

PENDING_REG_TTL = 3600   # 1 час — живучесть черновика регистрации
CODE_TTL = 600           # 10 мин — валидность конкретного кода
RESEND_COOLDOWN = 60     # сек между «выслать заново»
MAX_CODE_ATTEMPTS = 5
# Ревью: троттл /auth/register. Жёсткий кулдаун сюда не годится — S14 нарочно
# разрешает повторный register на неподтверждённый адрес (владелец почты
# перехватывает чужую регистрацию), и минутная блокировка эту защиту ломала бы.
# Поэтому не «раз в минуту», а «не больше N писем на адрес за час»: перехват
# остаётся возможным, а заваливать чужой ящик письмами (и жечь наш CPU на
# bcrypt — ручка публичная) уже нельзя.
REGISTER_WINDOW = 3600
MAX_REGISTER_PER_WINDOW = 5


def _pending_key(email: str) -> str:
    return f"pending_reg:{email.lower()}"


def _cooldown_key(email: str) -> str:
    return f"reg_cooldown:{email.lower()}"


async def store_pending_registration(email: str, password_hash: str, name: str | None, code: str) -> None:
    """Создать/перезаписать черновик регистрации (новый код, попытки сброшены)."""
    payload = json.dumps({
        "password_hash": password_hash,
        "name": name,
        "code": code,
        "code_expires": time.time() + CODE_TTL,
        "attempts": 0,
    })
    await redis_client.set(_pending_key(email), payload, ex=PENDING_REG_TTL)


async def get_pending_registration(email: str) -> dict | None:
    raw = await redis_client.get(_pending_key(email))
    return json.loads(raw) if raw else None


async def save_pending_registration(email: str, data: dict) -> None:
    """Перезаписать черновик, сохранив остаток TTL (счётчик попыток и т.п.)."""
    await redis_client.set(_pending_key(email), json.dumps(data), keepttl=True)


async def delete_pending_registration(email: str) -> None:
    await redis_client.delete(_pending_key(email))


async def start_resend_cooldown(email: str) -> bool:
    """True — кулдаун поставлен (можно слать); False — ещё рано (уже стоит)."""
    # SET NX EX: атомарно поставить, только если ключа нет
    ok = await redis_client.set(_cooldown_key(email), "1", ex=RESEND_COOLDOWN, nx=True)
    return bool(ok)


def _register_quota_key(email: str) -> str:
    return f"reg_quota:{email.lower()}"


async def take_register_slot(email: str) -> bool:
    """True — можно регистрировать; False — квота адреса на окно исчерпана."""
    key = _register_quota_key(email)
    used = await redis_client.incr(key)
    if used == 1:
        # окно стартует с первой попытки и НЕ продлевается следующими
        await redis_client.expire(key, REGISTER_WINDOW)
    return used <= MAX_REGISTER_PER_WINDOW


async def clear_register_quota(email: str) -> None:
    """Адрес подтверждён — счётчик попыток по нему больше не нужен."""
    await redis_client.delete(_register_quota_key(email))


async def clear_resend_cooldown(email: str) -> None:
    """Снять кулдаун: адрес подтверждён, throttle письма ему больше не нужен.

    Кулдаун охраняет отправку писем на НЕподтверждённый адрес. После verify
    аккаунт существует, и висящий ключ только мешал бы — например, повторной
    регистрации после удаления аккаунта.
    """
    await redis_client.delete(_cooldown_key(email))

# --- QA: троттл перебора паролей на /auth/login --------------------------------
# Ручка публичная и без ограничений: словарь паролей перебирался с той
# скоростью, с какой bcrypt успевал. Считаем неудачи на пару (email, IP):
# чужой IP не может заблокировать вход владельцу, а перебор с одного адреса
# упирается в потолок. Успешный вход счётчик сбрасывает.
LOGIN_FAIL_WINDOW = 15 * 60
MAX_LOGIN_FAILS = 10


def _login_fail_key(email: str, ip: str) -> str:
    return f"login_fail:{email.lower()}:{ip}"


async def login_blocked(email: str, ip: str) -> bool:
    raw = await redis_client.get(_login_fail_key(email, ip))
    return raw is not None and int(raw) >= MAX_LOGIN_FAILS


async def register_login_fail(email: str, ip: str) -> None:
    key = _login_fail_key(email, ip)
    used = await redis_client.incr(key)
    if used == 1:
        await redis_client.expire(key, LOGIN_FAIL_WINDOW)


async def clear_login_fails(email: str, ip: str) -> None:
    await redis_client.delete(_login_fail_key(email, ip))


# --- QA: Meili — один ход на диалог и частота ходов -------------------------
# Двойная отправка (две вкладки, повтор запроса) запускала ДВА agent loop'а
# над одной историей: ответы перемешивались, план замораживался дважды.
# Плюс потолок ходов в минуту на юзера — страховка от зацикленного клиента
# (каждый ход — до LLM_MAX_STEPS платных запросов к провайдеру).
MEILI_TURNS_PER_MINUTE = 10


def _turn_lock_key(conversation_id) -> str:
    return f"meili_turn:{conversation_id}"


async def acquire_turn_lock(conversation_id, ttl_s: int) -> bool:
    """True — ход наш. TTL — страховка, если процесс умрёт посреди хода."""
    return bool(await redis_client.set(_turn_lock_key(conversation_id), "1", ex=ttl_s, nx=True))


async def release_turn_lock(conversation_id) -> None:
    await redis_client.delete(_turn_lock_key(conversation_id))


async def take_meili_turn_slot(user_id) -> bool:
    key = f"meili_rate:{user_id}:{int(time.time() // 60)}"
    used = await redis_client.incr(key)
    if used == 1:
        await redis_client.expire(key, 120)
    return used <= MEILI_TURNS_PER_MINUTE
