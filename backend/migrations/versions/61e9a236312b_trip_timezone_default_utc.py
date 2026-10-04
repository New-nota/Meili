"""trip_timezone_default_utc

Revision ID: 61e9a236312b
Revises: a6b78a4d003a
Create Date: 2026-10-04 13:00:00

Сервис больше не привязан к Калининграду: таймзона поездки ставится по
координатам города (services/places/geo.timezone_at), а поездка без
координат получает нейтральный UTC вместо чужого Europe/Kaliningrad.
Меняется только DEFAULT — существующие поездки не трогаем (все они
калининградские, и их таймзона верна).
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '61e9a236312b'
down_revision: Union[str, None] = 'a6b78a4d003a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('trips', 'timezone', server_default='UTC')


def downgrade() -> None:
    op.alter_column('trips', 'timezone', server_default='Europe/Kaliningrad')
