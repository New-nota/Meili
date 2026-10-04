"""fk_indexes

Revision ID: 33da5e8b47d6
Revises: 61e9a236312b
Create Date: 2026-10-05 00:30:00

Ревью (профиль): кроме первичных ключей и пары уникальных индексов, внешние
ключи, по которым идёт почти вся фильтрация, были без индексов — «мои
поездки» (trips.user_id), стопы поездки (trip_stops.trip_id), окно диалога
Meili (messages.conversation_id) и т.д. шли seq scan'ом. На малых таблицах
это незаметно, но растёт линейно с базой. Имена = index=True в моделях
(ix_<таблица>_<колонка>), чтобы alembic check не видел дрейфа.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '33da5e8b47d6'
down_revision: Union[str, None] = '61e9a236312b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEXES = [
    ("trips", "user_id"),
    ("trip_locations", "trip_id"),
    ("trip_expenses", "trip_id"),
    ("trip_stops", "trip_id"),
    ("trip_stops", "place_id"),
    ("bookings", "user_id"),
    ("bookings", "trip_stop_id"),
    ("conversations", "user_id"),
    ("conversations", "trip_id"),
    ("meili_plans", "conversation_id"),
    ("messages", "conversation_id"),
    ("trip_likes", "trip_id"),
    ("user_visited_places", "place_id"),
]


def upgrade() -> None:
    for table, column in INDEXES:
        op.create_index(f"ix_{table}_{column}", table, [column], if_not_exists=True)


def downgrade() -> None:
    for table, column in reversed(INDEXES):
        op.drop_index(f"ix_{table}_{column}", table_name=table, if_exists=True)
