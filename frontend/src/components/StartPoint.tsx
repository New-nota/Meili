import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";

interface Props {
    tripId: string
    initialAddress?: string
    initialTime?: string
}

export default function StartPoint({ tripId, initialAddress, initialTime }: Props) {
    const { t, i18n } = useTranslation()
    const [address, setAddress] = useState(initialAddress || '')
    const [time, setTime] = useState(initialTime?.slice(0, 5) || '09:00')
    const[isSaving, setIsSaving] = useState(false)
    const [suggestions, setSuggestions] = useState<any[]>([])

    useEffect( () => {
        if(initialAddress) setAddress(initialAddress)
        if(initialTime) setTime(initialTime.slice(0, 5))
    }, [initialAddress, initialTime])

    useEffect(()=> {
        if (address.length < 3) { setSuggestions([]); return}
        const timer = setTimeout(async () => {
            const res = await fetch (
                `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=3`,
                {headers: {'Accept-Language': i18n.language}}
            )
            setSuggestions(await res.json())
        }, 300)
        return () => clearTimeout(timer)
    }, [address])

    const save = async(lat: number, lon: number, addr: string) => {
        setIsSaving(true)
        try{
            await apiFetch(`/trips/${tripId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    start_address: addr,
                    start_lat: lat,
                    start_lon: lon,
                    start_time: time + ':00'
                })
            })
            setAddress(addr)
            setSuggestions([])
        } finally {
            setIsSaving(false)
        }
    }
    return (
        <div style={{padding: '12px 16px', borderBottom: '1px solid #e5e7ed'}}>
            <div style={{fontSize: 12, color: '#6b7280', marginBottom: 6}}>
                {t('place.startPoint')}
            </div>
            <div style={{display: 'flex', gap: 8}}>
                <input value={address} onChange={e => setAddress(e.target.value)} placeholder={t('place.startPlaceholder')}
                style={{flex: 1, padding: '6px 8px', border: '1px solid #e5e7ed', borderRadius: 6, fontSize: 13}}/>
            </div>
            {suggestions.length > 0 && (
                <div style={{marginTop: 4, border: '1px solid #e5e7ed', borderRadius:6, overflow: 'hidden'}}>
                    {suggestions.map((s: any) => (
                        <div key={s.place_id} 
                            onClick={()=> save(parseFloat(s.lat), parseFloat(s.lon), s.display_name.split(',').slice(0,2).join(','))}
                            style={{padding: '6px 10px',fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f3f4f6', backgroundColor:'white'}}
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f9fafb')}
                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'white')}>
                                {s.display_name.split(',').slice(0,2).join(',')} </div>
                    ))}
                    </div>
            )}
            {isSaving && <div style={{fontSize: 11, color: '#9ca3af', marginTop: 4}}>{t('common.saving')}</div>}
        </div>
    )
}