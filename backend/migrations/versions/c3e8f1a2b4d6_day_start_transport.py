"""trip_days.start_transport: способ добраться от старта дня до первой точки

Revision ID: c3e8f1a2b4d6
Revises: 9b2d4e7a1c05
Create Date: 2026-10-10 12:00:00

Живой прогон: у перегона «старт → первая точка» своего режима не было —
он брал transport_to_next первого стопа, а в UI был только для чтения;
выбрать «на машине от отеля» было нельзя. NULL — как раньше (режим первого
стопа или дефолт поездки). Строка + Literal в схеме, не PG ENUM.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'c3e8f1a2b4d6'
down_revision: Union[str, None] = '9b2d4e7a1c05'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("trip_days", sa.Column("start_transport", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("trip_days", "start_transport")
