import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Stop } from '../types/index'
import {
    PROVIDERS, createBooking, confirmBooking, cancelBooking, listBookings,
    type Booking,
} from '../api/bookings'
import { updateStop } from '../api/trips'
import { apiFetch } from '../api/client'
import { apiErrorMessage } from '../utils/apiError'
import { MAX_MONEY, MONEY_RE } from '../utils/limits'
import { stopCostLabel } from '../utils/costLabel'
import GroupSummary from './GroupSummary'
import PriceSummary from './PriceSummary'
import BookingConfirmation from './BookingConfirmation'
import RatingStars from './RatingStars'
import { getVisitedPlaces, markVisited, unmarkVisited } from '../api/visited'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, Check, CircleCheck, ExternalLink, Trash2 } from 'lucide-react'

// Детали остановки + флоу бронирования (deep-link):
// нет брони -> выбор даты и провайдера -> pending (открыт сайт партнёра)
// -> пользователь вводит номер брони -> confirmed.
interface Props {
    stop: Stop
    trip: { adults_count?: number; children_count?: number; currency?: string } | null
    // S16: дата стопа = дата его дня (visit_date снесён); панель её только читает
    dayDate?: string | null
    onClose: () => void
    onChanged: () => void // перезагрузить остановки (is_booked)
}

