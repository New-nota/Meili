import { apiFetch, API_URL, ApiError, getAccessToken, tryRefresh } from "./client"
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
    avatar_upload_enabled?: boolean
}

export const getMe = () => apiFetch<UserProfile>('/users/me')

// null = стереть поле (undefined — не трогать)
export const updateMe = (data: {
    name?: string | null; home_city?: string | null; travel_style?: string[]
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
    const send = () => {
        const form = new FormData()
        form.append('file', file)
        const headers: Record<string, string> = {}
        const token = getAccessToken()
        if (token) headers['Authorization'] = `Bearer ${token}`
        return fetch(`${API_URL}/users/me/avatar`, {
            method: 'POST',
            body: form,
            headers,
            credentials: 'include',
        })
    }
    let res = await send()
    // QA: этот fetch обходит apiFetch и не умел молчаливый refresh — с
    // протухшим access (15 мин) загрузка аватара просто падала
    if (res.status === 401 && await tryRefresh()) res = await send()
    if (!res.ok) {
        const body = await res.json().catch(() => null)
        // ApiError — чтобы apiErrorMessage локализовал машинный код (avatar_too_large…)
        throw new ApiError(res.status, body ?? { detail: 'upload_failed' })
    }
    return (await res.json()).avatar_url
}
