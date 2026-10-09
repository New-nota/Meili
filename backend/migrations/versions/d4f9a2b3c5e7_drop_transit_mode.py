"""transit -> walking: режим «транспорт» убран

Revision ID: d4f9a2b3c5e7
Revises: c3e8f1a2b4d6
Create Date: 2026-10-10 13:00:00

Costing multimodal требует GTFS-тайлов, их нет — Valhalla отвечала 400 на
любой перегон в режиме transit, и выбор «транспорт» ломал маршрут дня.
Режим убран из TransportMode; сохранённые значения переводим в walking
(дефолт). Колонки — строки, схема не меняется. downgrade не нужен: данные
«был transit» не восстановить, и вернуть режим без тайлов бессмысленно.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'd4f9a2b3c5e7'
down_revision: Union[str, None] = 'c3e8f1a2b4d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE trip_stops SET transport_to_next = 'walking' WHERE transport_to_next = 'transit'")
    op.execute("UPDATE trips SET transport_default = 'walking' WHERE transport_default = 'transit'")
    op.execute("UPDATE trip_days SET start_transport = 'walking' WHERE start_transport = 'transit'")


def downgrade() -> None:
    pass
