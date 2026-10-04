import { useState, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { MapPin, Plus, Search } from "lucide-react"
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
    placeholder?: string    // «Найти место для дня 2»
    onPlaceAdded: () => void
}

export default function PlaceSearch({tripId, dayId, placeholder, onPlaceAdded}: Props) {
    const { t, i18n } = useTranslation()
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<NominatimResult[]>([])
    const [isSearching, setIsSearching] = useState(false)
    const [isAdding, setIsAdding] = useState<number | null>(null)
    // QA: «ничего не нашлось», «геокодер лёг» и «не добавилось» раньше были
    // одинаковой тишиной (а ошибки — необработанными промисами в консоли)
    const [status, setStatus] = useState<'idle' | 'empty' | 'error'>('idle')
    const [addError, setAddError] = useState<string | null>(null)
    // актуальный запрос для асинхронного addPlace (замыкание видит старый)
    const queryRef = useRef(query)
    useEffect(() => { queryRef.current = query }, [query])

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
        const typed = query
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

            // набрал новый запрос, пока добавлялось, — его не стираем
            setQuery(cur => cur === typed ? '' : cur)
            setResults(cur => (queryRef.current === typed ? [] : cur))
            onPlaceAdded()
        } catch (e) {
            setAddError(apiErrorMessage(e, t, t('trip.addPlaceError')))
        } finally{
            setIsAdding(null)
        }
    }
    const hint = (text: string, danger = false) => (
        <p style={{fontSize: 13, color: danger ? 'var(--danger)' : 'var(--ink-3)', margin: '8px 4px 0'}}>{text}</p>
    )
    return(
        <div>
            <label className="searchbox">
                <Search />
                <input value={query} onChange={e => setQuery(e.target.value)} maxLength={200}
                    aria-label={placeholder ?? t('place.searchPlaceholder')}
                    placeholder={placeholder ?? t('place.searchPlaceholder')} />
            </label>
            {active && isSearching && hint(t('common.search'))}
            {active && !isSearching && status === 'empty' && hint(t('place.searchNothing'))}
            {active && !isSearching && status === 'error' && hint(t('place.searchFailed'), true)}
            {active && results.length > 0 && !dayId && hint(t('place.pickDayFirst'), true)}
            {addError && hint(addError, true)}

            {active && results.length > 0 && (
                <div style={{marginTop: 8, background: 'var(--raised)', borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-1)', padding: 4}}>
                    {results.map(r => {
                        const [name, ...rest] = r.display_name.split(',')
                        return (
                            <div key={r.place_id} style={{display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr) auto',
                                alignItems: 'center', gap: 10, padding: '8px 8px 8px 10px', borderRadius: 'var(--radius)'}}>
                                <MapPin size={17} style={{color: 'var(--ink-3)'}} />
                                <span style={{minWidth: 0}}>
                                    <span style={{display: 'block', fontSize: 14.5, fontWeight: 600}}>{name}</span>
                                    <span style={{display: 'block', fontSize: 13, color: 'var(--ink-3)',
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                                        {rest.slice(0, 2).join(',').trim()}
                                    </span>
                                </span>
                                <button type="button" onClick={() => addPlace(r)} disabled={isAdding !== null || !dayId}
                                    className="btn btn-sm btn-accent btn-pill">
                                    <Plus />{isAdding === r.place_id ? '…' : t('place.addShort')}
                                </button>
                            </div>
                        )
                    })}
                 </div>
            )}
        </div>
    )
}
