import { apiFetch } from './client'

// S15: отметки «посещено» — глобальная связь юзер↔место (не привязана к поездке)
export interface VisitedPlace {
    place_id: string
    rating: number | null
    comment: string | null
    visited_at: string
}

export const getVisitedPlaces = () =>
    apiFetch<VisitedPlace[]>('/users/me/visited-places')

export const markVisited = (placeId: string, data: { rating?: number | null; comment?: string | null } = {}) =>
    apiFetch<void>(`/places/${placeId}/visited`, {
        method: 'POST',
        body: JSON.stringify(data),
    })

export const unmarkVisited = (placeId: string) =>
    apiFetch<void>(`/places/${placeId}/visited`, { method: 'DELETE' })
