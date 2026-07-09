import { useEffect, useState } from 'react'
import { addLocation, type TripLocation } from '../api/days'

// Выбор локации дня (S8 WP-3): существующие локации поездки + добавление
// новой через автодополнение Nominatim (сырой fetch, без наших credentials).
interface Props {
    tripId: string
    label: string           // "Старт" | "Финиш"
    value: TripLocation | null
    locations: TripLocation[]
    onSelect: (locationId: string) => void
    onLocationAdded: () => void
}

interface NominatimHit {
    place_id: number
    display_name: string
    lat: string
    lon: string
}

export default function LocationPicker({
    tripId, label, value, locations, onSelect, onLocationAdded,
}: Props) {
    const [adding, setAdding] = useState(false)
    const [query, setQuery] = useState('')
    const [hits, setHits] = useState<NominatimHit[]>([])

    useEffect(() => {
        if (query.length < 3) { setHits([]); return }
        const timer = setTimeout(async () => {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=3`,
                { headers: { 'Accept-Language': 'ru' } },
            )
            setHits(await res.json())
        }, 300)
        return () => clearTimeout(timer)
    }, [query])

    const pickHit = async (hit: NominatimHit) => {
        const loc = await addLocation(tripId, {
            name: hit.display_name.split(',')[0],
            address: hit.display_name,
            lat: parseFloat(hit.lat),
            lon: parseFloat(hit.lon),
        })
        setAdding(false)
        setQuery('')
        setHits([])
        onLocationAdded()
        onSelect(loc.id)
    }

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, flexWrap: 'wrap' }}>
            <span style={{ color: '#6b7280', flexShrink: 0 }}>{label}:</span>
            <select
                value={value?.id ?? ''}
                onChange={e => e.target.value && onSelect(e.target.value)}
                style={{ flex: 1, minWidth: 120, padding: 4, border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, background: 'white' }}
            >
                <option value="">— не задано —</option>
                {locations.map(l => (
                    <option key={l.id} value={l.id}>
                        {l.name || l.address || `${l.lat.toFixed(3)}, ${l.lon.toFixed(3)}`}
                    </option>
                ))}
            </select>
            <button onClick={() => setAdding(!adding)} title="Добавить локацию"
                style={{ border: '1px solid #e5e7eb', background: 'white', borderRadius: 6, cursor: 'pointer', fontSize: 13, padding: '2px 8px' }}>
                +
            </button>
            {adding && (
                <div style={{ width: '100%' }}>
                    <input value={query} onChange={e => setQuery(e.target.value)}
                        placeholder="Адрес отеля, вокзала..."
                        style={{ width: '100%', padding: 6, border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                    {hits.map(h => (
                        <div key={h.place_id} onClick={() => pickHit(h)}
                            style={{ padding: '6px 8px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid #f3f4f6' }}>
                            {h.display_name.split(',').slice(0, 3).join(',')}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
