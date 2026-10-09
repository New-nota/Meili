"""places: обогащение из 2ГИС (этап B)

Revision ID: 9b2d4e7a1c05
Revises: 33da5e8b47d6
Create Date: 2026-10-09 18:00:00

Этап B (meili_2gis): места из OSM обогащаются ценами и рейтингом 2ГИС.
- dgis_id — id объекта 2ГИС (partial unique, как osm_id);
- rating_count — рейтинг без числа отзывов ничего не значит;
- price_source — откуда цена места: osm (fee=no) | 2gis | manual. 2ГИС не
  перезаписывает manual. Уже проставленные руками цены (avg_check/билеты)
  помечаем manual, чтобы первое же обогащение их не затёрло;
- enriched_at — когда последний раз спрашивали 2ГИС (обновляем раз в 30 дней);
- lodging_price_from — «номер от N» у жилья: ориентир для показа, в бюджет
  не пишется (нижняя граница — не цена).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = '9b2d4e7a1c05'
down_revision: Union[str, None] = '33da5e8b47d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("places", sa.Column("dgis_id", sa.String(), nullable=True))
    op.add_column("places", sa.Column("rating_count", sa.Integer(), nullable=True))
    op.add_column("places", sa.Column("price_source", sa.String(length=10), nullable=True))
    op.add_column("places", sa.Column("enriched_at", sa.TIMESTAMP(), nullable=True))
    op.add_column("places", sa.Column("lodging_price_from", sa.Numeric(10, 2), nullable=True))
    op.create_index(
        "uq_places_dgis_id", "places", ["dgis_id"], unique=True,
        postgresql_where=sa.text("dgis_id IS NOT NULL"),
    )
    op.execute(
        "UPDATE places SET price_source = 'manual' "
        "WHERE avg_check IS NOT NULL OR ticket_adult IS NOT NULL"
    )
    op.execute(
        "UPDATE places SET price_source = 'osm' "
        "WHERE price_source IS NULL AND pricing_model = 'free'"
    )


def downgrade() -> None:
    op.drop_index("uq_places_dgis_id", table_name="places")
    op.drop_column("places", "lodging_price_from")
    op.drop_column("places", "enriched_at")
    op.drop_column("places", "price_source")
    op.drop_column("places", "rating_count")
    op.drop_column("places", "dgis_id")
