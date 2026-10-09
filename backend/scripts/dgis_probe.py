"""Живая проба 2ГИС (этап B): ключ работает? что реально в ответе?

Парсер services/providers/dgis.py написан по документации без живого ключа.
Этот скрипт печатает СЫРЫЕ атрибуты и то, что из них разобрал парсер, —
сверь и поправь парсер (особенно «Средний счёт» и «номер от»).

    docker compose exec backend python -m scripts.dgis_probe
    docker compose exec backend python -m scripts.dgis_probe "Хофбург" 54.7065 20.5126 restaurant
"""
import asyncio
import json
import sys

import httpx

from app.core.config import settings
from app.services.providers import dgis

# (имя, lat, lon, категория места) — категория влияет на сопоставление
SAMPLES = [
    ("Кафе Пушкин", 55.7637, 37.6046, "restaurant"),
    ("Метрополь", 55.7584, 37.6214, "hotel"),    # в здании есть и ресторан «Метрополь»
    ("Метрополь", 55.7584, 37.6214, "restaurant"),
]


async def main(samples):
    if not settings.DGIS_API_KEY:
        sys.exit("DGIS_API_KEY не задан в .env")
    async with httpx.AsyncClient(timeout=dgis.REQUEST_TIMEOUT_S) as client:
        for name, lat, lon, category in samples:
            print(f"\n=== {name} ({lat}, {lon}) [{category}]")
            items = await dgis.search_near(client, name, lat, lon)
            print(f"кандидатов: {len(items)}")
            for item in items[:3]:
                print("-", item.get("name"), item.get("point"), "reviews:", item.get("reviews"))
                for text in dgis.attribute_texts(item):
                    print("    атрибут:", text)
            match = dgis.best_match(name, lat, lon, items, category)
            if match is None:
                print("совпадения нет")
                continue
            found = dgis.parse_item(match)
            print("разобрано:", json.dumps({
                "id": found.provider_id, "rating": str(found.rating), "reviews": found.rating_count,
                "avg_check": str(found.avg_check), "lodging_from": str(found.lodging_price_from),
                "currency": found.currency, "hours": found.opening_hours,
            }, ensure_ascii=False))


if __name__ == "__main__":
    args = sys.argv[1:]
    asyncio.run(main(
        [(args[0], float(args[1]), float(args[2]), args[3] if len(args) > 3 else None)]
        if len(args) >= 3 else SAMPLES
    ))
