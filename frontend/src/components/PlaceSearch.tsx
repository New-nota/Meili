import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { apiFetch } from "../api/client"
import type { Place } from "../types"
import { apiErrorMessage } from "../utils/apiError"
// QA: поиск в границах области (как мастер). Без bbox «собор» находил Ватикан
// и Шартр — стоп добавлялся, а маршрут падал «вне покрытия карт»
import { geocodeOblast, isAbort, type GeocodeHit } from "../utils/geocode"

type NominatimResult = GeocodeHit

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
    // QA: «ничего не нашлось», «геокодер лёг» и «не добавилось» раньше были
    // одинаковой тишиной (а ошибки — необработанными промисами в консоли)
    const [status, setStatus] = useState<'idle' | 'empty' | 'error'>('idle')
    const [addError, setAddError] = useState<string | null>(null)

    // короткий запрос — подсказки просто не показываем (без setState в эффекте)
    const active = query.trim().length >= 3
    useEffect(() => {
        const q = query.trim()
        if (q.length < 3) return
        // отмена устаревшего запроса: ответ на «соб» не перетрёт ответ на «собор»
        const ctrl = new AbortController()
        const timer = setTimeout(async () => {
            setIsSearching(true)
            try {
                const list = await geocodeOblast(q, { lang: i18n.language, limit: 8, signal: ctrl.signal })
                setResults(list)
                setStatus(list.length ? 'idle' : 'empty')
            } catch (e) {
                if (isAbort(e)) return
                setResults([])
                setStatus('error')
            } finally {
                if (!ctrl.signal.aborted) setIsSearching(false)
            }
        }, 300)
        return () => { clearTimeout(timer); ctrl.abort() }
    }, [query, i18n.language])

    const addPlace = async(result: NominatimResult) => {
        // стоп без дня невозможен (S16) — без выбранного дня кнопка не активна
        if (!dayId || isAdding !== null) return
        setIsAdding(result.place_id)
        setAddError(null)
        try {
            const place = await apiFetch<Place>('/places/', {
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
                    body: JSON.stringify({place_id: place.id, day_id: dayId})
                })

            setQuery('')
            setResults([])
            onPlaceAdded()
        } catch (e) {
            setAddError(apiErrorMessage(e, t, t('trip.addPlaceError')))
        } finally{
            setIsAdding(null)
        }
    }
    const hint = (text: string, accent = false) => (
        <div style={{fontSize: 12, color: accent ? 'var(--accent)' : 'var(--text-muted)', marginTop: 4}}>{text}</div>
    )
    return(
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)'}}>

            <input value={query} onChange={e => setQuery(e.target.value)} maxLength={200}
                placeholder={t('place.searchPlaceholder')} style={{width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, boxSizing: 'border-box'}}
            />
            {active && isSearching && hint(t('common.search'))}
            {active && !isSearching && status === 'empty' && hint(t('place.searchNothing'))}
            {active && !isSearching && status === 'error' && hint(t('place.searchFailed'), true)}
            {active && results.length > 0 && !dayId && hint(t('place.pickDayFirst'), true)}
            {addError && hint(addError, true)}

            {active && results.length > 0 &&(
                <div style={{marginTop: 8, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden'}}>
                    {results.map(r => (
                        <div key={r.place_id} style={{
                        padding: '8px 10px', borderBottom: '1px solid var(--surface)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8}}>
                    <span style={{fontSize: 13, color: 'var(--text-primary)', flex: 1}}>
                        {r.display_name.split(',').slice(0,2).join(',')}
                    </span>
                    <button onClick={() => addPlace(r)} disabled={isAdding !== null || !dayId} style={{
                        padding: '4px 10px', background: dayId ? 'var(--accent)' : 'var(--text-muted)', color: 'var(--surface)',
                        border: 'none', borderRadius: 4, cursor: dayId ? 'pointer' : 'not-allowed', fontSize: 12, flexShrink: 0
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
