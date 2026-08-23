"""ТЗ-E: цены мест для авто-оценки бюджета + источник суммы на стопах.

places: pricing_model (per_person|ticketed|free, строкой — стиль проекта),
avg_check / ticket_adult / ticket_child (Numeric 10,2), price_currency.
trip_stops: cost_source (auto|manual) — manual-суммы движок не пересчитывает.

Revision ID: 83d929823963
Revises: 59f9426f5eac
Create Date: 2026-07-15 18:17:17.900626

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '83d929823963'
down_revision: Union[str, None] = '59f9426f5eac'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # цены места: модель ценообразования + сами цены (NULL = нет данных)
    op.add_column('places', sa.Column('pricing_model', sa.String(length=20), server_default='free', nullable=False))
    op.add_column('places', sa.Column('avg_check', sa.Numeric(precision=10, scale=2), nullable=True))
    op.add_column('places', sa.Column('ticket_adult', sa.Numeric(precision=10, scale=2), nullable=True))
    op.add_column('places', sa.Column('ticket_child', sa.Numeric(precision=10, scale=2), nullable=True))
    op.add_column('places', sa.Column('price_currency', sa.String(length=3), nullable=True))
    # источник суммы стопа: auto пересчитывается движком, manual — нет
    op.add_column('trip_stops', sa.Column('cost_source', sa.String(length=10), server_default='auto', nullable=False))


def downgrade() -> None:
    op.drop_column('trip_stops', 'cost_source')
    op.drop_column('places', 'price_currency')
    op.drop_column('places', 'ticket_child')
    op.drop_column('places', 'ticket_adult')
    op.drop_column('places', 'avg_check')
    op.drop_column('places', 'pricing_model')
