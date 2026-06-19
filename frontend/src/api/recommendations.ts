import type {Trip} from '../types/index'

const API_URL = 'http://localhost:8000'

const headers = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('access_token')?? ''}`
})

export async function getRecommendedTrips(city?:string): Promise<Trip[]> {
    const params = new URLSearchParams()
    if (city) params.set('city', city)
    
    const res = await fetch(`${API_URL}/recommendations/trips?${params}`, {
            headers: headers()
    })
    if (!res.ok) throw new Error('Failed to fetch recommended trips')
    return res.json()

}