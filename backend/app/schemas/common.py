"""QA: общие типы входных данных — одно правило вместо копий по схемам.

Фаззинг всех ручек показал, что одни и те же дыры повторялись в каждой
схеме по-своему: где-то у денег был ge=0, где-то нет; потолка Numeric(10,2)
не было нигде; PATCH пропускал явный null в NOT NULL-колонки; время с
таймзоной падало на сравнении с naive. Новые схемы берут типы отсюда.
"""
from datetime import time
from decimal import Decimal
from typing import Annotated, Any

from pydantic import AfterValidator, Field

# Деньги — Numeric(10,2) в БД (правило проекта). Без потолка 10**12 долетал
# до INSERT и падал «numeric field overflow» (500), без decimal_places «0.001»
# молча округлялся базой — юзер видел не то, что ввёл.
MONEY_MAX_DIGITS = 10
Money = Annotated[Decimal, Field(ge=0, max_digits=MONEY_MAX_DIGITS, decimal_places=2)]

# Группа поездки: без потолка adults_count=10**9 умножался на цену билета в
# авто-оценке и снова переполнял Numeric(10,2). 50 — с запасом для любой
# реальной компании/экскурсионной группы.
MAX_GROUP = 50


def _naive_time(t: time) -> time:
    return t.replace(tzinfo=None)


# Время «на стене» поездки: колонки TIME WITHOUT TIME ZONE, таймзона живёт
# в trips.timezone. Pydantic принимает «10:00+03:00» и число секунд как
# AWARE time — дальше сравнение с naive-временем дня падало TypeError (500).
WallTime = Annotated[time, AfterValidator(_naive_time)]


def not_null(v: Any) -> Any:
    """Валидатор для PATCH-схем: поле можно не прислать, но нельзя прислать
    null, если колонка NOT NULL (иначе IntegrityError на flush → 500).

    Подключать как `_nn = field_validator("a", "b")(not_null)` — field-
    валидаторы не зовутся для непереданных полей, так что «не прислал»
    по-прежнему значит «не трогать».
    """
    if v is None:
        raise ValueError("must not be null")
    return v
