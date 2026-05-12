export interface Stop {
    id: string
    trip_id: string
    place_id: string
    position: number
    place_name: string | null
    place_lat: number | null
    place_lon: number | null
    place_address: string | null
    transport_to_next: string | null
    duration_minutes: number | null
}

export interface Trip {
    id: string
    title: string
    city: string
    adults_count: number
    children_count: number
    transport_default: string
}

export interface Place {
    id: string
    name: string
    lat: number | null
    lon: number | null
    address: string | null
    category: string | null
}