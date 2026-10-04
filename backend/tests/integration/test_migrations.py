"""Миграции с нуля — то, чего create_all в остальных тестах не видит.

Ревью нашло сразу три мины, которые жили, потому что схему тестов строят
модели, а не миграции:
- цепочка с нуля падала на первой таблице («type geometry does not exist»):
  PostGIS включал только init-скрипт образа и только в POSTGRES_DB;
- триграммный индекс жил лишь в миграции — `alembic check` видел дрейф, и
  autogenerate следующей ревизии удалил бы его;
- downgrade падал на безымянном внешнем ключе (drop_constraint(None, …)).
Тест держит весь цикл: upgrade head → check → downgrade base → upgrade head.
"""
import os
import subprocess
from pathlib import Path

import pytest

from tests.integration.conftest import _ADMIN_SYNC_URL, _APP_DB_URL

MIG_DB = "wanderown_migtest"
BACKEND = Path(__file__).resolve().parents[2]


def _alembic(*args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "DATABASE_URL": _APP_DB_URL.rsplit("/", 1)[0] + f"/{MIG_DB}"}
    return subprocess.run(["alembic", *args], cwd=BACKEND, env=env,
                          capture_output=True, text=True, timeout=300)


@pytest.fixture
def scratch_db():
    from sqlalchemy import create_engine, text

    try:
        admin = create_engine(_ADMIN_SYNC_URL, isolation_level="AUTOCOMMIT")
        with admin.connect() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS {MIG_DB} WITH (FORCE)"))
            # голая база: без postgis/pg_trgm — их обязаны поднять миграции
            conn.execute(text(f"CREATE DATABASE {MIG_DB}"))
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"Postgres недоступен: {e}")
    yield
    with admin.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {MIG_DB} WITH (FORCE)"))
    admin.dispose()


def test_migrations_from_zero_match_models_and_roll_back(scratch_db):
    for step in (("upgrade", "head"), ("check",), ("downgrade", "base"), ("upgrade", "head"), ("check",)):
        r = _alembic(*step)
        assert r.returncode == 0, f"alembic {' '.join(step)}:\n{r.stdout[-2000:]}\n{r.stderr[-3000:]}"
