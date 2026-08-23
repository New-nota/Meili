"""S16 §1.6: три режима транспорта вместо costing'ов Valhalla.

Раньше в trip_stops.transport_to_next / trips.transport_default лежало
значение costing (pedestrian|auto|bicycle). Теперь там доменный режим
walking|driving|transit, а costing получается через VALHALLA_COSTING.

Велосипед из доменной модели ушёл (ТЗ фиксирует ровно три режима) —
существующие 'bicycle' переезжают в 'walking' как ближайший немоторный.
Enum хранится строкой (конвенция проекта), поэтому ALTER TYPE не нужен.

Revision ID: 58697d3f1bac
Revises: 850b4421e1e9
Create Date: 2026-08-04 16:08:53.355984

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '58697d3f1bac'
down_revision: Union[str, None] = '850b4421e1e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# старое значение -> новый режим
FORWARD = {
    "pedestrian": "walking",
    "bicycle": "walking",
    "auto": "driving",
    "multimodal": "transit",
}
# обратно: driving -> auto, transit -> multimodal (велосипед не восстановим)
BACKWARD = {"walking": "pedestrian", "driving": "auto", "transit": "multimodal"}


def _remap(mapping: dict[str, str]) -> None:
    for old, new in mapping.items():
        op.execute(
            f"UPDATE trip_stops SET transport_to_next = '{new}' "
            f"WHERE transport_to_next = '{old}'"
        )
        op.execute(
            f"UPDATE trips SET transport_default = '{new}' "
            f"WHERE transport_default = '{old}'"
        )


def upgrade() -> None:
    _remap(FORWARD)
    # всё, что не входит в три режима (мусор из старых данных) -> дефолт
    op.execute(
        "UPDATE trip_stops SET transport_to_next = 'walking' "
        "WHERE transport_to_next IS NOT NULL "
        "AND transport_to_next NOT IN ('walking', 'driving', 'transit')"
    )
    op.execute(
        "UPDATE trips SET transport_default = 'walking' "
        "WHERE transport_default IS NOT NULL "
        "AND transport_default NOT IN ('walking', 'driving', 'transit')"
    )


def downgrade() -> None:
    _remap(BACKWARD)
