"""S11: центр карты по выбранному городу.

Мастер создания (S11) даёт из автокомплита геокодера {city, lat, lon}.
Координаты города храним отдельно от start_* (те — «дом»/депо): по ним
центрируется карта пустой поездки, пока стопов ещё нет.

Revision ID: 8eeec9895dcd
Revises: 030f68dbcb86
Create Date: 2026-07-16 20:58:57.639490

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8eeec9895dcd'
down_revision: Union[str, None] = '030f68dbcb86'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('trips', sa.Column('city_lat', sa.Float(), nullable=True))
    op.add_column('trips', sa.Column('city_lon', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('trips', 'city_lon')
    op.drop_column('trips', 'city_lat')
