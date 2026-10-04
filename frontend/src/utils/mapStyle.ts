// Стиль карты Hermod — «Лес» (редизайн 2026-10; было S10 «бумага»).
// ЕДИНСТВЕННОЕ место (кроме tokens.css), где живут хекс-литералы:
// WebGL-стиль MapLibre не читает CSS-переменные, значения зеркалят токены --map-*.
import type { Map as MapLibreMap } from 'maplibre-gl'

const LAND = '#F4EEE2'
const WATER = '#C2D5D0'
const WATER_LINE = '#AFC6C0'
const GREEN = '#D3DEC3'
const BUILDING = '#EBE1CF'
const BUILDING_LINE = '#DDCFB6'
const ROAD = '#FFFDF8'
const ROAD_CASING = '#DCCBAE'
const RAIL = '#BFAF92'
const LABEL = '#5F6F64'
const WATER_LABEL = '#4D716B'

/** Маршрут и метки на карте — дерево (--wood); интерфейс при этом зелёный. */
export const ROUTE_HEX = '#8F6236'
/** Светлая «обводка» под линией маршрута — чтобы читалась поверх дорог (--raised). */
export const ROUTE_CASING_HEX = '#FFFDF8'

const GREEN_RE = /park|green|wood|grass|forest|landcover|vegetation|meadow|golf|scrub|wetland/i
const WATER_RE = /water|ocean|river|lake|waterway/i

/** Перекрасить загруженный векторный стиль в тихую тёплую карту.
 *  Насыщенным остаётся только маршрут пользователя и его метки. */
export function applyMapStyle(map: MapLibreMap) {
    for (const layer of map.getStyle().layers ?? []) {
        const id = layer.id
        try {
            if (layer.type === 'background') {
                map.setPaintProperty(id, 'background-color', LAND)
            } else if (layer.type === 'fill') {
                if (WATER_RE.test(id)) {
                    map.setPaintProperty(id, 'fill-color', WATER)
                } else if (/building/.test(id)) {
                    map.setPaintProperty(id, 'fill-color', BUILDING)
                    map.setPaintProperty(id, 'fill-outline-color', BUILDING_LINE)
                } else if (GREEN_RE.test(id)) {
                    map.setPaintProperty(id, 'fill-color', GREEN)
                } else {
                    map.setPaintProperty(id, 'fill-color', LAND)
                    map.setPaintProperty(id, 'fill-outline-color', LAND)
                }
            } else if (layer.type === 'line') {
                if (WATER_RE.test(id)) map.setPaintProperty(id, 'line-color', WATER_LINE)
                else if (/rail|transit/.test(id)) map.setPaintProperty(id, 'line-color', RAIL)
                else if (/casing|outline|boundary|admin/.test(id)) map.setPaintProperty(id, 'line-color', ROAD_CASING)
                else map.setPaintProperty(id, 'line-color', ROAD)
            } else if (layer.type === 'symbol') {
                const water = WATER_RE.test(id)
                map.setPaintProperty(id, 'text-color', water ? WATER_LABEL : LABEL)
                map.setPaintProperty(id, 'text-halo-color', water ? WATER : LAND)
                map.setPaintProperty(id, 'icon-opacity', 0.3)
            } else if (layer.type === 'fill-extrusion') {
                map.setLayoutProperty(id, 'visibility', 'none')
            }
        } catch {
            // у части слоёв нет данного paint-свойства — пропускаем
        }
    }
}

/** Палитра дней для режима «Все дни» — литералы токенов --day-1…12
 *  (линии — WebGL, переменные недоступны). Открытый день всегда рисуется
 *  деревом; в обзоре дни надо различать, поэтому первый — тоже дерево, дальше
 *  природные тона (фьорд, брусника, морошка…), 12 штук, дальше цикл. */
export const DAY_HEX = [
    '#8F6236', '#3F6F8C', '#A8384A', '#C98A2B', '#3D7550', '#7A5C8E',
    '#6B7F3A', '#B0603A', '#2F7F7A', '#8A7A5A', '#4F5F9A', '#9A4F6A',
] as const
