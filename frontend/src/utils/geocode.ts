// QA: единый поиск по геокодеру (Nominatim) в границах региона MVP.
// Мастер, поиск мест и выбор старта/финиша дня ходили в Nominatim каждый
// по-своему: двое из трёх искали по всему миру (отель в Париже → «день вне
// покрытия карт»), никто не проверял res.ok и не отменял устаревшие запросы.
// Сырой fetch без наших credentials — это сторонний сервис (см. api/client).

// bbox Калининградской области: minLon, maxLat, maxLon, minLat (формат viewbox)
export const OBLAST_VIEWBOX = '19.6,55.3,22.9,54.3'

export interface GeocodeHit {
    place_id: number
    display_name: string
    name?: string
    lat: string
    lon: string
    osm_type?: string
    osm_id?: number
    class?: string
    addresstype?: string
}

/** Поиск в границах области. Бросает на сетевой ошибке/не-2xx (AbortError — при отмене). */
export async function geocodeOblast(
    query: string,
    opts: { lang: string; limit?: number; signal?: AbortSignal; addressDetails?: boolean },
): Promise<GeocodeHit[]> {
    const params = new URLSearchParams({
        q: query.trim(),
        format: 'json',
        limit: String(opts.limit ?? 5),
        viewbox: OBLAST_VIEWBOX,
        bounded: '1',
        'accept-language': opts.lang,
    })
    if (opts.addressDetails) params.set('addressdetails', '1')
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal: opts.signal })
    if (!res.ok) throw new Error(`nominatim ${res.status}`)
    const data = await res.json()
    return Array.isArray(data) ? data : []
}

// зона тайлов Valhalla — тот же прямоугольник, что REGION_BBOX на бэке
// (services/places/geo.py): south, west, north, east
const REGION = { south: 54.30, west: 19.60, north: 55.35, east: 23.05 }
export const inRegion = (lat: number, lon: number) =>
    lat >= REGION.south && lat <= REGION.north && lon >= REGION.west && lon <= REGION.east

export const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError'
