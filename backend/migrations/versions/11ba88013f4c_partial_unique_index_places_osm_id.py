"""partial unique index places osm_id

Revision ID: 11ba88013f4c
Revises: f69b1f396b60
Create Date: 2026-06-19 08:49:51.516019

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '11ba88013f4c'
down_revision: Union[str, None] = 'f69b1f396b60'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "uq_places_osm_id", "places", ["osm_id"], unique=True, postgresql_where=sa.text("osm_id IS NOT NULL")
    )


def downgrade() -> None:
    op.drop_index("uq_places_osm_id", table_name="places")
