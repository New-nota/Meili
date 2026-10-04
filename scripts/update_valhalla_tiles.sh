#!/usr/bin/env bash
# Сборка тайлов Valhalla под N регионов (по миру без Калининграда).
#
# Регионы — scripts/valhalla_regions.txt. Скрипт:
#   1. качает источники в valhalla_data/sources (curl -z: неизменённое не качает);
#   2. вырезает регионы с флагом cut (osmium в одноразовом контейнере) и
#      склеивает всё в один regions.osm.pbf — Valhalla не советует собирать
#      из нескольких pbf (valhalla#3925);
#   3. собирает admins + тайлы + tar в valhalla_data/.build ТЕМ ЖЕ образом,
#      что сервит (версия — из docker-compose.yml);
#   4. проверяет сборку временным valhalla_service и только потом подменяет
#      живые файлы и перезапускает valhalla — без простоя на время сборки;
#   5. печатает ROUTING_COVERAGE для docker-compose.yml.
#
# Почему не «положить pbf и рестартнуть», как было раньше: valhalla-scripted
# с use_tiles_ignore_pbf=True игнорирует новые pbf, а без него сравнивает
# хеши ИМЁН файлов, не содержимого — обновлённый экстракт с тем же именем
# не пересобирался никогда.
#
# Запуск:  ./scripts/update_valhalla_tiles.sh   (NO_RESTART=1 — без перезапуска valhalla)
# Cron (раз в месяц, 1-го числа в 04:00):
#   0 4 1 * * /path/to/fastrip/scripts/update_valhalla_tiles.sh >> /tmp/valhalla_update.log 2>&1
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGIONS_FILE="$PROJECT_DIR/scripts/valhalla_regions.txt"
DATA_DIR="$PROJECT_DIR/valhalla_data"
SRC_DIR="$DATA_DIR/sources"
STAGE="$DATA_DIR/.build"
OSMIUM_IMAGE="debian:bookworm-slim"
TEST_PORT="${TEST_PORT:-8012}"
# образ — тот же, что у сервиса valhalla в compose (тайлы и рантайм одной версии)
VALHALLA_IMAGE="$(awk '/^  valhalla:/{f=1} f && /image:/{print $2; exit}' "$PROJECT_DIR/docker-compose.yml")"

log() { echo "[$(date '+%F %T')] $*"; }

mkdir -p "$SRC_DIR"
rm -rf "$STAGE" && mkdir -p "$STAGE/regions"

# --- 1. источники ---------------------------------------------------------
coverage=""
cut_args=""      # "name@src@bbox" через пробел — для osmium (| в sh -c стал бы пайпом)
full_files=""
while read -r name url bbox flag; do
    case "$name" in ''|'#'*) continue ;; esac
    src="$SRC_DIR/$(basename "$url")"
    if ! echo "$cut_args $full_files" | grep -q "$(basename "$url")"; then
        log "Источник $url"
        # -z только для уже скачанного: 304 — пустой .part, оставляем старый файл
        since=""; [ -f "$src" ] && since="-z $src"
        curl -fLR --retry 3 --max-time 3600 -s $since -o "$src.part" "$url"
        if [ -s "$src.part" ]; then mv "$src.part" "$src"; else rm -f "$src.part"; fi
    fi
    # защита от битой загрузки: экстракт меньше 1 МБ — мусор
    [ "$(wc -c < "$src")" -gt 1048576 ] || { echo "ОШИБКА: $src подозрительно мал" >&2; exit 1; }
    IFS=, read -r s w n e <<< "$bbox"
    coverage="${coverage:+$coverage,}[$s,$w,$n,$e]"
    if [ "${flag:-}" = "cut" ]; then
        cut_args="$cut_args $name@$(basename "$src")@$w,$s,$e,$n"
    else
        full_files="$full_files $(basename "$src")"
    fi
done < "$REGIONS_FILE"

