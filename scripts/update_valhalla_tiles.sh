#!/usr/bin/env bash
# Обновление OSM-тайлов Valhalla (Спринт 7).
#
# Скачивает свежий экстракт Калининграда с Geofabrik, подменяет pbf и
# перезапускает контейнер valhalla — образ valhalla-scripted сравнивает
# хеши (file_hashes.txt) и сам пересобирает тайлы при изменении файла.
#
# Запуск вручную:   ./scripts/update_valhalla_tiles.sh
# Cron (раз в месяц, 1-го числа в 04:00):
#   0 4 1 * * /path/to/wanderown/scripts/update_valhalla_tiles.sh >> /tmp/valhalla_update.log 2>&1
set -euo pipefail

REGION_URL="${REGION_URL:-https://download.geofabrik.de/russia/kaliningrad-latest.osm.pbf}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$PROJECT_DIR/valhalla_data"
PBF_NAME="$(basename "$REGION_URL")"
TMP_FILE="$(mktemp "/tmp/${PBF_NAME}.XXXXXX")"

echo "[$(date '+%F %T')] Скачиваю $REGION_URL ..."
curl -fL --retry 3 --max-time 600 -o "$TMP_FILE" "$REGION_URL"

# защита от битой загрузки: pbf Калининграда ~25-30 МБ, всё меньше 5 МБ — мусор
MIN_SIZE=$((5 * 1024 * 1024))
ACTUAL_SIZE=$(wc -c < "$TMP_FILE")
if [ "$ACTUAL_SIZE" -lt "$MIN_SIZE" ]; then
    echo "ОШИБКА: скачанный файл подозрительно мал ($ACTUAL_SIZE байт), отмена" >&2
    rm -f "$TMP_FILE"
    exit 1
fi

# если файл не изменился с прошлого раза — ничего не делаем
if [ -f "$DATA_DIR/$PBF_NAME" ] && cmp -s "$TMP_FILE" "$DATA_DIR/$PBF_NAME"; then
    echo "[$(date '+%F %T')] Экстракт не изменился, пересборка не нужна"
    rm -f "$TMP_FILE"
    exit 0
fi

echo "[$(date '+%F %T')] Обновляю $DATA_DIR/$PBF_NAME ($ACTUAL_SIZE байт)"
mv "$TMP_FILE" "$DATA_DIR/$PBF_NAME"

echo "[$(date '+%F %T')] Перезапускаю valhalla (тайлы пересоберутся автоматически)"
cd "$PROJECT_DIR"
docker compose restart valhalla

echo "[$(date '+%F %T')] Готово. Прогресс пересборки: docker compose logs -f valhalla"
