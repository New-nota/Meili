export interface Stop {
    id: string
    trip_id: string
    place_id: string
    day_id: string | null
    position: number
    place_name: string | null
    place_lat: number | null
    place_lon: number | null
    place_address: string | null
    transport_to_next: string | null
    duration_minutes: number | null
    visit_date: string | null
    notes: string | null
    is_booked: boolean
    priority: number              // S8 WP-4: 0 обычный, 1 важный, 2 обязательный
    included_in_route: boolean    // false = «не влезло в день» (selective)
}

export interface Trip {
    id: string
    title: string
    city: string
    country: string | null
    adults_count: number
    children_count: number
    children_ages: number[] | null
    is_public: boolean
    transport_default: string
    start_date: string | null
    end_date: string | null
}

export interface Place {
    id: string
    name: string
    lat: number | null
    lon: number | null
    address: string | null
    category: string | null
}