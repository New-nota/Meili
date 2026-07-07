import { apiFetch } from "./client"

export interface Booking {
    id: string
    trip_stop_id: string
    provider: string
    status: 'pending' | 'confirmed' | 'cancelled'
    booked_at: string
    external_id: string | null
    amount: string | null
    currency: string | null
    deep_link: string | null
}

export const PROVIDERS = [
    { value: 'viator', label: 'Viator', hint: 'туры и экскурсии' },
    { value: 'opentable', label: 'OpenTable', hint: 'рестораны' },
    { value: 'thefork', label: 'TheFork', hint: 'рестораны (Европа)' },
] as const

export async function createBooking(
    tripStopId: string,
    provider: string,
    visitDate?: string,
): Promise<Booking> {
    return apiFetch<Booking>('/bookings/', {
        method: 'POST',
        body: JSON.stringify({
            trip_stop_id: tripStopId,
            provider,
            visit_date: visitDate ?? null,
        }),
    })
}

export const listBookings = () => apiFetch<Booking[]>('/bookings/')

export async function confirmBooking(
    bookingId: string,
    data: { external_id?: string; amount?: string; currency?: string },
): Promise<Booking> {
    return apiFetch<Booking>(`/bookings/${bookingId}/confirm`, {
        method: 'POST',
        body: JSON.stringify(data),
    })
}

export const cancelBooking = (bookingId: string) =>
    apiFetch<Booking>(`/bookings/${bookingId}/cancel`, { method: 'POST' })
