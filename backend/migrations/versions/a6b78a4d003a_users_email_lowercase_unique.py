"""QA: email регистронезависимый.

EmailStr приводил к нижнему регистру только домен, а unique-индекс на
users.email регистрозависимый — «QA@x.dev» и «qa@x.dev» становились двумя
аккаунтами, логин падал на другом регистре. Схемы теперь нормализуют email
в lower(); здесь — приводим уже записанные строки и ставим уникальность на
lower(email), чтобы дубль по регистру не пролез даже мимо API.

Если в базе уже есть дубли по регистру — UPDATE упадёт на старом unique
(это намеренно: склеивать чужие аккаунты автоматически нельзя, решать руками).

Revision ID: a6b78a4d003a
Revises: e8b2c5f10a47
Create Date: 2026-10-02 18:40:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a6b78a4d003a'
down_revision: Union[str, None] = 'e8b2c5f10a47'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE users SET email = lower(btrim(email)) WHERE email <> lower(btrim(email))")
    op.execute("CREATE UNIQUE INDEX ix_users_email_lower ON users (lower(email))")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_email_lower")
