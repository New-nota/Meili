import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addLocation, type TripLocation } from '../api/days'
import { apiErrorMessage } from '../utils/apiError'
import { geocodeOblast, isAbort, type GeocodeHit } from '../utils/geocode'

// Выбор локации дня (S8 WP-3): существующие локации поездки + добавление
// новой через автодополнение Nominatim (сырой fetch, без наших credentials).
// QA: поиск — в границах области (отель в Париже давал «день вне покрытия»),
// ошибки геокодера и сохранения видны, устаревшие ответы отменяются.
interface Props {
    tripId: string
    label: string           // "Старт" | "Финиш"
    value: TripLocation | null
    locations: TripLocation[]
    onSelect: (locationId: string) => void
    onLocationAdded: () => void
}

export default function LocationPicker({
    tripId, label, value, locations, onSelect, onLocationAdded,
}: Props) {
    const { t, i18n } = useTranslation()
    const [adding, setAdding] = useState(false)
    const [query, setQuery] = useState('')
    const [hits, setHits] = useState<GeocodeHit[]>([])
    const [status, setStatus] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle')
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    const active = query.trim().length >= 3
    useEffect(() => {
        if (query.trim().length < 3) return
        const ctrl = new AbortController()
        const timer = setTimeout(async () => {
            setStatus('loading')
            try {
                const list = await geocodeOblast(query, { lang: i18n.language, limit: 5, signal: ctrl.signal })
                setHits(list)
                setStatus(list.length ? 'idle' : 'empty')
            } catch (e) {
                if (isAbort(e)) return
                setHits([])
                setStatus('error')
            }
        }, 300)
        return () => { clearTimeout(timer); ctrl.abort() }
    }, [query, i18n.language])

    const close = () => { setAdding(false); setQuery(''); setHits([]); setError(null) }

    const pickHit = async (hit: GeocodeHit) => {
        if (saving) return
        setSaving(true)
        setError(null)
        try {
            const loc = await addLocation(tripId, {
                name: hit.display_name.split(',')[0],
                address: hit.display_name,
                lat: parseFloat(hit.lat),
                lon: parseFloat(hit.lon),
            })
            close()
            onLocationAdded()
            onSelect(loc.id)
        } catch (e) {
            setError(apiErrorMessage(e, t))
        } finally {
            setSaving(false)
        }
    }

    const hint = (text: string, accent = false) => (
        <div style={{ fontSize: 12, color: accent ? 'var(--accent)' : 'var(--text-muted)', padding: '4px 2px' }}>{text}</div>
    )

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{label}:</span>
            <select
                value={value?.id ?? ''}
                onChange={e => e.target.value && onSelect(e.target.value)}
                style={{ flex: 1, minWidth: 120, padding: 4, border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--surface-raised)' }}
            >
                <option value="">{t('common.notSet')}</option>
                {locations.map(l => (
                    <option key={l.id} value={l.id}>
                        {l.name || l.address || `${l.lat.toFixed(3)}, ${l.lon.toFixed(3)}`}
                    </option>
                ))}
            </select>
            <button onClick={() => (adding ? close() : setAdding(true))} title={t('place.addLocation')}
                aria-label={t('place.addLocation')} aria-expanded={adding}
                style={{ border: '1px solid var(--border)', background: 'var(--surface-raised)', borderRadius: 6, cursor: 'pointer', fontSize: 13, padding: '2px 8px' }}>
                {adding ? '✕' : '+'}
            </button>
            {adding && (
                <div style={{ width: '100%' }}>
                    <input value={query} onChange={e => setQuery(e.target.value)} autoFocus maxLength={200}
                        onKeyDown={e => { if (e.key === 'Escape') close() }}
                        placeholder={t('place.locationPlaceholder')}
                        style={{ width: '100%', padding: 6, border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                    {active && status === 'loading' && hint(t('common.search'))}
                    {active && status === 'empty' && hint(t('place.searchNothing'))}
                    {active && status === 'error' && hint(t('place.searchFailed'), true)}
                    {error && hint(error, true)}
                    {active && hits.map(h => (
                        <div key={h.place_id} onClick={() => pickHit(h)} role="button" tabIndex={0}
                            onKeyDown={e => { if (e.key === 'Enter') pickHit(h) }}
                            style={{ padding: '6px 8px', fontSize: 12, cursor: saving ? 'wait' : 'pointer', borderBottom: '1px solid var(--surface)' }}>
                            {h.display_name.split(',').slice(0, 3).join(',')}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
