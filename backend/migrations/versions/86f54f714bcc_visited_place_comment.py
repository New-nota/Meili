"""S15: комментарий к посещённому месту.

Блок «Оценка» в панели стопа и вечерний опрос «как вам день» пишут
опциональный текст впечатления рядом с rating (1–5).

Revision ID: 86f54f714bcc
Revises: 8eeec9895dcd
Create Date: 2026-07-17 09:03:37.207415

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '86f54f714bcc'
down_revision: Union[str, None] = '8eeec9895dcd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user_visited_places', sa.Column('comment', sa.TEXT(), nullable=True))


def downgrade() -> None:
    op.drop_column('user_visited_places', 'comment')
