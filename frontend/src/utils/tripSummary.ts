import type { TripDay } from '../api/days'
import type { DayRoute } from '../api/trips'

// S16 §4.3: сводка дня — чистая функция.
// Время дня = дорога (Valhalla) + время на точках; расстояние — только дорога.
export interface DaySummary {
    stopsCount: number
    distanceMeters: number
    durationSeconds: number
}

export function getDaySummary(day: TripDay, route: DayRoute | null | undefined): DaySummary {
    const stops = day.stops.filter(s => s.included_in_route)
    const onSiteSeconds = stops.reduce((acc, s) => acc + s.duration_minutes * 60, 0)
    return {
        stopsCount: stops.length,
        distanceMeters: route?.total_distance_meters ?? 0,
        durationSeconds: (route?.total_duration_seconds ?? 0) + onSiteSeconds,
    }
}
