import type {Trip} from '../types/index'
import { apiFetch } from './client'



export async function getRecommendedTrips(city?:string): Promise<Trip[]> {
    const params = new URLSearchParams()
    if (city) params.set('city', city)
    return apiFetch<Trip[]>(`/recommendations/trips?${params}`)

}