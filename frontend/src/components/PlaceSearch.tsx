import { useState, useEffect } from "react"
import { apiFetch } from "../api/client"
import type { Place } from "../types"

interface NominatimResult {
    place_id: number
    display_name: string
    lat: string
    lon: string
}

interface Props {
    tripId: string
    onPlaceAdded: () => void
}

export default function PlaceSearch({tripId, onPlaceAdded}: Props) {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<NominatimResult[]>([])
    const [isSearching, setIsSearching] = useState(false)
    const [isAdding, setIsAdding] = useState<number | null>(null)

    useEffect(() => {
        if (query.length < 3){
            setResults([])
            return
        }
        const timer = setTimeout(async () => {
            setIsSearching(true)
        try {
            const res = await fetch (
                `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`, {headers: {'Accept-Language': 'ru'}}
            )
            setResults(await res.json())
        } finally {
            setIsSearching(false)
        }
        }, 300)
        return () => clearTimeout(timer)}, [query])
        
    
    const addPlace = async(result: NominatimResult) => {
        setIsAdding(result.place_id)
        try {
            const place = await apiFetch<Place>('/places', {
                method: 'POST', body: JSON.stringify({
                        name: result.display_name.split(',')[0],
                        lat: parseFloat(result.lat),
                        lon: parseFloat(result.lon),
                        address: result.display_name
                    })
                })
                
            await apiFetch(`trips/${tripId}/stops`, {
                    method: 'POST',
                    body: JSON.stringify({place_id: place.id})
                })
                
                setQuery('')
                setResults([])
                onPlaceAdded()
            } finally{
                setIsAdding(null)
            }
        }
        return(
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7ed'}}>
                
                <input value={query} onChange={e => setQuery(e.target.value)}
                    placeholder="Найти место..." style={{width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14, boxSizing: 'border-box'}}
                />
                    {isSearching && <div style={{fontSize: 12, color: '#9ca3af', marginTop:4}}>Поиск...</div>}
        
                {results.length > 0 &&(
                    <div style={{marginTop: 8, border: '1px solid #e5e7ed', borderRadius: 6, overflow: 'hidden'}}>
                        {results.map(r => (
                            <div key={r.place_id} style={{
                            padding: '8px 10px', borderBottom: '1px solid #f3f4f6',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8}}>
                        <span style={{fontSize: 13, color: '#374151', flex: 1}}>
                            {r.display_name.split(',').slice(0,2).join(',')}
                        </span>
                        <button onClick={() => addPlace(r)} disabled={isAdding === r.place_id} style={{
                            padding: '4px 10px', background: '#10b981', color: 'white',
                            border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, flexShrink: 0
                        }}>
                            {isAdding === r.place_id ? '...' : '+ Добавить'}
                        </button>
                        </div>
                        ))}
                     </div>
                )}
            </div>
        )
}

