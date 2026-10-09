"""Сид POI региона из локального OSM (osmium export → stdin), без Overpass.

Почему не Overpass: живой прогон по Москве — публичный Overpass отбивал
запрос по агломерации 504 (перегрузка), зеркала не отвечали вовсе. А весь
OSM региона у нас и так лежит в valhalla_data/regions.osm.pbf (из него
собраны тайлы) — места берём оттуда: быстро, полно и консистентно с
маршрутами. Автозаполнение через Overpass (catalog.ensure_city_catalog)
остаётся для городов без своих карт.

Запуск — через обёртку на хосте (она готовит GeoJSONSeq из pbf):
    ./scripts/seed_region_pois.sh moscow
Напрямую:
    <geojsonseq> | docker compose exec -T backend python -m scripts.seed_pois \\
        --bbox 55.35,36.95,56.05,38.15

Идемпотентен: get-or-create по osm_id (общий add_pois с автозаполнением);
повторный прогон дописывает известным местам пустые часы/теги.
"""
import argparse
import asyncio
import json
import sys

from shapely.geometry import shape

from app.core.database import AsyncSessionLocal
from app.services.places.catalog import _category_of, add_pois, poi_extras

BATCH = 2000
OSM_TYPES = {"n": "node", "w": "way", "r": "relation", "a": "area"}


def feature_to_poi(feature: dict, bbox: tuple[float, float, float, float]) -> dict | None:
    """Фича osmium export (-a type_id) → место для add_pois или None."""
    props = feature.get("properties") or {}
    name = props.get("name") or props.get("name:ru") or props.get("name:en")
    category = _category_of(props)
    raw_id = feature.get("id") or props.get("@id") or ""
    if not name or not category or len(raw_id) < 2 or raw_id[0] not in OSM_TYPES:
        return None
    try:
        # representative_point лежит внутри полигона (у парка-подковы
        # центроид мог бы оказаться снаружи)
        point = shape(feature["geometry"]).representative_point()
    except (KeyError, ValueError, TypeError):
        return None
    south, west, north, east = bbox
    if not (south <= point.y <= north and west <= point.x <= east):
        return None
    street = " ".join(filter(None, [props.get("addr:street"), props.get("addr:housenumber")]))
    return {
        "osm_id": f"{OSM_TYPES[raw_id[0]]}/{raw_id[1:]}",
        "name": name,
        "category": category,
        "lat": point.y,
        "lon": point.x,
        "address": street or None,
        # нет addr:city — без города (поиск Meili найдёт по радиусу), а не
        # «Москва» всем подряд: так когда-то мытищинское стало бы московским
        "city": props.get("addr:city"),
        # часы, «бесплатно», подтип/звёзды/кухня (meili_upgrade)
        **poi_extras(props),
    }


async def main(bbox: tuple[float, float, float, float]) -> None:
    seen, added, skipped, batch = 0, 0, 0, []
    async with AsyncSessionLocal() as db:
        for line in sys.stdin:
            line = line.strip().lstrip("\x1e")  # RFC 8142: разделитель записей
            if not line:
                continue
            seen += 1
            poi = feature_to_poi(json.loads(line), bbox)
            if poi is None:
                skipped += 1
                continue
            batch.append(poi)
            if len(batch) >= BATCH:
                added += await add_pois(db, batch, None)
                await db.commit()
                batch = []
        if batch:
            added += await add_pois(db, batch, None)
            await db.commit()
    print(f"фич: {seen}, добавлено мест: {added}, отброшено (без имени/категории/вне bbox): {skipped}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--bbox", required=True, help="south,west,north,east")
    args = parser.parse_args()
    asyncio.run(main(tuple(float(v) for v in args.bbox.split(","))))