export default function StopDetailPanel({ stop, trip, dayDate, onClose, onChanged }: Props) {
    const { t, i18n } = useTranslation()
    const [booking, setBooking] = useState<Booking | null>(null)
    const visitDate = dayDate ?? null
    const [refInput, setRefInput] = useState('')
    const [amountInput, setAmountInput] = useState('')
    // QA: валюта брони — только валюта поездки (одна на поездку, бэк иначе
    // отвечает booking_currency_mismatch). Раньше селект по умолчанию стоял
    // на EUR, и подтверждение брони в рублёвой поездке падало «ошибкой»
    const currency = trip?.currency ?? 'EUR'
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [confirmDelete, setConfirmDelete] = useState(false)

    // QA: общая обёртка действий панели — раньше половина кнопок была голым
    // await: ошибка = необработанный промис, клик «молча не работает»
    const safely = async (fn: () => Promise<unknown>, fallback?: string) => {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
            await fn()
        } catch (e) {
            setError(apiErrorMessage(e, t, fallback))
        } finally {
            setBusy(false)
        }
    }

    // подхватываем существующую бронь этой остановки
    useEffect(() => {
        listBookings()
            .then(all => {
                const active = all.find(
                    b => b.trip_stop_id === stop.id && b.status !== 'cancelled',
                )
                setBooking(active ?? null)
            })
            .catch(() => {})
    }, [stop.id])

    const [costInput, setCostInput] = useState(stop.estimated_cost ?? '')

    // сумма поменялась снаружи (сохранили, «вернуть авто») — подхватываем в
    // рендере; новый стоп — новый инстанс панели (key в TripPlanner)
    const [seenCost, setSeenCost] = useState(stop.estimated_cost)
    if (seenCost !== stop.estimated_cost) {
        setSeenCost(stop.estimated_cost)
        setCostInput(stop.estimated_cost ?? '')
    }


    // S15: моя отметка «посещено» + оценка/комментарий (глобальная, юзер↔место)
    const queryClient = useQueryClient()
    const { data: visitedList } = useQuery({ queryKey: ['visited'], queryFn: getVisitedPlaces })
    const visited = visitedList?.find(v => v.place_id === stop.place_id) ?? null
    const [rating, setRating] = useState(visited?.rating ?? 0)
    const [comment, setComment] = useState(visited?.comment ?? '')
    const [ratingSaved, setRatingSaved] = useState(false)
    // отметка «посещено» догружается асинхронно — подхватываем её в рендере
    const visitedKey = `${stop.place_id}|${visited?.rating ?? ''}|${visited?.comment ?? ''}`
    const [seenVisited, setSeenVisited] = useState(visitedKey)
    if (seenVisited !== visitedKey) {
        setSeenVisited(visitedKey)
        setRating(visited?.rating ?? 0)
        setComment(visited?.comment ?? '')
        setRatingSaved(false)
    }

    const invalidateVisited = () => queryClient.invalidateQueries({ queryKey: ['visited'] })

    const toggleVisited = () => safely(async () => {
        if (visited) await unmarkVisited(stop.place_id)
        else await markVisited(stop.place_id)
        invalidateVisited()
    })

    const saveRating = () => safely(async () => {
        // оценка сама помечает место посещённым (создаёт строку)
        await markVisited(stop.place_id, {
            rating: rating || null,
            comment: comment.trim() || null,
        })
        setRatingSaved(true)
        invalidateVisited()
    })

    const saveCost = async () => {
        // S9 WP-A/ТЗ-E: ручной ввод суммы -> cost_source=manual, движок её не трогает.
        // QA: «12,5» (запятая), «abc», «-5» раньше улетали на бэк и падали 422
        // необработанным промисом — поле молча «не сохранялось»
        const raw = String(costInput).trim().replace(',', '.')
        if ((raw || null) === stop.estimated_cost) return
        if (raw && (!MONEY_RE.test(raw) || Number(raw) > MAX_MONEY)) {
            setError(t('budget.invalidAmount'))
            return
        }
        await safely(async () => {
            await updateStop(stop.trip_id, stop.id, { estimated_cost: raw || null })
            onChanged()
        })
    }

    const resetCostToAuto = () => safely(async () => {
        // ТЗ-E: «вернуть авто» — сброс ручной суммы + пересчёт из цен места
        await updateStop(stop.trip_id, stop.id, { cost_source: 'auto' })
        setCostInput('')
        onChanged()
    })

    // QA: удалить место из маршрута было НЕЛЬЗЯ — ручка DELETE есть, кнопки
    // не было нигде в UI (только через план Meili). Два клика: «Удалить» →
    // «Точно удалить?»
    const deleteStop = () => safely(async () => {
        await apiFetch(`/trips/${stop.trip_id}/stops/${stop.id}`, { method: 'DELETE' })
        onClose()
        onChanged()
    })

    // ТЗ-E/ТЗ-Meili: примерная стоимость в валюте поездки — общие правила
    // в utils/costLabel; null (нет данных/чужая валюта) → «цена не указана»
    const isAuto = stop.cost_source === 'auto'
    const label = stopCostLabel(stop, trip?.currency, i18n.language, t('budget.free'))
    const approx = label?.approx ?? false
    const costLabel = label?.text ?? t('budget.noPrice')

    const handleBook = (provider: string) => safely(async () => {
        const b = await createBooking(stop.id, provider, visitDate ?? undefined)
        setBooking(b)
        if (b.deep_link) window.open(b.deep_link, '_blank', 'noopener')
    }, t('booking.createError'))

    const handleConfirm = () => {
        if (!booking) return
        const amount = amountInput.trim().replace(',', '.')
        if (amount && (!MONEY_RE.test(amount) || Number(amount) > MAX_MONEY)) {
            setError(t('budget.invalidAmount'))
            return
        }
        return safely(async () => {
            const b = await confirmBooking(booking.id, {
                external_id: refInput.trim() || undefined,
                amount: amount || undefined,
                currency: amount ? currency : undefined,
            })
            setBooking(b)
            onChanged()
        }, t('booking.confirmError'))
    }

    const handleCancel = () => {
        if (!booking) return
        return safely(async () => {
            await cancelBooking(booking.id)
            setBooking(null)
            setRefInput('')
            onChanged()
        })
    }

    const section: React.CSSProperties = { marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }

    return (
        <div style={{ padding: '18px 24px 32px' }} className="planner-pad">
            <button type="button" onClick={onClose} className="btn btn-sm btn-ghost" style={{ marginLeft: -12, marginBottom: 10 }}>
                <ArrowLeft />{t('booking.backToRoute')}
            </button>

            <h2 style={{ fontSize: 23, lineHeight: 1.15 }}>{stop.place_name || t('common.untitled')}</h2>
            {stop.place_address && (
                <p style={{ marginTop: 4, fontSize: 14, color: 'var(--ink-3)' }}>{stop.place_address}</p>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 12, fontSize: 14.5, color: 'var(--ink-2)' }}>
                {/* S16: дату визита задаёт день маршрута, здесь она только показана */}
                {visitDate && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <CalendarDays size={16} style={{ color: 'var(--ink-3)' }} />
                        {new Intl.DateTimeFormat(i18n.language, {
                            weekday: 'short', day: 'numeric', month: 'long',
                        }).format(new Date(visitDate + 'T00:00:00'))}
                    </span>
                )}
                <GroupSummary adults={trip?.adults_count ?? 1} children={trip?.children_count ?? 0} />
            </div>

            {/* ТЗ-E: примерная стоимость. Табличные цифры — суммы не прыгают */}
            <div style={section}>
                <div className="field-label" style={{ marginBottom: 8 }}>{t('budget.estimatedCost')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span title={approx ? t('budget.approxHint') : t('budget.manualHint')}
                        style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em',
                            color: label === null ? 'var(--ink-3)' : 'var(--ink)' }}>
                        {costLabel}
                    </span>
                    <input placeholder={t('budget.amount')} value={costInput} inputMode="decimal"
                        aria-label={t('budget.estimatedCost')} className="input input-sm"
                        onChange={e => setCostInput(e.target.value)} onBlur={saveCost}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        style={{ width: 130, marginLeft: 'auto' }} />
                    {!isAuto && (
                        <button type="button" onClick={resetCostToAuto} title={t('budget.approxHint')} className="link-btn">
                            {t('budget.backToAuto')}
                        </button>
                    )}
                </div>
                <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 6 }}>
                    {approx ? t('budget.approxHint') : label ? t('budget.manualHint') : null}
                </p>
            </div>

            {error && <p className="error-text" role="alert" style={{ marginTop: 10 }}>{error}</p>}

            <div style={section}>
                {/* нет активной брони — выбор провайдера */}
                {!booking && (
                    <>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                            <span className="field-label">{t('booking.bookVia')}</span>
                            <PriceSummary amount={null} currency={null} />
                        </div>
                        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                            {PROVIDERS.map(p => (
                                <button key={p.value} type="button" disabled={busy} onClick={() => handleBook(p.value)}
                                    className="provider-btn">
                                    <span style={{ minWidth: 0 }}>
                                        <strong style={{ display: 'block', fontSize: 15 }}>{p.label}</strong>
                                        <span style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>{t(`booking.hint${p.label === 'Viator' ? 'Viator' : p.label === 'OpenTable' ? 'Opentable' : 'Thefork'}`)}</span>
                                    </span>
                                    <ExternalLink size={17} style={{ color: 'var(--ink-3)' }} />
                                </button>
                            ))}
                        </div>
                    </>
                )}

                {/* бронь создана — ждём подтверждения от пользователя */}
                {booking && booking.status === 'pending' && (
                    <div className="on-surface" style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', padding: 14 }}>
                        <div style={{ fontSize: 14.5, marginBottom: 6 }}>
                            {t('booking.created', { provider: booking.provider })}
                            {booking.deep_link && (
                                <>
                                    {' '}
                                    <a href={booking.deep_link} target="_blank" rel="noopener noreferrer">
                                        {t('booking.openPartner')}
                                    </a>
                                </>
                            )}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 10 }}>
                            {t('booking.confirmHint')}
                        </div>
                        <div style={{ display: 'grid', gap: 8 }}>
                            <input placeholder={t('booking.refPlaceholder')} value={refInput} maxLength={128}
                                aria-label={t('booking.refPlaceholder')} className="input"
                                onChange={e => setRefInput(e.target.value)} />
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <input placeholder={t('booking.amountPlaceholder')} value={amountInput} inputMode="decimal"
                                    aria-label={t('booking.amountPlaceholder')} className="input"
                                    onChange={e => setAmountInput(e.target.value)} />
                                <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>{currency}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button type="button" onClick={handleConfirm} disabled={busy} className="btn btn-sm btn-accent">
                                    <Check />{t('booking.confirm')}
                                </button>
                                <button type="button" onClick={handleCancel} disabled={busy} className="btn btn-sm btn-ghost">
                                    {t('booking.cancel')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* подтверждена */}
                {booking && booking.status === 'confirmed' && (
                    <BookingConfirmation booking={booking} onCancel={handleCancel} />
                )}
            </div>

            {/* S15: «Оценка» — под бронированием; отметка глобальная (юзер↔место) */}
            <div style={section}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <span className="field-label">{t('visited.rateTitle')}</span>
                    <button type="button" onClick={toggleVisited} aria-pressed={!!visited} className="chip">
                        <CircleCheck size={16} />{visited ? t('visited.visited') : t('visited.markVisited')}
                    </button>
                </div>
                <RatingStars value={rating} onChange={v => { setRating(v); setRatingSaved(false) }} />
                <textarea placeholder={t('visited.commentPlaceholder')} value={comment}
                    aria-label={t('visited.commentPlaceholder')} className="textarea"
                    onChange={e => { setComment(e.target.value); setRatingSaved(false) }}
                    rows={2} maxLength={2000} style={{ marginTop: 8, minHeight: 72 }} />
                <button type="button" onClick={saveRating} className="btn btn-sm" style={{ marginTop: 8 }}
                    disabled={rating === 0 && !comment.trim() && !visited}>
                    {ratingSaved && <Check />}{t('common.save')}
                </button>
            </div>

            {/* удалить из маршрута — подтверждение вторым кликом */}
            <div style={{ ...section, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {!confirmDelete ? (
                    <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy} className="btn btn-sm btn-danger" style={{ marginLeft: -12 }}>
                        <Trash2 />{t('stop.delete')}
                    </button>
                ) : (
                    <>
                        <span style={{ fontSize: 14.5, marginRight: 4 }}>{t('stop.deleteConfirm')}</span>
                        <button type="button" onClick={deleteStop} disabled={busy} className="btn btn-sm btn-danger-solid">
                            {t('common.delete')}
                        </button>
                        <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy} className="btn btn-sm btn-ghost">
                            {t('common.cancel')}
                        </button>
                    </>
                )}
            </div>
        </div>
    )
}
