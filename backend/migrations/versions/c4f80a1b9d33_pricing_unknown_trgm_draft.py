"""Ревью Meili: честный дефолт цены, триграммный поиск, черновик мастера.

Три связанные правки, все — про то, чтобы ассистент оперировал фактами.

1. places.pricing_model: дефолт 'free' -> 'unknown'.
   'free' был server_default'ом, поэтому 2701 сидовое место из 2704
   утверждало, что вход бесплатный — включая рестораны и кафе. Meili честно
   пересказывал это пользователю, а estimate_stop_cost считал такие места по
   0.00, хотя правило проекта запрещает подставлять ноль вместо «не знаем».
   Переводим в 'unknown' только те 'free', у которых НЕТ ни одной цены —
   осознанно проставленный free с ценами (если появится) не трогаем.
   Заодно гасим авто-оценки, выведенные из этого вранья.

2. pg_trgm + GIN-индекс на places.name.
   search_places искал ILIKE '%вся фраза целиком%': запрос «Куршская коса»
   не находил «Музей Куршской косы» (склонение), и модель, получив пустоту,
   выдумывала места и цены. Триграммы дают устойчивость к словоформам.

3. conversations.draft_json — черновик мастера создания (S17).
   Город с координатами, даты, группа и валюта уезжали в модель текстом
   первого сообщения и терялись: поездки от ассистента выходили с city=NULL
   и валютой EUR вместо выбранной.

Revision ID: c4f80a1b9d33
Revises: a7c31d0b4e52
Create Date: 2026-08-23 18:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c4f80a1b9d33'
down_revision: Union[str, None] = 'a7c31d0b4e52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# «free без единой цены» = дефолт, который никто не проставлял руками
BOGUS_FREE = """
    pricing_model = 'free'
    AND avg_check IS NULL
    AND ticket_adult IS NULL
    AND ticket_child IS NULL
"""


def upgrade() -> None:
    # 1. цены
    op.alter_column(
        "places", "pricing_model", server_default="unknown", existing_type=sa.String(20)
    )
    # авто-оценки, посчитанные из мнимого free, больше не факт: NULL = «нет данных».
    # manual-суммы не трогаем — их ввёл пользователь (правило ТЗ-E)
    op.execute(f"""
        UPDATE trip_stops SET estimated_cost = NULL
        WHERE cost_source = 'auto'
          AND place_id IN (SELECT id FROM places WHERE {BOGUS_FREE})
    """)
    op.execute(f"UPDATE places SET pricing_model = 'unknown' WHERE {BOGUS_FREE}")

    # 2. поиск по словоформам
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_places_name_trgm "
        "ON places USING gin (name gin_trgm_ops)"
    )

    # 3. черновик мастера
    op.add_column(
        "conversations",
        sa.Column("draft_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("conversations", "draft_json")
    op.execute("DROP INDEX IF EXISTS ix_places_name_trgm")
    # расширение не сносим: им может пользоваться что-то ещё
    op.execute("UPDATE places SET pricing_model = 'free' WHERE pricing_model = 'unknown'")
    op.alter_column(
        "places", "pricing_model", server_default="free", existing_type=sa.String(20)
    )
