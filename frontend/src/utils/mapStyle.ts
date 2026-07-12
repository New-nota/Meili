// Бумажный стиль карты Meili (S10, ТЗ задача 4).
// ЕДИНСТВЕННОЕ место (кроме tokens.css), где живут хекс-литералы:
// WebGL-стиль MapLibre не читает CSS-переменные, значения зеркалят токены --map-*.
import type { Map as MapLibreMap } from 'maplibre-gl'

const LAND = '#E7E2D0'
const WATER = '#C4C9BE'
const ROAD = '#D8D2BE'
const GREEN = '#B7BDA0'
const LABEL = '#6B6459'

const GREEN_RE = /park|green|wood|grass|forest|landcover|vegetation|meadow|golf/i
const WATER_RE = /water|ocean|river|lake|waterway/i

/** Перекрасить загруженный векторный стиль в приглушённую «бумагу».
 *  На карте насыщенным остаётся только маршрут пользователя и его маркеры. */
export function applyPaperStyle(map: MapLibreMap) {
    for (const layer of map.getStyle().layers ?? []) {
        const id = layer.id
        try {
            if (layer.type === 'background') {
                map.setPaintProperty(id, 'background-color', LAND)
            } else if (layer.type === 'fill') {
                if (WATER_RE.test(id)) {
                    map.setPaintProperty(id, 'fill-color', WATER)
                } else if (GREEN_RE.test(id)) {
                    map.setPaintProperty(id, 'fill-color', GREEN)
                } else {
                    map.setPaintProperty(id, 'fill-color', LAND)
                    map.setPaintProperty(id, 'fill-outline-color', ROAD)
                }
            } else if (layer.type === 'line') {
                map.setPaintProperty(id, 'line-color', WATER_RE.test(id) ? WATER : ROAD)
            } else if (layer.type === 'symbol') {
                map.setPaintProperty(id, 'text-color', LABEL)
                map.setPaintProperty(id, 'text-halo-color', LAND)
                map.setPaintProperty(id, 'icon-opacity', 0.35)
            } else if (layer.type === 'fill-extrusion') {
                map.setPaintProperty(id, 'fill-extrusion-color', ROAD)
            }
        } catch {
            // у части слоёв нет данного paint-свойства — пропускаем
        }
    }
}

/** Палитра дней для режима «Все дни» — литералы токенов --day-1…6
 *  (линии — WebGL, переменные недоступны). */
export const DAY_HEX = [
    '#C69A4B', '#8E8B57', '#B0714A', '#CBB88C', '#9DA986', '#A9603F',
] as const
