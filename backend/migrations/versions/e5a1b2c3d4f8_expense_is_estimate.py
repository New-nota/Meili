"""trip_expenses.is_estimate: статья-оценка (проживание по «номер от» 2ГИС)

Revision ID: e5a1b2c3d4f8
Revises: d4f9a2b3c5e7
Create Date: 2026-10-10 15:00:00

Живой прогон: Meili поселила в отель, а цена ночи в бюджет не попала —
«номер от N» тогда решили только показывать. Теперь «Применить» (и кнопка
«Жильё») добавляет статью lodging = «от N» × ночи, помеченную как оценка:
бюджет рисует её с «≈», правка суммы руками снимает пометку.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'e5a1b2c3d4f8'
down_revision: Union[str, None] = 'd4f9a2b3c5e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("trip_expenses", sa.Column(
        "is_estimate", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("trip_expenses", "is_estimate")
