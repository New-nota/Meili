"""Ревью: trip_likes.* -> ON DELETE CASCADE.

DELETE /trips/{id} падал 500-кой, как только поездку кто-то лайкнул: FK
trip_likes.trip_id был без ondelete, и удаление владельцем упиралось в
чужую строку лайка. Симптом бил именно по публичным маршрутам — их лайкают.

Лайк не имеет смысла без поездки (и без пользователя), поэтому каскад, а не
SET NULL: колонки входят в составной первичный ключ и NULL в них невозможен.

Revision ID: a7c31d0b4e52
Revises: 58697d3f1bac
Create Date: 2026-08-23 17:20:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a7c31d0b4e52'
down_revision: Union[str, None] = '58697d3f1bac'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (имя констрейнта, колонка, целевая таблица)
FKS = (
    ("trip_likes_trip_id_fkey", "trip_id", "trips"),
    ("trip_likes_user_id_fkey", "user_id", "users"),
)


def upgrade() -> None:
    for name, column, target in FKS:
        op.drop_constraint(name, "trip_likes", type_="foreignkey")
        op.create_foreign_key(
            name, "trip_likes", target, [column], ["id"], ondelete="CASCADE"
        )


def downgrade() -> None:
    for name, column, target in FKS:
        op.drop_constraint(name, "trip_likes", type_="foreignkey")
        op.create_foreign_key(name, "trip_likes", target, [column], ["id"])
