from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

# echo управляется из .env (DB_ECHO=true) — в проде SQL-лог не нужен.
# pool_pre_ping (ревью): после рестарта Postgres пул отдавал мёртвые
# соединения, и первые запросы падали «connection is closed» (500), пока
# пул не перемелет их все. Пинг перед выдачей соединения — копейки
engine = create_async_engine(settings.DATABASE_URL, echo=settings.DB_ECHO, pool_pre_ping=True)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)

class Base(DeclarativeBase):
    pass

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()