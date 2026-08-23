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


async def revoke_all_refresh(user_id: str) -> int:
    """Отозвать все refresh пользователя (реакция на переиспользование)."""
    revoked = 0
    async for key in redis_client.scan_iter(match=f"refresh:{user_id}:*"):
        await redis_client.delete(key)
        revoked += 1
    return revoked


# --- Pending-регистрация по коду на почту (S14) ------------------------------
# До подтверждения кода User в БД НЕ создаём: черновик регистрации живёт здесь
# (TTL 1ч, сама протухнет — фоновой чистки нет). Код валиден 10 мин внутри
# черновика; попытки ввода ограничены. Resend — с кулдауном 60с.

PENDING_REG_TTL = 3600   # 1 час — живучесть черновика регистрации
CODE_TTL = 600           # 10 мин — валидность конкретного кода
RESEND_COOLDOWN = 60     # сек между «выслать заново»
MAX_CODE_ATTEMPTS = 5


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