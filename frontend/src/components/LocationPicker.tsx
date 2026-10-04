import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Flag, House, MapPin, Search, X } from 'lucide-react'
import { addLocation, type TripLocation } from '../api/days'
import { apiErrorMessage } from '../utils/apiError'
import { geocode, isAbort, type GeocodeHit } from '../utils/geocode'
import { useSearchArea } from '../utils/searchArea'

// Старт/финиш дня (S8 WP-3; редизайн «Лес» — строка списка вместо select с «+»).
// Свёрнуто: «Старт в 09:00 · Отель …» + «Задать место». Развёрнуто: сохранённые
// места поездки (история отелей/вокзалов) и поиск нового адреса Nominatim.
// QA: поиск — сначала в округе города поездки (одноимённая улица в другой
// стране не всплывает первой), ошибки геокодера и сохранения видны,
// устаревшие ответы отменяются.
interface Props {
    tripId: string
    kind: 'start' | 'finish'
    label: string               // «Старт в 09:00» | «Финиш около 14:07»
    value: TripLocation | null
    locations: TripLocation[]
    columns: string             // сетка строки стопа (режим правки) — иконка встаёт под номер
    onSelect: (locationId: string) => void
    onLocationAdded: () => void
}

const locName = (l: TripLocation) => l.name || l.address || `${l.lat.toFixed(3)}, ${l.lon.toFixed(3)}`

export default function LocationPicker({
    tripId, kind, label, value, locations, columns, onSelect, onLocationAdded,
}: Props) {
    const { t, i18n } = useTranslation()
    const near = useSearchArea()
    const [open, setOpen] = useState(false)
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
                const list = await geocode(query, { lang: i18n.language, limit: 5, signal: ctrl.signal, near })
                setHits(list)
                setStatus(list.length ? 'idle' : 'empty')
            } catch (e) {
                if (isAbort(e)) return
                setHits([])
                setStatus('error')
            }
        }, 300)
        return () => { clearTimeout(timer); ctrl.abort() }
    }, [query, i18n.language, near])

    const close = () => { setOpen(false); setQuery(''); setHits([]); setError(null) }

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

    const Icon = kind === 'start' ? House : Flag
    const hint = (text: string, danger = false) => (
        <p style={{ fontSize: 13, color: danger ? 'var(--danger)' : 'var(--ink-3)', padding: '6px 2px 0' }}>{text}</p>
    )

    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: columns, columnGap: 10, alignItems: 'center', padding: '8px 8px' }}>
                <span style={{ gridColumn: 2, justifySelf: 'center',
                    width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center',
                    border: value ? '2px solid var(--wood)' : '2px dashed var(--birch-2)',
                    color: value ? 'var(--wood)' : 'var(--ink-3)' }}>
                    <Icon size={15} />
                </span>
                <div style={{ minWidth: 0, gridColumn: 3 }}>
                    <div style={{ fontSize: 14.5, color: 'var(--ink-2)' }}>{label}</div>
                    <div style={{ fontSize: 13.5, color: value ? 'var(--ink)' : 'var(--ink-3)', fontWeight: value ? 600 : 400,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {value ? locName(value) : t('planner.placeNotSet')}
                    </div>
                </div>
                <button type="button" onClick={() => (open ? close() : setOpen(true))} aria-expanded={open}
                    className="btn btn-sm btn-pill" style={{ gridColumn: '4 / 6', justifySelf: 'end' }}>
                    {open ? <X /> : null}
                    {open ? t('common.close') : value ? t('planner.changePlace') : t('planner.setPlace')}
                </button>
            </div>

            {open && (
                <div style={{ margin: '2px 8px 10px', padding: 12, background: 'var(--surface)', borderRadius: 'var(--radius-lg)' }}>
                    {locations.length > 0 && (
                        <div style={{ display: 'grid', gap: 2, marginBottom: 10 }}>
                            <div className="field-label" style={{ padding: '0 2px 4px' }}>{t('planner.savedPlaces')}</div>
                            {locations.map(l => (
                                <button key={l.id} type="button" className="menu-item" aria-checked={value?.id === l.id}
                                    onClick={() => { close(); if (value?.id !== l.id) onSelect(l.id) }}>
                                    {value?.id === l.id ? <Check /> : <MapPin />}
                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{locName(l)}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    <label className="searchbox" style={{ background: 'var(--raised)', height: 44 }}>
                        <Search />
                        <input value={query} onChange={e => setQuery(e.target.value)} autoFocus maxLength={200}
                            aria-label={t('place.addLocation')}
                            onKeyDown={e => { if (e.key === 'Escape') close() }}
                            placeholder={t('place.locationPlaceholder')} />
                    </label>
                    {active && status === 'loading' && hint(t('common.search'))}
                    {active && status === 'empty' && hint(t('place.searchNothing'))}
                    {active && status === 'error' && hint(t('place.searchFailed'), true)}
                    {error && hint(error, true)}
                    {active && hits.length > 0 && (
                        <div style={{ display: 'grid', gap: 2, marginTop: 6 }}>
                            {hits.map(h => (
                                <button key={h.place_id} type="button" className="menu-item" disabled={saving}
                                    onClick={() => pickHit(h)}>
                                    <MapPin />
                                    <span style={{ flex: 1 }}>{h.display_name.split(',').slice(0, 3).join(',')}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
