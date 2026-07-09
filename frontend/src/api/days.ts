import { apiFetch } from "./client"
import type { Stop } from "../types"

// S8 WP-3: мульти-день
export interface TripLocation {
    id: string
    name: string | null
    address: string | null
    lat: number
    lon: number
    kind: string
}

export interface TripDay {
    id: string
    date: string
    day_index: number
    start_location: TripLocation | null
    end_location: TripLocation | null
    start_time: string
    end_time: string
    stops: Stop[]
}

export interface OptimizeResult {
    ordered_stop_ids: string[]
    dropped_stop_ids: string[]
}

export const getDays = (tripId: string) =>
    apiFetch<TripDay[]>(`/trips/${tripId}/days`)

export const getLocations = (tripId: string) =>
    apiFetch<TripLocation[]>(`/trips/${tripId}/locations`)

export const addLocation = (
    tripId: string,
    data: { name?: string; address?: string; lat: number; lon: number; kind?: string },
) => apiFetch<TripLocation>(`/trips/${tripId}/locations`, {
    method: 'POST',
    body: JSON.stringify(data),
})

export const updateDay = (
    tripId: string,
    dayId: string,
    data: Partial<{
        start_location_id: string
        end_location_id: string
        start_time: string
        end_time: string
    }>,
) => apiFetch<TripDay>(`/trips/${tripId}/days/${dayId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
})

export const optimizeDay = (
    tripId: string,
    dayId: string,
    mode: 'full' | 'selective' = 'full',
    timeBudgetMinutes?: number,
) => apiFetch<OptimizeResult>(`/trips/${tripId}/days/${dayId}/optimize`, {
    method: 'POST',
    body: JSON.stringify({ mode, time_budget_minutes: timeBudgetMinutes ?? null }),
})
