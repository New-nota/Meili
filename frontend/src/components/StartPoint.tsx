import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { House, MapPin } from "lucide-react";
import { apiFetch } from "../api/client";
import { apiErrorMessage } from "../utils/apiError";
import { geocode, isAbort, type GeocodeHit } from "../utils/geocode";
import { useSearchArea } from "../utils/searchArea";

interface Props {
    tripId: string
    initialAddress?: string
    initialTime?: string
}

export default function StartPoint({ tripId, initialAddress, initialTime }: Props) {
    const { t, i18n } = useTranslation()
    const near = useSearchArea()
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
        // QA: поиск в округе города поездки; устаревший ответ отменяется
        const ctrl = new AbortController()
        const timer = setTimeout(async () => {
            try {
                setSuggestions(await geocode(address, { lang: i18n.language, limit: 3, signal: ctrl.signal, near }))
            } catch (e) {
                if (!isAbort(e)) setError(t('place.searchFailed'))
            }
        }, 300)
        return () => { clearTimeout(timer); ctrl.abort() }
    }, [address, savedAddress, i18n.language, t, near])

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
        <div className="field">
            <span className="field-label">{t('place.startPoint')}</span>
            <label className="searchbox">
                <House />
                <input value={address} onChange={e => { setAddress(e.target.value); setError(null) }}
                    aria-label={t('place.startPoint')}
                    placeholder={t('place.startPlaceholder')} maxLength={200} />
            </label>
            {searching && suggestions.length > 0 && (
                <div style={{ background: 'var(--raised)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-1)', padding: 4 }}>
                    {suggestions.map(s => (
                        <button key={s.place_id} type="button" className="menu-item"
                            onClick={()=> save(parseFloat(s.lat), parseFloat(s.lon), s.display_name.split(',').slice(0,2).join(','))}>
                            <MapPin />
                            <span style={{ flex: 1 }}>{s.display_name.split(',').slice(0,2).join(',')}</span>
                        </button>
                    ))}
                </div>
            )}
            {isSaving && <span className="field-hint">{t('common.saving')}</span>}
            {error && <span className="error-text" role="alert">{error}</span>}
        </div>
    )
}
