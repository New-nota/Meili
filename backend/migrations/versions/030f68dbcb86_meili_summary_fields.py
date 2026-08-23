"""ТЗ-Meili M5.3: инкрементальная суммаризация истории диалога.

conversations.summary — свёрнутая история; summary_covers_until — граница:
сообщения старше уже в summary и в LLM-окно не подмешиваются.

Revision ID: 030f68dbcb86
Revises: 5483600c4390
Create Date: 2026-07-15 22:38:41.380194

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '030f68dbcb86'
down_revision: Union[str, None] = '5483600c4390'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('conversations', sa.Column('summary', sa.TEXT(), nullable=True))
    op.add_column('conversations', sa.Column('summary_covers_until', sa.TIMESTAMP(), nullable=True))


def downgrade() -> None:
    op.drop_column('conversations', 'summary_covers_until')
    op.drop_column('conversations', 'summary')
