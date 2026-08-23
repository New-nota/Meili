"""S16 §1.3: день становится самостоятельной сущностью.

trip_days: +title, day_index -> position (1-based), +created_at/updated_at,
уникальности становятся DEFERRABLE (реордер переставляет даты/позиции в одной
транзакции — промежуточные состояния обязаны быть разрешены).

trip_stops: +duration_is_custom, duration_minutes становится NOT NULL (60),
day_id становится NOT NULL, visit_date сносится — дата стопа теперь живёт
только на trip_days.date.

Таблица trip_days существует с S8 WP-3, поэтому вместо CREATE TABLE из ТЗ
здесь ALTER + бэкфилл висящих стопов: у кого есть visit_date без дня —
получают день (недостающие создаём), остальные удаляются.

Revision ID: 850b4421e1e9
Revises: 86f54f714bcc
Create Date: 2026-08-04 16:07:42.697487

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '850b4421e1e9'
down_revision: Union[str, None] = '86f54f714bcc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # gen_random_uuid() ниже: в PG13+ встроена, на старых — из pgcrypto
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    # --- trip_days: имя, позиция, отметки времени ---------------------------
    op.add_column('trip_days', sa.Column('title', sa.String(length=120), nullable=True))
    op.add_column('trip_days', sa.Column(
        'created_at', sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()))
    op.add_column('trip_days', sa.Column(
        'updated_at', sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()))
    op.alter_column('trip_days', 'day_index', new_column_name='position')
    # 0-based -> 1-based; констрейнт ещё не deferrable, поэтому в два прохода
    op.execute("UPDATE trip_days SET position = position + 10000")
    op.execute("UPDATE trip_days SET position = position - 9999")

    # уникальности -> DEFERRABLE INITIALLY DEFERRED (реордер §1.5)
    op.drop_constraint('uq_trip_days_trip_index', 'trip_days', type_='unique')
    op.drop_constraint('uq_trip_days_trip_date', 'trip_days', type_='unique')
    op.execute(
        "ALTER TABLE trip_days ADD CONSTRAINT uq_trip_days_trip_position "
        "UNIQUE (trip_id, position) DEFERRABLE INITIALLY DEFERRED"
    )
    op.execute(
        "ALTER TABLE trip_days ADD CONSTRAINT uq_trip_days_trip_date "
        "UNIQUE (trip_id, date) DEFERRABLE INITIALLY DEFERRED"
    )
    op.create_index('ix_trip_days_trip_id', 'trip_days', ['trip_id'])

    # --- trip_stops: длительность и флаг ручного ввода -----------------------
    op.add_column('trip_stops', sa.Column(
        'duration_is_custom', sa.Boolean(), nullable=False, server_default='false'))
    op.execute("UPDATE trip_stops SET duration_minutes = 60 WHERE duration_minutes IS NULL")
    op.alter_column('trip_stops', 'duration_minutes',
                    nullable=False, server_default='60')

    # --- бэкфилл дней для висящих стопов -------------------------------------
    # 1) привязать к уже существующему дню той же даты
    op.execute("""
        UPDATE trip_stops st
        SET day_id = d.id
        FROM trip_days d
        WHERE st.day_id IS NULL
          AND st.visit_date IS NOT NULL
          AND d.trip_id = st.trip_id
          AND d.date = st.visit_date
    """)
    # 2) для оставшихся дат дня ещё нет — создаём (позиции в хвост поездки)
    op.execute("""
        INSERT INTO trip_days (id, trip_id, date, position, title, start_time, end_time,
                               created_at, updated_at)
        SELECT
            gen_random_uuid(),
            s.trip_id,
            s.visit_date,
            COALESCE(m.max_pos, 0) + ROW_NUMBER() OVER (
                PARTITION BY s.trip_id ORDER BY s.visit_date
            ),
            NULL,
            '09:00', '21:00',
            NOW(), NOW()
        FROM (
            SELECT DISTINCT trip_id, visit_date
            FROM trip_stops
            WHERE day_id IS NULL AND visit_date IS NOT NULL
        ) s
        LEFT JOIN (
            SELECT trip_id, MAX(position) AS max_pos FROM trip_days GROUP BY trip_id
        ) m ON m.trip_id = s.trip_id
    """)
    op.execute("""
        UPDATE trip_stops st
        SET day_id = d.id
        FROM trip_days d
        WHERE st.day_id IS NULL
          AND st.visit_date IS NOT NULL
          AND d.trip_id = st.trip_id
          AND d.date = st.visit_date
    """)
    # 3) стоп без даты привязать не к чему — удаляем (ТЗ §1.3 п.6)
    op.execute("DELETE FROM trip_stops WHERE day_id IS NULL")

    op.alter_column('trip_stops', 'day_id', nullable=False)
    op.create_index('ix_trip_stops_day_id', 'trip_stops', ['day_id'])
    op.drop_column('trip_stops', 'visit_date')


def downgrade() -> None:
    # visit_date возвращается и заполняется датой дня
    op.add_column('trip_stops', sa.Column('visit_date', sa.DATE(), nullable=True))
    op.execute("""
        UPDATE trip_stops st SET visit_date = d.date
        FROM trip_days d WHERE d.id = st.day_id
    """)
    op.drop_index('ix_trip_stops_day_id', table_name='trip_stops')
    op.alter_column('trip_stops', 'day_id', nullable=True)
    op.alter_column('trip_stops', 'duration_minutes',
                    nullable=True, server_default=None)
    op.drop_column('trip_stops', 'duration_is_custom')

    op.drop_index('ix_trip_days_trip_id', table_name='trip_days')
    op.drop_constraint('uq_trip_days_trip_date', 'trip_days', type_='unique')
    op.drop_constraint('uq_trip_days_trip_position', 'trip_days', type_='unique')
    op.execute("UPDATE trip_days SET position = position + 10000")
    op.execute("UPDATE trip_days SET position = position - 10001")
    op.alter_column('trip_days', 'position', new_column_name='day_index')
    op.create_unique_constraint(
        'uq_trip_days_trip_index', 'trip_days', ['trip_id', 'day_index'])
    op.create_unique_constraint(
        'uq_trip_days_trip_date', 'trip_days', ['trip_id', 'date'])
    op.drop_column('trip_days', 'updated_at')
    op.drop_column('trip_days', 'created_at')
    op.drop_column('trip_days', 'title')
