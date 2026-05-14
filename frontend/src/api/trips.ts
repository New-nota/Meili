import type { Stop, Trip } from '../types/index'

const API_URL = 'http://localhost:8000'


const headers = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('access_token')?? ''}`
})

export const getStops = async (tripId: string): Promise<Stop[]> => {
    const res = await fetch(`${API_URL}/trips/${tripId}/stops`, {headers: headers()})
    if (!res.ok) throw new Error('Failed to fetch stops')
    return res.json()
}

export const getValhallaRoute = async (stops: Stop[], costing: string = 'pedestrian'): Promise<number[][]> => {
    const locations = stops
        .filter(s => s.place_lat && s.place_lon)
        .map(s => ({lat: s.place_lat!, lon: s.place_lon!}))
    if (locations.length < 2) return []
    const res = await fetch('http://localhost:8000/route', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            locations, costing, directions_options: {units: 'km'}
        })
    })
    if (!res.ok) return []
    const data = await res.json()
    const allCoords: number[][] = []
    for (const leg of data.trip.legs){
        const coords = decodePolyline(leg.shape)
        allCoords.push(...coords)
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
    const response = await fetch(`${API_URL}/trips/${tripId}/optimize`, {
        method: 'POST',
        headers: headers()
    })
    if(!response.ok) throw new Error('Optimize failed')
    const data = await response.json()
return data.optimized_order
}

export async function reorderStops(tripId: string, stopIds: string[]): Promise<void> {
    const response = await fetch(`${API_URL}/trips/${tripId}/stops/reorder`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({stop_ids: stopIds})
    })
    if(!response.ok) throw new Error('Reorder failed')
}

export async function updateStopTransport(tripId: string, stopId: string, transport: string): Promise<void> {
    const response = await fetch(`${API_URL}/trips/${tripId}/stops/${stopId}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({transport_to_next: transport})
    })
    if(!response.ok) throw new Error('Update transport failed')   
}