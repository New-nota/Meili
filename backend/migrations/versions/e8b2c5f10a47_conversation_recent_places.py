"""Ревью Meili: диалог помнит найденные места.

Результаты search_places не переживали ход: в окно истории они не
подмешиваются (там только user/assistant content), а tool_calls — аудит.
На следующем ходе модель предлагала план по названиям из собственного
прошлого текста, а place_id придумывала — валидация их отклоняла, и ход
уходил в «извините за техническую ошибку, сейчас исправлю UUID» по кругу.

Храним последние найденные места прямо в диалоге и показываем их в снапшоте.

Revision ID: e8b2c5f10a47
Revises: c4f80a1b9d33
Create Date: 2026-08-24 10:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e8b2c5f10a47'
down_revision: Union[str, None] = 'c4f80a1b9d33'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column(
            "recent_places_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("conversations", "recent_places_json")
