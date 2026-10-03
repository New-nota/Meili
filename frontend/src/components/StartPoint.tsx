import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { apiErrorMessage } from "../utils/apiError";
import { geocodeOblast, isAbort, type GeocodeHit } from "../utils/geocode";

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
    const [suggestions, setSuggestions] = useState<GeocodeHit[]>([])
    const [error, setError] = useState<string | null>(null)
    // QA: выбранный (сохранённый) адрес — не запрос. Раньше setAddress(addr)
    // после сохранения снова запускал поиск, и выпадашка тут же открывалась
    const [savedAddress, setSavedAddress] = useState(initialAddress || '')

    // пропсы пришли позже (поездка догрузилась) — подхватываем в рендере
    const [seenProps, setSeenProps] = useState({ initialAddress, initialTime })
    if (seenProps.initialAddress !== initialAddress || seenProps.initialTime !== initialTime) {
        setSeenProps({ initialAddress, initialTime })
        if (initialAddress) { setAddress(initialAddress); setSavedAddress(initialAddress) }
        if (initialTime) setTime(initialTime.slice(0, 5))
    }

    const searching = address.trim().length >= 3 && address !== savedAddress
    useEffect(()=> {
        if (address.trim().length < 3 || address === savedAddress) return
        // QA: поиск в границах области; устаревший ответ отменяется
        const ctrl = new AbortController()
        const timer = setTimeout(async () => {
            try {
                setSuggestions(await geocodeOblast(address, { lang: i18n.language, limit: 3, signal: ctrl.signal }))
            } catch (e) {
                if (!isAbort(e)) setError(t('place.searchFailed'))
            }
        }, 300)
        return () => { clearTimeout(timer); ctrl.abort() }
    }, [address, savedAddress, i18n.language, t])

    const save = async(lat: number, lon: number, addr: string) => {
        if (isSaving) return
        setIsSaving(true)
        setError(null)
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
            setSavedAddress(addr)
            setAddress(addr)
            setSuggestions([])
        } catch (e) {
            setError(apiErrorMessage(e, t))
        } finally {
            setIsSaving(false)
        }
    }
    return (
        <div style={{padding: '12px 16px', borderBottom: '1px solid var(--border)'}}>
            <div style={{fontSize: 12, color: 'var(--text-muted)', marginBottom: 6}}>
                {t('place.startPoint')}
            </div>
            <div style={{display: 'flex', gap: 8}}>
                <input value={address} onChange={e => { setAddress(e.target.value); setError(null) }}
                placeholder={t('place.startPlaceholder')} maxLength={200}
                style={{flex: 1, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13}}/>
            </div>
            {searching && suggestions.length > 0 && (
                <div style={{marginTop: 4, border: '1px solid var(--border)', borderRadius:6, overflow: 'hidden'}}>
                    {suggestions.map(s => (
                        <div key={s.place_id}
                            onClick={()=> save(parseFloat(s.lat), parseFloat(s.lon), s.display_name.split(',').slice(0,2).join(','))}
                            style={{padding: '6px 10px',fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--surface)', backgroundColor:'var(--surface-raised)'}}
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--surface)')}
                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--surface-raised)')}>
                                {s.display_name.split(',').slice(0,2).join(',')} </div>
                    ))}
                    </div>
            )}
            {isSaving && <div style={{fontSize: 11, color: 'var(--text-muted)', marginTop: 4}}>{t('common.saving')}</div>}
            {error && <div style={{fontSize: 12, color: 'var(--accent)', marginTop: 4}}>{error}</div>}
        </div>
    )
}
