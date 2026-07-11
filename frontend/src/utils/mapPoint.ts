// Утилиты карточки точки на карте (S9 WP-E). Чистые функции — покрыты vitest.

export interface NominatimReverseResult {
    name?: string
    display_name?: string
    class?: string
    osm_type?: string
    osm_id?: number
    namedetails?: { name?: string } | null
    address?: Record<string, string>
}

export interface ClickedPoint {
    lat: number
    lng: number
    label: string
    address: string | null
    osmId: string | null
}

// именованный POI показываем по названию, а не разложенным адресом
const POI_CLASSES = new Set(['tourism', 'historic', 'amenity', 'leisure', 'shop'])

/** Метка точки: POI — по имени; адрес — в порядке «улица дом» (+ город). */
export function formatPlaceLabel(
    r: NominatimReverseResult, lat?: number, lng?: number,
): string {
    const poiName =
        r.namedetails?.name ||
        (POI_CLASSES.has(r.class ?? '') ? r.name : undefined)
    if (poiName) return poiName

    const a = r.address ?? {}
    const city = a.city || a.town || a.village || ''
    if (a.road) {
        // «Римская улица 3а», не «3а, Римская улица»
        const street = a.house_number ? `${a.road} ${a.house_number}` : a.road
        return city ? `${street}, ${city}` : street
    }
    // нет улицы: первый значимый компонент адреса
    const significant = a.suburb || a.neighbourhood || a.hamlet || city
    if (significant) return significant
    if (r.display_name) return r.display_name.split(',')[0]
    // совсем пусто — координаты
    return lat !== undefined && lng !== undefined
        ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
        : ''
}

/** Toggle как в Google Maps: клик при открытой карточке закрывает её
 *  (новый пин НЕ ставится), при закрытой — открывает новую. */
export function nextClickedPoint(
    prev: ClickedPoint | null, incoming: ClickedPoint,
): ClickedPoint | null {
    return prev !== null ? null : incoming
}
