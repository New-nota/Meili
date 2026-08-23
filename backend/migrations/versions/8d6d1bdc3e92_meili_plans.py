"""ТЗ-Meili M3.2: замороженные планы ассистента (proposed|applied|discarded).

Revision ID: 8d6d1bdc3e92
Revises: 0e948df43dcd
Create Date: 2026-07-15 19:11:30.103661

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '8d6d1bdc3e92'
down_revision: Union[str, None] = '0e948df43dcd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'meili_plans',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('conversation_id', sa.Uuid(), nullable=False),
        sa.Column('plan_json', postgresql.JSONB(), nullable=False),
        sa.Column('status', sa.String(), server_default='proposed', nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(), nullable=False),
        sa.Column('applied_at', sa.TIMESTAMP(), nullable=True),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('meili_plans')
