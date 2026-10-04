// QA: единый поиск по геокодеру (Nominatim). Мастер, поиск мест и выбор
// старта/финиша дня ходили в Nominatim каждый по-своему, никто не проверял
// res.ok и не отменял устаревшие запросы.
// По миру (без Калининграда): раньше всё искалось в bbox области с
// bounded=1 — Париж просто не находился. Теперь поиск глобальный, а внутри
// поездки — сначала в округе её города («собор» в Париже — парижский, а не
// Шартр), и только если там пусто — по всему миру.
// Сырой fetch без наших credentials — это сторонний сервис (см. api/client).

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
    address?: Record<string, string>
}

export interface LatLon { lat: number; lon: number }

// «округа города поездки»: ~80 км в каждую сторону — область, а не квартал
const AREA_KM = 80

/** viewbox Nominatim (minLon,maxLat,maxLon,minLat) вокруг точки. */
export function viewboxAround({ lat, lon }: LatLon, km = AREA_KM): string {
    const dLat = km / 111
    const dLon = km / (111 * Math.max(Math.cos(lat * Math.PI / 180), 0.01))
    const f = (n: number) => n.toFixed(4)
    return [f(lon - dLon), f(lat + dLat), f(lon + dLon), f(lat - dLat)].join(',')
}

async function nominatim(params: URLSearchParams, signal?: AbortSignal): Promise<GeocodeHit[]> {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal })
    if (!res.ok) throw new Error(`nominatim ${res.status}`)
    const data = await res.json()
    return Array.isArray(data) ? data : []
}

/** Поиск адреса/места. near — центр поездки: сначала ищем в его округе.
 *  Бросает на сетевой ошибке/не-2xx (AbortError — при отмене). */
export async function geocode(
    query: string,
    opts: {
        lang: string; limit?: number; signal?: AbortSignal; addressDetails?: boolean
        near?: LatLon | null; featureType?: 'settlement'
    },
): Promise<GeocodeHit[]> {
    const params = new URLSearchParams({
        q: query.trim(),
        format: 'json',
        limit: String(opts.limit ?? 5),
        'accept-language': opts.lang,
    })
    if (opts.addressDetails) params.set('addressdetails', '1')
    if (opts.featureType) params.set('featureType', opts.featureType)
    if (opts.near) {
        const local = new URLSearchParams(params)
        local.set('viewbox', viewboxAround(opts.near))
        local.set('bounded', '1')
        const hits = await nominatim(local, opts.signal)
        if (hits.length) return hits
        // в округе пусто — поездка бывает и по нескольким городам
    }
    return nominatim(params, opts.signal)
}

/** Покрытие маршрутизатора: [south, west, north, east][], пусто — весь мир. */
export type Coverage = [number, number, number, number][]

export const inCoverage = (coverage: Coverage | undefined, lat: number, lon: number) =>
    !coverage?.length || coverage.some(([s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e)

/** «Регион, Страна» для подсказки — чтобы Paris (Франция) не путался с Paris (Техас). */
export function placeContext(hit: GeocodeHit): string {
    const a = hit.address ?? {}
    const region = a.state ?? a.region ?? a.county
    return [region, a.country].filter(Boolean).join(', ')
}

export const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError'
