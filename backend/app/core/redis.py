import redis.asyncio as aioredis
from app.core.config import settings

# создает пул соеденений и fast api переиспользует соединения из пула вместо создания каждый раз новых
redis_client = aioredis.from_url(
    settings.REDIS_URL,
    encoding="utf-8",
    decode_responses=True # вернет строки а не байты
)