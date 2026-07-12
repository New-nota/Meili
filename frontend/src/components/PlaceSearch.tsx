import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { apiFetch } from "../api/client"
import type { Place } from "../types"

interface NominatimResult {
    place_id: number
    display_name: string
    lat: string
    lon: string
    osm_type?: string
    osm_id?: number
}

interface Props {
    tripId: string
    dayId?: string | null   // S8 WP-3: новый стоп попадает в этот день
    onPlaceAdded: () => void
}

export default function PlaceSearch({tripId, dayId, onPlaceAdded}: Props) {
    const { t, i18n } = useTranslation()
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
                `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`, {headers: {'Accept-Language': i18n.language}}
            )
            setResults(await res.json())
        } finally {
            setIsSearching(false)
        }
        }, 300)
        return () => clearTimeout(timer)}, [query, i18n.language])
        
    
    const addPlace = async(result: NominatimResult) => {
        setIsAdding(result.place_id)
        try {
            const place = await apiFetch<Place>('/places', {
                method: 'POST', body: JSON.stringify({
                        name: result.display_name.split(',')[0],
                        lat: parseFloat(result.lat),
                        lon: parseFloat(result.lon),
                        address: result.display_name,
                        // osm_id -> get-or-create на бэке, дублей не будет (S8 WP-2)
                        osm_id: result.osm_type && result.osm_id
                            ? `${result.osm_type}/${result.osm_id}` : null,
                    })
                })
                
            await apiFetch(`/trips/${tripId}/stops`, {
                    method: 'POST',
                    body: JSON.stringify({place_id: place.id, day_id: dayId ?? null})
                })
                
                setQuery('')
                setResults([])
                onPlaceAdded()
            } finally{
                setIsAdding(null)
            }
        }
        return(
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)'}}>
                
                <input value={query} onChange={e => setQuery(e.target.value)}
                    placeholder={t('place.searchPlaceholder')} style={{width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, boxSizing: 'border-box'}}
                />
                    {isSearching && <div style={{fontSize: 12, color: 'var(--text-muted)', marginTop:4}}>{t('common.search')}</div>}
        
                {results.length > 0 &&(
                    <div style={{marginTop: 8, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden'}}>
                        {results.map(r => (
                            <div key={r.place_id} style={{
                            padding: '8px 10px', borderBottom: '1px solid var(--surface)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8}}>
                        <span style={{fontSize: 13, color: 'var(--text-primary)', flex: 1}}>
                            {r.display_name.split(',').slice(0,2).join(',')}
                        </span>
                        <button onClick={() => addPlace(r)} disabled={isAdding === r.place_id} style={{
                            padding: '4px 10px', background: 'var(--accent)', color: 'var(--surface)',
                            border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, flexShrink: 0
                        }}>
                            {isAdding === r.place_id ? '...' : t('place.addShort')}
                        </button>
                        </div>
                        ))}
                     </div>
                )}
            </div>
        )
}

