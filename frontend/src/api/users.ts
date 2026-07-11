import { apiFetch, API_URL, getAccessToken } from "./client"
import type { Trip } from "../types"

// Профиль (S9 WP-D)
export interface ProfileStats {
    trips_count: number
    visited_places_count: number
    likes_given: number
    likes_received: number
}

export interface UserProfile {
    id: string
    email: string
    name: string | null
    avatar_url: string | null
    home_city: string | null
    travel_style: string[] | null
    created_at: string
    stats: ProfileStats
    has_password: boolean
}

export const getMe = () => apiFetch<UserProfile>('/users/me')

export const updateMe = (data: {
    name?: string; home_city?: string; travel_style?: string[]
}) => apiFetch<UserProfile>('/users/me', {
    method: 'PATCH',
    body: JSON.stringify(data),
})

export const changePassword = (old_password: string, new_password: string) =>
    apiFetch<void>('/users/me/password', {
        method: 'POST',
        body: JSON.stringify({ old_password, new_password }),
    })

export const getMyTrips = () => apiFetch<Trip[]>('/users/me/trips')
export const getLikedTrips = () => apiFetch<Trip[]>('/users/me/liked-trips')

// multipart: без Content-Type application/json — отдельный fetch
export async function uploadAvatar(file: File): Promise<string> {
    const form = new FormData()
    form.append('file', file)
    const headers: Record<string, string> = {}
    const token = getAccessToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${API_URL}/users/me/avatar`, {
        method: 'POST',
        body: form,
        headers,
        credentials: 'include',
    })
    if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error((body as { detail?: string })?.detail ?? 'upload_failed')
    }
    return (await res.json()).avatar_url
}
