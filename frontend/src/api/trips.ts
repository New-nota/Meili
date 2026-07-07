import type { Stop, Trip } from '../types/index'
import { apiFetch } from "./client"






export const getStops = async (tripId: string): Promise<Stop[]> => 
    apiFetch<Stop[]>(`/trips/${tripId}/stops`)

type ValhallaRouteResponse = {trip: {legs: { shape: string}[]}}

export const getValhallaRoute = async (stops: Stop[], costing: string = 'pedestrian'): Promise<number[][]> => {
    const locations = stops
        .filter(s => s.place_lat && s.place_lon)
        .map(s => ({lat: s.place_lat!, lon: s.place_lon!}))
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

export async function optimizeTrip(tripId: string): Promise<string[]> {
    const data = await apiFetch<{optimized_order: string[]}>(`/trips/${tripId}/optimize`, {
        method: 'POST',})
        return data.optimized_order
}

export async function reorderStops(tripId: string, stopIds: string[]): Promise<void> {
     await apiFetch(`/trips/${tripId}/stops/reorder`, {
        method: 'POST',
        body: JSON.stringify({stop_ids: stopIds})
    })
}

export async function updateStopTransport(tripId: string, stopId: string, transport: string): Promise<void> {
     await apiFetch(`/trips/${tripId}/stops/${stopId}`, {
        method: 'PUT',
        body: JSON.stringify({transport_to_next: transport})
    })
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