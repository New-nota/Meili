import type { Trip } from '../types'

// S16 §2.2: статус поездки — чистая функция, одна на профиль и Discover.
export type TripStatus = 'draft' | 'completed' | 'active'

export function getTripStatus(trip: Pick<Trip, 'is_draft' | 'end_date'>): TripStatus {
    if (trip.is_draft) return 'draft'
    if (trip.end_date && trip.end_date < todayISO()) return 'completed'
    return 'active'
}

function todayISO(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
