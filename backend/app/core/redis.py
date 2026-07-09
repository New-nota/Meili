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