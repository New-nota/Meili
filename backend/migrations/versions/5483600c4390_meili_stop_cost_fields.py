"""ТЗ-Meili M4.1: диапазон-оценки стоимости на trip_stops.

Отход от §3 ТЗ (задокументировано): бюджет поездки уже существует как
trips.budget_total + trips.currency (S9 WP-A) — дубли budget_amount /
budget_currency не создаём (правила 1.2/1.6 самого ТЗ). Точная сумма стопа —
существующий estimated_cost; cost_source (ТЗ-E) расширяется значениями
viator|price_level|estimate ('price_level' длиннее 10 симв. — ALTER длины).
Валюта одна на поездку — cost_currency не заводим, executor валидирует.

Revision ID: 5483600c4390
Revises: 8d6d1bdc3e92
Create Date: 2026-07-15 19:17:01.587302

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5483600c4390'
down_revision: Union[str, None] = '8d6d1bdc3e92'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('trip_stops', sa.Column('cost_min', sa.Numeric(precision=10, scale=2), nullable=True))
    op.add_column('trip_stops', sa.Column('cost_max', sa.Numeric(precision=10, scale=2), nullable=True))
    op.add_column('trip_stops', sa.Column('cost_is_estimate', sa.Boolean(), server_default='false', nullable=False))
    # 'price_level' (11 симв.) не влезает в String(10) из ТЗ-E
    op.alter_column('trip_stops', 'cost_source', type_=sa.String(length=20), existing_nullable=False)


def downgrade() -> None:
    op.alter_column('trip_stops', 'cost_source', type_=sa.String(length=10), existing_nullable=False)
    op.drop_column('trip_stops', 'cost_is_estimate')
    op.drop_column('trip_stops', 'cost_max')
    op.drop_column('trip_stops', 'cost_min')
