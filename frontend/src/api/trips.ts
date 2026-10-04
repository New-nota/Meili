import type { Stop, TransportMode, Trip } from '../types/index'
import type { TripDay } from './days'
import { apiFetch, API_URL, getAccessToken, getRequestLanguage } from "./client"






export const getStops = async (tripId: string): Promise<Stop[]> =>
    apiFetch<Stop[]>(`/trips/${tripId}/stops`)

// S16 §1.6: маршрут дня по перегонам — у каждого свой транспорт и геометрия
export interface RouteLeg {
    from_stop_id: string | null   // null = старт из точки отправления дня
    to_stop_id: string | null     // null = финиш
    duration_seconds: number
    distance_meters: number
    costing: TransportMode
    geometry: string              // encoded polyline
}

export interface DayRoute {
    day_id: string
    legs: RouteLeg[]
    total_duration_seconds: number
    total_distance_meters: number
}

export const getDayRoute = (tripId: string, dayId: string) =>
    apiFetch<DayRoute>(`/trips/${tripId}/route?day_id=${dayId}`)

type RouteDay = Pick<TripDay, 'id' | 'start_location' | 'end_location' | 'stops'>

/** Ключ кэша маршрута дня — от его состава: добавили/убрали/переставили
 *  точку или сменили транспорт → новый маршрут. Общий для карты
 *  (TripPlanner) и панели дня (DayPlan). Ревью (прод-сборка): открытие
 *  планировщика слало /route 4 раза — эффект карты перезапускался на каждое
 *  обновление состояния, а панель запрашивала тот же маршрут отдельно. */
export const dayRouteKey = (tripId: string, day: RouteDay) => [
    'dayRoute', tripId, day.id,
    [day.start_location?.id, day.end_location?.id,
        ...day.stops.filter(s => s.included_in_route).map(s => `${s.id}:${s.position}:${s.transport_to_next}`),
    ].join('|'),
]

/** Тот же состав — тот же маршрут (Valhalla детерминирована): кэш не протухает. */
export const dayRouteQuery = (tripId: string, day: RouteDay) => ({
    queryKey: dayRouteKey(tripId, day),
    queryFn: () => getDayRoute(tripId, day.id),
    staleTime: Infinity,
    retry: false,
})

/** Координаты всей линии дня — склейка геометрии перегонов. */
export const legsToCoordinates = (legs: RouteLeg[]): number[][] =>
    legs.flatMap(leg => decodePolyline(leg.geometry))

// S16: маршрут строится только через GET /trips/{id}/route (перегоны с
// собственным costing) — прокси-хелперов по произвольным точкам больше нет.

function decodePolyline(encoded: string, precision = 6): number[][] {
    const factor = Math.pow(10, precision)
    const coords: number[][] = []
    let index = 0
    let lat = 0
    let lng = 0
    while (index < encoded.length) {
        let shift = 0
        let result = 0
        let byte: number
        do {
            byte = encoded.charCodeAt(index++) - 63
            result |= (byte & 0x1f) << shift
            shift += 5
        } while (byte >= 0x20)
        lat += (result & 1) ? ~(result >> 1) : result >> 1
        shift = 0
        result = 0
        do {
            byte = encoded.charCodeAt(index++) - 63
            result |= (byte & 0x1f) << shift
            shift += 5
        } while (byte >= 0x20)
        lng += (result & 1) ? ~(result >> 1) : result >> 1
        coords.push([lng / factor, lat / factor])
    }
    return coords
}

export async function reorderStops(tripId: string, stopIds: string[]): Promise<void> {
     await apiFetch(`/trips/${tripId}/stops/reorder`, {
        method: 'POST',
        body: JSON.stringify({stop_ids: stopIds})
    })
}

export async function updateStop(tripId: string, stopId: string, data: Record<string, unknown>): Promise<Stop> {
    return apiFetch<Stop>(`/trips/${tripId}/stops/${stopId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    })
}

export async function updateStopTransport(tripId: string, stopId: string, transport: string): Promise<void> {
    await updateStop(tripId, stopId, {transport_to_next: transport})
}

// S16 §1.4: карточка поездки — дни с вложенными остановками
export interface TripDetail extends Trip {
    days: TripDay[]
}

export async function getTrip(tripId:string): Promise<TripDetail> {
    return apiFetch<TripDetail>(`/trips/${tripId}`)
}

export async function updateTrip(tripId: string, data: Record<string, unknown>): Promise<Trip> {
    return apiFetch<Trip>(`/trips/${tripId}`,
        {
            method: 'PUT',
            body: JSON.stringify(data)
        }
    )
}

export async function cloneTrip(tripId:string): Promise<Trip> {
    return apiFetch<Trip>(`/trips/${tripId}/clone`, {
        method: 'POST'})
}

// S13: лайк/анлайк чужой публичной поездки (превью)
export async function likeTrip(tripId: string): Promise<void> {
    await apiFetch(`/trips/${tripId}/like`, { method: 'POST' })
}
export async function unlikeTrip(tripId: string): Promise<void> {
    await apiFetch(`/trips/${tripId}/like`, { method: 'DELETE' })
}
// S9 WP-B: скачать экспорт (PDF/ICS) как файл
export async function downloadExport(tripId: string, kind: 'pdf' | 'ics'): Promise<void> {
    const headers: Record<string, string> = {}
    const token = getAccessToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    const lng = getRequestLanguage()
    if (lng) headers['Accept-Language'] = lng  // PDF/.ics — на языке интерфейса
    const res = await fetch(`${API_URL}/trips/${tripId}/export/${kind}`, {
        headers, credentials: 'include',
    })
    if (!res.ok) throw new Error('export_failed')
    const blob = await res.blob()
    const disposition = res.headers.get('Content-Disposition') ?? ''
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
    const filename = match ? decodeURIComponent(match[1]) : `trip.${kind}`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
}
