"""Перепроставить city у уже засиженных мест по их координатам (ревью).

Сид тянул POI по bbox всей области, но подписывал их одной константой
«Калининград». Из-за этого зеленоградские заведения искались как
калининградские, а Meili отвечал «в Зеленоградске ничего не нашлось» про
места, которые там и стоят.

Скрипт идемпотентен: считает город из геометрии и пишет только когда он
реально другой. Места, созданные пользователями руками (created_by IS NOT
NULL), не трогаем — там город ввёл человек.

Запуск:  docker compose exec backend python -m scripts.fix_place_cities
         docker compose exec backend python -m scripts.fix_place_cities --dry-run
"""
import asyncio
import sys
from collections import Counter

from geoalchemy2.shape import to_shape
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.place import Place
from scripts.kaliningrad import in_oblast, nearest_city


async def main(dry_run: bool = False) -> None:
    async with AsyncSessionLocal() as db:
        places = (await db.execute(
            select(Place).where(
                Place.location.isnot(None), Place.created_by.is_(None)
            )
        )).scalars().all()

        changes: Counter = Counter()
        updated = 0
        for place in places:
            point = to_shape(place.location)
            # справочник знает только область: места других городов (их
            # подтягивает Meili, services/places/catalog.py) не трогаем —
            # иначе nearest_city стёр бы им город в None
            if not in_oblast(point.y, point.x):
                continue
            city = nearest_city(point.y, point.x)
            if city == place.city:
                continue
            changes[f"{place.city or '—'} -> {city or '—'}"] += 1
            updated += 1
            if not dry_run:
                place.city = city

        if not dry_run:
            await db.commit()

        print(f"мест просмотрено: {len(places)}, обновлено: {updated}"
              + (" (dry-run, ничего не записано)" if dry_run else ""))
        for change, count in changes.most_common(20):
            print(f"  {change}: {count}")


if __name__ == "__main__":
    asyncio.run(main(dry_run="--dry-run" in sys.argv))
