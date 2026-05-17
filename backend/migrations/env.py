import asyncio
from logging.config import fileConfig
from sqlalchemy.ext.asyncio import create_async_engine
from alembic import context
from app.core.config import settings
from app.models import Base, User, Place, Trip, TripStop, TripLike, UserVisitedPlace

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
OUR_TABLES = {'users', 'trips', 'places', 'trip_stops', 'trip_likes', 'user_visited_places'}

def include_object(object, name, type_, reflected, compare_to):
    if type_ == "table" and name not in OUR_TABLES:
        return False
    return True
def do_run_migretions(connection):
    context.configure(connection=connection, target_metadata=target_metadata, include_object=include_object)
    with context.begin_transaction():
        context.run_migrations()

async def run_async_migrations():
    connectable = create_async_engine(settings.DATABASE_URL)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migretions)
    await connectable.dispose()

def run_migrations_online():
    asyncio.run(run_async_migrations())

run_migrations_online()