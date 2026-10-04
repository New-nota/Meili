import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin, X } from 'lucide-react'
import Logo from './Logo'
import type { TripDraft } from '../api/meili'
import { apiFetch } from '../api/client'
import type { Trip } from '../types/index'
import { apiErrorMessage } from '../utils/apiError'
import IntInput from './IntInput'
import { MAX_GROUP, MAX_MONEY, MONEY_RE } from '../utils/limits'
import { geocode, isAbort, placeContext } from '../utils/geocode'

// S11: мастер создания поездки — одна модалка, один сабмит POST /trips/.
// Город — автокомплит по геокодеру. По миру: раньше поиск был зажат в bbox
// Калининградской области, а страна всегда «Россия»; теперь любой населённый
// пункт, страна — из геокодера, таймзону по координатам ставит бэкенд.

const MAX_TRIP_DAYS = 60

// валюта по умолчанию — от языка интерфейса; ¥ CNY только ручным выбором
const CURRENCIES = [
    { code: 'RUB', symbol: '₽' },
    { code: 'USD', symbol: '$' },
    { code: 'EUR', symbol: '€' },
    { code: 'CNY', symbol: '¥' },
] as const
type CurrencyCode = (typeof CURRENCIES)[number]['code']

function defaultCurrency(lang: string): CurrencyCode {
    const base = lang.split('-')[0]
    if (base === 'ru') return 'RUB'
    if (base === 'en') return 'USD'
    return 'EUR' // de/fr/es и всё прочее
}

function todayStr(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// разница в днях (включительно) между двумя YYYY-MM-DD
function spanDays(start: string, end: string): number {
    const a = new Date(start + 'T00:00:00')
    const b = new Date(end + 'T00:00:00')
    return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1
}

interface CityHit {
    name: string
    lat: number
    lon: number
    country?: string
    context: string   // «Иль-де-Франс, Франция» — различает тёзок
}

const PLACE_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'municipality'])

interface Props {
    onClose: () => void
    onCreated: (trip: Trip) => void
    // S17: включён тумблер «посоветоваться с Meili» — вместо создания поездки
    // открываем чат, передав туда черновик из заполненных полей.
    // Ревью: текст — только заготовка реплики пользователя; факты уходят
    // вторым аргументом структурно, иначе модель их теряет
    onPlanWithMeili?: (text: string, draft: TripDraft) => void
}

