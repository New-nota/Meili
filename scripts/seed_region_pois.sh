#!/usr/bin/env bash
# Сид мест (POI) региона из локального OSM — без Overpass.
#
# Берёт bbox региона из scripts/valhalla_regions.txt, вытаскивает из
# valhalla_data/regions.osm.pbf (из него же собраны тайлы) места тех же
# категорий, что у автозаполнения Meili (catalog.CATALOG_CATEGORIES), и
# грузит их в places через scripts/seed_pois.py. Идемпотентен.
#
# Запуск:  ./scripts/seed_region_pois.sh moscow
set -euo pipefail

REGION="${1:?укажи регион из scripts/valhalla_regions.txt, например moscow}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

bbox="$(awk -v r="$REGION" '$1 == r {print $3}' scripts/valhalla_regions.txt)"
[ -n "$bbox" ] || { echo "ОШИБКА: региона $REGION нет в scripts/valhalla_regions.txt" >&2; exit 1; }
IFS=, read -r s w n e <<< "$bbox"

# фильтр osmium из тех же категорий, что у автозаполнения — не разъедутся
filters="$(docker compose exec -T backend python -c '
from app.services.places.catalog import osmium_filters
print(osmium_filters())
' 2>/dev/null)"

echo "[$(date "+%F %T")] $REGION: bbox $bbox, фильтр: $filters"
docker run --rm -v "$PROJECT_DIR/valhalla_data:/d:ro" debian:bookworm-slim sh -c "
    set -e
    apt-get update -qq >/dev/null && apt-get install -y -qq osmium-tool >/dev/null 2>&1
    osmium extract -b $w,$s,$e,$n /d/regions.osm.pbf -o /tmp/region.pbf --overwrite 2>/dev/null
    osmium tags-filter /tmp/region.pbf $filters -o /tmp/pois.pbf --overwrite 2>/dev/null
    osmium export /tmp/pois.pbf -f geojsonseq --add-unique-id=type_id -o - 2>/dev/null
" | docker compose exec -T backend python -m scripts.seed_pois --bbox "$bbox"
