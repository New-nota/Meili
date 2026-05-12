import type { Stop, Trip } from '../types/index'

const API_URL = 'http://localhost:8000'

let authToken: string | null = null

export const setToken = (token: string) => {
    authToken = token
}

const headers = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`
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
    const shape = data.trip.legs[0].shape
    return decodePolyline(shape)
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