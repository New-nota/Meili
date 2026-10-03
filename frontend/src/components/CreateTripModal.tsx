import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TripDraft } from '../api/meili'
import { apiFetch } from '../api/client'
import type { Trip } from '../types/index'
import { apiErrorMessage } from '../utils/apiError'
import IntInput from './IntInput'
import { MAX_GROUP, MAX_MONEY, MONEY_RE } from '../utils/limits'
import { geocodeOblast, isAbort } from '../utils/geocode'

// S11: мастер создания поездки — одна модалка, один сабмит POST /trips/.
// Город — автокомплит по геокодеру, ограниченный bbox Калининградской области
// (единственное покрытие Valhalla). Вне bbox ничего не находится — честная граница.

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

    // дебаунс-поиск города по геокодеру (bbox области, только населённые пункты)
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
                const data = await geocodeOblast(cityQuery, {
                    lang: i18n.language, limit: 6, signal: ctrl.signal, addressDetails: true,
                })
                const hits = data
                    .filter(r => r.class === 'place' || PLACE_TYPES.has(r.addresstype ?? ''))
                    .map(r => ({ name: r.name || r.display_name.split(',')[0], lat: +r.lat, lon: +r.lon }))
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
        ...(city ? { city: city.name, city_lat: city.lat, city_lon: city.lon, country: 'Россия' } : {}),
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
                    country: 'Россия',
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

    const label: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }
    const input: React.CSSProperties = {
        width: '100%', padding: '8px 10px', border: '1px solid var(--border)',
        borderRadius: 6, fontSize: 14, background: 'var(--surface-raised)',
    }
    const currencySymbol = CURRENCIES.find(c => c.code === currency)!.symbol

    return (
        <div onClick={onClose} style={{
            position: 'fixed', inset: 0, background: 'color-mix(in srgb, var(--text-primary) 50%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        }}>
            <div onClick={e => e.stopPropagation()} style={{
                background: 'var(--surface-raised)', borderRadius: 12, padding: 24,
                maxWidth: 460, width: '100%', maxHeight: '90vh', overflowY: 'auto',
                display: 'flex', flexDirection: 'column', gap: 12,
            }}>
                <h3 style={{ margin: 0 }}>{t('trip.wizard.title')}</h3>

                {/* название */}
                <div>
                    <label style={label}>{t('trip.wizard.name')}</label>
                    <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
                        placeholder={t('trip.titlePlaceholder')} style={input} autoFocus />
                </div>

                {/* город — автокомплит */}
                <div style={{ position: 'relative' }}>
                    <label style={label}>{t('trip.wizard.city')}</label>
                    <input value={cityQuery}
                        onChange={e => { setCityQuery(e.target.value); setCity(null) }}
                        onFocus={() => visibleHits.length && setCityOpen(true)}
                        placeholder={t('trip.wizard.cityPlaceholder')} style={input} />
                    <div style={{ fontSize: 11, color: visibleStatus === 'empty' || visibleStatus === 'error' ? 'var(--accent)' : 'var(--text-muted)', marginTop: 2 }}>
                        {visibleStatus === 'loading' ? t('common.loading')
                            : visibleStatus === 'empty' ? t('trip.wizard.cityNotFound')
                            : visibleStatus === 'error' ? t('trip.wizard.cityLookupFailed')
                            : t('trip.wizard.region')}
                    </div>
                    {cityOpen && visibleHits.length > 0 && (
                        <div style={{
                            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5,
                            background: 'var(--surface-raised)', border: '1px solid var(--border)',
                            borderRadius: 6, marginTop: 2, boxShadow: '0 4px 16px color-mix(in srgb, var(--text-primary) 18%, transparent)',
                            maxHeight: 200, overflowY: 'auto',
                        }}>
                            {visibleHits.map((hit, i) => (
                                <div key={i} onClick={() => pickCity(hit)} style={{
                                    padding: '8px 10px', cursor: 'pointer', fontSize: 14,
                                    borderBottom: i < visibleHits.length - 1 ? '1px solid var(--border)' : 'none',
                                }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                    📍 {hit.name}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* люди */}
                <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                        <label style={label}>{t('trip.wizard.adults')}</label>
                        <IntInput value={adults} min={1} max={MAX_GROUP} onChange={setAdults} style={input} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={label}>{t('trip.wizard.children')}</label>
                        <IntInput value={children} min={0} max={MAX_GROUP} onChange={changeChildren} style={input} />
                    </div>
                </div>

                {/* возраста детей */}
                {children > 0 && (
                    <div>
                        <label style={label}>{t('trip.wizard.ages')}</label>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {ages.map((age, i) => (
                                <IntInput key={i} value={age} min={0} max={17}
                                    title={t('trip.wizard.childN', { n: i + 1 })}
                                    onChange={v => setAges(prev => prev.map((a, j) => j === i ? v : a))}
                                    style={{ ...input, width: 64 }} />
                            ))}
                        </div>
                    </div>
                )}

                {/* даты */}
                <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                        <label style={label}>{t('trip.wizard.start')}</label>
                        <input type="date" value={startDate} min={today}
                            onChange={e => setStartDate(e.target.value)} style={input} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={label}>{t('trip.wizard.end')}</label>
                        <input type="date" value={endDate} min={startDate || today}
                            onChange={e => setEndDate(e.target.value)} style={input} />
                    </div>
                </div>

                {/* валюта + бюджет */}
                <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                        <label style={label}>{t('trip.wizard.currency')}</label>
                        <select value={currency} onChange={e => setCurrency(e.target.value as CurrencyCode)} style={input}>
                            {CURRENCIES.map(c => (
                                <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
                            ))}
                        </select>
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={label}>{t('trip.wizard.budget')}</label>
                        <input type="number" min={0} max={MAX_MONEY} step="0.01" value={budget}
                            onChange={e => setBudget(e.target.value)}
                            placeholder={`${currencySymbol} —`} style={input} />
                    </div>
                </div>

                {error && <p style={{ color: 'var(--accent)', fontSize: 13, margin: 0 }}>{error}</p>}

                <div style={{
                    display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap',
                }}>
                    {/* S17: слева — «посоветоваться с Meili»; тогда «Создать»
                        открывает чат вместо немедленного создания поездки */}
                    {onPlanWithMeili && (
                        <label style={{
                            display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
                            cursor: 'pointer', color: 'var(--text-muted)', marginRight: 'auto',
                        }}>
                            <input type="checkbox" checked={withMeili}
                                onChange={e => setWithMeili(e.target.checked)} />
                            {t('meili.consult')}
                        </label>
                    )}
                    <button onClick={onClose} style={{
                        padding: '8px 16px', background: 'none', color: 'var(--text-muted)',
                        border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 14,
                    }}>{t('common.cancel')}</button>
                    <button onClick={submit} disabled={busy} style={{
                        padding: '8px 16px', background: busy ? 'var(--text-muted)' : 'var(--accent)',
                        color: 'var(--surface)', border: 'none', borderRadius: 6,
                        cursor: busy ? 'wait' : 'pointer', fontSize: 14,
                    }}>{busy ? t('common.saving') : t('common.create')}</button>
                </div>
            </div>
        </div>
    )
}
