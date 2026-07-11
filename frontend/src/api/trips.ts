import type { Stop, Trip } from '../types/index'
import { apiFetch, API_URL, getAccessToken } from "./client"






export const getStops = async (tripId: string): Promise<Stop[]> => 
    apiFetch<Stop[]>(`/trips/${tripId}/stops`)

type ValhallaRouteResponse = {trip: {legs: { shape: string}[]}}

// маршрут по произвольным точкам (S8 WP-3: старт дня + стопы + финиш дня)
export const getValhallaRouteForPoints = async (
    locations: {lat: number, lon: number}[],
    costing: string = 'pedestrian',
): Promise<number[][]> => {
    if (locations.length < 2) return []
    let data: ValhallaRouteResponse
    try {
        data = await apiFetch<ValhallaRouteResponse>('/route',{
            method: 'POST',
            body: JSON.stringify({locations, costing, directions_options:{units: 'km'} }),
        })
    } catch {
        return []
    }
    const allCoords: number[][] = []
    for (const leg of data.trip.legs){
        allCoords.push(...decodePolyline(leg.shape))
    }
    return allCoords
}

export const getValhallaRoute = (stops: Stop[], costing: string = 'pedestrian') =>
    getValhallaRouteForPoints(
        stops.filter(s => s.place_lat && s.place_lon)
            .map(s => ({lat: s.place_lat!, lon: s.place_lon!})),
        costing,
    )

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

export async function getTrip(tripId:string): Promise<Trip> {
    return apiFetch<Trip>(`/trips/${tripId}`) 
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
// S9 WP-B: скачать экспорт (PDF/ICS) как файл
export async function downloadExport(tripId: string, kind: 'pdf' | 'ics'): Promise<void> {
    const headers: Record<string, string> = {}
    const token = getAccessToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
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