# --- 2. вырезка и склейка -------------------------------------------------
log "Вырезаю и склеиваю регионы (osmium)"
docker run --rm -v "$SRC_DIR:/src:ro" -v "$STAGE:/out" "$OSMIUM_IMAGE" sh -c "
    set -e
    apt-get update -qq >/dev/null && apt-get install -y -qq osmium-tool >/dev/null 2>&1
    parts=''
    for spec in $cut_args; do
        name=\${spec%%@*}; rest=\${spec#*@}; file=\${rest%%@*}; bb=\${rest#*@}
        osmium extract --strategy complete_ways -b \$bb /src/\$file -o /out/regions/\$name.osm.pbf --overwrite
        parts=\"\$parts /out/regions/\$name.osm.pbf\"
    done
    for file in $full_files; do parts=\"\$parts /src/\$file\"; done
    osmium merge \$parts -o /out/regions.osm.pbf --overwrite
"
rm -rf "$STAGE/regions"

# --- 3. сборка ------------------------------------------------------------
# Свежий клон: valhalla_data ещё пуст — конфиг, базу таймзон и скорости по
# умолчанию делаем сами тем же образом (раньше их создавал первый старт
# контейнера, и скрипт на чистой машине падал на cp). Контейнер при старте
# всё равно допишет в конфиг свои пути и число потоков.
if [ ! -f "$DATA_DIR/valhalla.json" ]; then
    log "Создаю valhalla.json"
    docker run --rm -v "$DATA_DIR:/custom_files" --entrypoint sh "$VALHALLA_IMAGE" -c '
        valhalla_build_config \
            --mjolnir-tile-dir /custom_files/valhalla_tiles \
            --mjolnir-tile-extract /custom_files/valhalla_tiles.tar \
            --mjolnir-admin /custom_files/admins.sqlite \
            --mjolnir-timezone /custom_files/timezones.sqlite > /tmp/c.json &&
        jq ".mjolnir.default_speeds_config = \"/custom_files/default_speeds.json\"" /tmp/c.json \
            > /custom_files/valhalla.json'
fi
if [ ! -f "$DATA_DIR/timezones.sqlite" ]; then
    log "Строю базу таймзон (качает границы поясов, ~1–2 мин)"
    docker run --rm -v "$DATA_DIR:/custom_files" --entrypoint sh "$VALHALLA_IMAGE" -c \
        'valhalla_build_timezones > /custom_files/timezones.sqlite'
fi
if [ ! -f "$DATA_DIR/default_speeds.json" ]; then
    curl -fsSL --retry 3 -o "$DATA_DIR/default_speeds.json" \
        https://raw.githubusercontent.com/OpenStreetMapSpeeds/schema/master/default_speeds.json
fi
cp "$DATA_DIR/valhalla.json" "$DATA_DIR/timezones.sqlite" "$DATA_DIR/default_speeds.json" "$STAGE/"
log "Собираю тайлы ($VALHALLA_IMAGE)"
docker run --rm -v "$STAGE:/custom_files" --entrypoint sh "$VALHALLA_IMAGE" -c '
    set -e
    valhalla_build_admins --config /custom_files/valhalla.json /custom_files/regions.osm.pbf > /custom_files/build.log 2>&1
    valhalla_build_tiles -c /custom_files/valhalla.json /custom_files/regions.osm.pbf >> /custom_files/build.log 2>&1
    valhalla_build_extract -c /custom_files/valhalla.json -v >> /custom_files/build.log 2>&1
'

# --- 4. проверка и подмена -------------------------------------------------
log "Проверяю сборку временным сервисом на :$TEST_PORT"
docker rm -f valhalla-tiles-check >/dev/null 2>&1 || true
docker run -d --name valhalla-tiles-check -p "$TEST_PORT:8002" -v "$STAGE:/custom_files" \
    --entrypoint valhalla_service "$VALHALLA_IMAGE" /custom_files/valhalla.json 1 >/dev/null
ok=""
for _ in $(seq 1 60); do
    curl -sf "localhost:$TEST_PORT/status" >/dev/null && { ok=1; break; }
    sleep 1
done
docker rm -f valhalla-tiles-check >/dev/null
[ -n "$ok" ] || { echo "ОШИБКА: новые тайлы не поднялись, живые не трогаю (лог: $STAGE/build.log)" >&2; exit 1; }

log "Подменяю живые тайлы"
# в корне valhalla_data ровно один pbf: при пересборке образ берёт ВСЕ *.pbf оттуда
# (старые одиночные экстракты уезжают в sources, но свежий одноимённый там не затираем)
for f in "$DATA_DIR"/*.pbf; do
    [ -e "$f" ] && [ "$(basename "$f")" != regions.osm.pbf ] || continue
    if [ -e "$SRC_DIR/$(basename "$f")" ]; then rm -f "$f"; else mv "$f" "$SRC_DIR/"; fi
done
mv -f "$STAGE/regions.osm.pbf" "$STAGE/valhalla_tiles.tar" "$STAGE/admins.sqlite" "$DATA_DIR/"
rm -rf "$DATA_DIR/valhalla_tiles" && mv "$STAGE/valhalla_tiles" "$DATA_DIR/valhalla_tiles"
# образ хеширует ИМЯ файла — фиксируем, что regions.osm.pbf уже собран
printf '%s' /custom_files/regions.osm.pbf | shasum -a 256 | cut -d' ' -f1 > "$DATA_DIR/file_hashes.txt"
mv -f "$STAGE/build.log" "$DATA_DIR/last_build.log"
rm -rf "$STAGE"

cd "$PROJECT_DIR"
if [ -z "${NO_RESTART:-}" ]; then
    docker compose up -d valhalla   # up, а не restart: подхватит и смену версии образа
fi
log "Готово. Покрытие для docker-compose.yml (backend и worker):"
echo "      - ROUTING_COVERAGE=[$coverage]"
grep -qF "ROUTING_COVERAGE=[$coverage]" docker-compose.yml \
    || echo "ВНИМАНИЕ: в docker-compose.yml другое покрытие — поправь и сделай docker compose up -d backend worker" >&2