export default function CreateTripModal({ onClose, onCreated, onPlanWithMeili }: Props) {
    const { t, i18n } = useTranslation()

    const [title, setTitle] = useState('')
    // город: текст запроса + выбранный результат (с координатами)
    const [cityQuery, setCityQuery] = useState('')
    const [city, setCity] = useState<CityHit | null>(null)
    const [cityHits, setCityHits] = useState<CityHit[]>([])
    const [cityOpen, setCityOpen] = useState(false)
    // QA: раньше «ничего не нашлось» и «геокодер лёг» выглядели одинаково —
    // пустотой под полем, и юзер не понимал, почему не создаётся поездка
    const [cityStatus, setCityStatus] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle')

    const [adults, setAdults] = useState(1)
    const [children, setChildren] = useState(0)
    const [ages, setAges] = useState<number[]>([])

    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrency(i18n.language))
    const [budget, setBudget] = useState('')

    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [withMeili, setWithMeili] = useState(false)   // S17: тумблер
    const today = useMemo(() => todayStr(), [])

    // длина массива возрастов = число детей: меняем вместе, в обработчике
    // (без setState в эффекте и лишнего кадра с рассинхроном)
    const changeChildren = (n: number) => {
        setChildren(n)
        setAges(prev => {
            const next = prev.slice(0, n)
            while (next.length < n) next.push(0)
            return next
        })
    }

    // дебаунс-поиск города по геокодеру (по миру, только населённые пункты)
    const debounceRef = useRef<number | undefined>(undefined)
    useEffect(() => {
        if (city && cityQuery === city.name) return // выбор уже сделан
        if (cityQuery.trim().length < 2) return  // короткий запрос — см. cityActive
        window.clearTimeout(debounceRef.current)
        // QA: ответы геокодера приходят в любом порядке — без отмены ответ на
        // «Ка» мог прилететь после ответа на «Калининград» и затереть его
        const ctrl = new AbortController()
        debounceRef.current = window.setTimeout(async () => {
            setCityStatus('loading')
            try {
                const data = await geocode(cityQuery, {
                    lang: i18n.language, limit: 6, signal: ctrl.signal, addressDetails: true,
                    featureType: 'settlement',
                })
                const hits = data
                    .filter(r => r.class === 'place' || PLACE_TYPES.has(r.addresstype ?? ''))
                    .map(r => ({
                        name: r.name || r.display_name.split(',')[0], lat: +r.lat, lon: +r.lon,
                        country: r.address?.country, context: placeContext(r),
                    }))
                setCityHits(hits)
                setCityOpen(true)
                setCityStatus(hits.length ? 'idle' : 'empty')
            } catch (e) {
                if (isAbort(e)) return
                setCityHits([])
                setCityStatus('error')
            }
        }, 300)
        return () => { window.clearTimeout(debounceRef.current); ctrl.abort() }
    }, [cityQuery, city, i18n.language])

    // Escape закрывает мастер (как и клик по подложке)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])

    const cityActive = cityQuery.trim().length >= 2
    const visibleHits = cityActive ? cityHits : []
    const visibleStatus = cityActive ? cityStatus : 'idle'

    const pickCity = (hit: CityHit) => {
        setCity(hit)
        setCityQuery(hit.name)
        setCityOpen(false)
    }

    // QA: набрал «Калининград» целиком, но не кликнул по подсказке — раньше
    // это «выберите город», хотя совпадение вот оно. Точное совпадение имени
    // (без регистра) или единственная подсказка засчитываются как выбор.
    const resolvedCity = (): CityHit | null => {
        if (city) return city
        const q = cityQuery.trim().toLocaleLowerCase()
        if (!q) return null
        const exact = visibleHits.find(h => h.name.toLocaleLowerCase() === q)
        return exact ?? (visibleHits.length === 1 ? visibleHits[0] : null)
    }

    const budgetError = (): string | null => {
        if (!budget.trim()) return null
        const n = Number(budget)
        if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY || !MONEY_RE.test(budget.trim())) {
            return t('trip.wizard.errBudget')
        }
        return null
    }

    const validate = (): string | null => {
        if (!title.trim()) return t('trip.wizard.errTitle')
        if (!resolvedCity()) return t('trip.wizard.errCity')
        if (adults < 1) return t('trip.wizard.errAdults')
        if (children > 0 && ages.some(a => a < 0 || a > 17)) return t('trip.wizard.errAges')
        if (!startDate || !endDate) return t('trip.wizard.errDates')
        if (startDate < today) return t('trip.wizard.errPast')
        if (endDate < startDate) return t('trip.wizard.errRange')
        if (spanDays(startDate, endDate) > MAX_TRIP_DAYS) return t('trip.wizard.errTooLong', { max: MAX_TRIP_DAYS })
        return budgetError()
    }

    /** S17: черновик поездки словами — заготовка первого сообщения Meili.
     *  Одной строкой: поле ввода чата однострочное, переносы в нём теряются. */
    const meiliDraft = (): string => {
        const parts: string[] = []
        if (city) parts.push(city.name)
        if (startDate && endDate) parts.push(`${startDate} — ${endDate}`)
        parts.push(t('profile.meta.adults', { count: adults }))
        if (children > 0) {
            parts.push(t('profile.meta.children', { count: children })
                + (ages.length ? ` (${ages.join(', ')})` : ''))
        }
        if (budget.trim()) parts.push(`${t('trip.wizard.budget')}: ${budget.trim()} ${currency}`)
        const head = title.trim()
            ? `${t('meili.draftPrefix')} «${title.trim()}»`
            : t('meili.draftPrefix')
        return parts.length ? `${head} — ${parts.join(', ')}` : head
    }

    /** S17: те же поля, что уйдут в POST /trips/, но фактами — для диалога. */
    const meiliDraftFields = (): TripDraft => ({
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(city ? {
            city: city.name, city_lat: city.lat, city_lon: city.lon,
            ...(city.country ? { country: city.country } : {}),
        } : {}),
        ...(startDate && endDate ? { start_date: startDate, end_date: endDate } : {}),
        adults_count: adults,
        children_count: children,
        ...(children > 0 ? { children_ages: ages } : {}),
        ...(budget.trim() ? { budget_total: budget.trim() } : {}),
        currency,
    })

    const submit = async () => {
        // S17: с тумблером поездку не создаём — идём обсуждать её с Meili,
        // поездку потом создаст сам план через «Применить»
        if (withMeili) {
            onPlanWithMeili?.(meiliDraft(), meiliDraftFields())
            return
        }
        if (busy) return
        const err = validate()
        if (err) { setError(err); return }
        const picked = resolvedCity()!
        if (!city) pickCity(picked)
        setBusy(true)
        setError(null)
        try {
            const trip = await apiFetch<Trip>('/trips/', {
                method: 'POST',
                body: JSON.stringify({
                    title: title.trim(),
                    city: picked.name,
                    city_lat: picked.lat,
                    city_lon: picked.lon,
                    country: picked.country ?? null,
                    adults_count: adults,
                    children_count: children,
                    children_ages: children > 0 ? ages : null,
                    start_date: startDate,
                    end_date: endDate,
                    currency,
                    ...(budget.trim() ? { budget_total: budget.trim().replace(',', '.') } : {}),
                }),
            })
            onCreated(trip)
        } catch (e) {
            setError(apiErrorMessage(e, t, t('trip.saveError')))
            setBusy(false)
        }
    }

    const currencySymbol = CURRENCIES.find(c => c.code === currency)!.symbol

    return (
        <div onClick={onClose} className="modal-scrim">
            <div onClick={e => e.stopPropagation()} className="modal-sheet" role="dialog" aria-modal="true"
                aria-labelledby="wizard-title" style={{ maxWidth: 500, display: 'grid', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h2 id="wizard-title" style={{ fontSize: 23, flex: 1 }}>{t('trip.wizard.title')}</h2>
                    <button type="button" onClick={onClose} className="icon-btn" aria-label={t('common.close')} style={{ marginRight: -8 }}>
                        <X />
                    </button>
                </div>

                {/* название */}
                <label className="field">
                    <span className="field-label">{t('trip.wizard.name')}</span>
                    <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
                        placeholder={t('trip.titlePlaceholder')} className="input" autoFocus />
                </label>

                {/* город — автокомплит */}
                <div className="field" style={{ position: 'relative' }}>
                    <label className="field-label" htmlFor="wizard-city">{t('trip.wizard.city')}</label>
                    <input id="wizard-city" value={cityQuery} className="input" autoComplete="off"
                        role="combobox" aria-expanded={cityOpen && visibleHits.length > 0} aria-controls="wizard-city-list"
                        onChange={e => { setCityQuery(e.target.value); setCity(null) }}
                        onFocus={() => visibleHits.length && setCityOpen(true)}
                        placeholder={t('trip.wizard.cityPlaceholder')} />
                    <span className="field-hint" style={{ color: visibleStatus === 'empty' || visibleStatus === 'error' ? 'var(--danger)' : undefined }}>
                        {visibleStatus === 'loading' ? t('common.loading')
                            : visibleStatus === 'empty' ? t('trip.wizard.cityNotFound')
                            : visibleStatus === 'error' ? t('trip.wizard.cityLookupFailed')
                            : city?.context || t('trip.wizard.cityHint')}
                    </span>
                    {cityOpen && visibleHits.length > 0 && (
                        <div id="wizard-city-list" role="listbox" style={{
                            position: 'absolute', top: 74, left: 0, right: 0, zIndex: 5, padding: 4,
                            background: 'var(--raised)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-2)',
                            maxHeight: 220, overflowY: 'auto',
                        }}>
                            {visibleHits.map((hit, i) => (
                                <button key={i} type="button" role="option" aria-selected={city?.name === hit.name}
                                    className="menu-item" onClick={() => pickCity(hit)}>
                                    <MapPin />{hit.name}
                                    {hit.context && (
                                        <span style={{ marginLeft: 'auto', paddingLeft: 12, fontSize: 13, color: 'var(--ink-3)' }}>
                                            {hit.context}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* люди */}
                <div className="grid-2">
                    <label className="field">
                        <span className="field-label">{t('trip.wizard.adults')}</span>
                        <IntInput value={adults} min={1} max={MAX_GROUP} onChange={setAdults} className="input" />
                    </label>
                    <label className="field">
                        <span className="field-label">{t('trip.wizard.children')}</span>
                        <IntInput value={children} min={0} max={MAX_GROUP} onChange={changeChildren} className="input" />
                    </label>
                </div>

                {/* возраста детей */}
                {children > 0 && (
                    <div className="field">
                        <span className="field-label">{t('trip.wizard.ages')}</span>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {ages.map((age, i) => (
                                <IntInput key={i} value={age} min={0} max={17}
                                    title={t('trip.wizard.childN', { n: i + 1 })}
                                    aria-label={t('trip.wizard.childN', { n: i + 1 })}
                                    onChange={v => setAges(prev => prev.map((a, j) => j === i ? v : a))}
                                    className="input input-sm" style={{ width: 64, textAlign: 'center' }} />
                            ))}
                        </div>
                    </div>
                )}

                {/* даты */}
                <div className="grid-2">
                    <label className="field">
                        <span className="field-label">{t('trip.wizard.start')}</span>
                        <input type="date" value={startDate} min={today} className="input"
                            onChange={e => setStartDate(e.target.value)} />
                    </label>
                    <label className="field">
                        <span className="field-label">{t('trip.wizard.end')}</span>
                        <input type="date" value={endDate} min={startDate || today} className="input"
                            onChange={e => setEndDate(e.target.value)} />
                    </label>
                </div>

                {/* валюта + бюджет */}
                <div className="grid-2">
                    <label className="field">
                        <span className="field-label">{t('trip.wizard.currency')}</span>
                        <select value={currency} onChange={e => setCurrency(e.target.value as CurrencyCode)} className="select">
                            {CURRENCIES.map(c => (
                                <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span className="field-label">{t('trip.wizard.budget')}</span>
                        <input type="number" min={0} max={MAX_MONEY} step="0.01" value={budget} className="input"
                            onChange={e => setBudget(e.target.value)}
                            placeholder={`${currencySymbol} —`} />
                    </label>
                </div>

                {error && <p className="error-text" role="alert">{error}</p>}

                {/* S17: «посоветоваться с Meili» — тогда «Создать» открывает чат
                    вместо немедленного создания поездки */}
                {onPlanWithMeili && (
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                        padding: '12px 14px', background: 'var(--surface)', borderRadius: 'var(--radius-lg)', cursor: 'pointer' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 600 }}>
                            <Logo size={20} />{t('meili.consult')}
                        </span>
                        <input type="checkbox" role="switch" className="switch" checked={withMeili}
                            onChange={e => setWithMeili(e.target.checked)} />
                    </label>
                )}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
                    <button type="button" onClick={onClose} className="btn btn-ghost">{t('common.cancel')}</button>
                    <button type="button" onClick={submit} disabled={busy} className="btn btn-primary" style={{ minWidth: 132, cursor: busy ? 'wait' : undefined }}>
                        {busy ? t('common.saving') : t('common.create')}
                    </button>
                </div>
            </div>
        </div>
    )
}
