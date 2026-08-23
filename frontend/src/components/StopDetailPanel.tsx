import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Stop } from '../types/index'
import {
    PROVIDERS, createBooking, confirmBooking, cancelBooking, listBookings,
    type Booking,
} from '../api/bookings'
import { updateStop } from '../api/trips'
import { stopCostLabel } from '../utils/costLabel'
import GroupSummary from './GroupSummary'
import PriceSummary from './PriceSummary'
import BookingConfirmation from './BookingConfirmation'
import RatingStars from './RatingStars'
import { getVisitedPlaces, markVisited, unmarkVisited } from '../api/visited'
import { useQuery, useQueryClient } from '@tanstack/react-query'

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
    const [currency, setCurrency] = useState('EUR')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

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

    // панель не размонтируется при выборе другого стопа — синхронизируем поле
    useEffect(() => {
        setCostInput(stop.estimated_cost ?? '')
    }, [stop.id, stop.estimated_cost])

    // S15: моя отметка «посещено» + оценка/комментарий (глобальная, юзер↔место)
    const queryClient = useQueryClient()
    const { data: visitedList } = useQuery({ queryKey: ['visited'], queryFn: getVisitedPlaces })
    const visited = visitedList?.find(v => v.place_id === stop.place_id) ?? null
    const [rating, setRating] = useState(0)
    const [comment, setComment] = useState('')
    const [ratingSaved, setRatingSaved] = useState(false)
    useEffect(() => {
        setRating(visited?.rating ?? 0)
        setComment(visited?.comment ?? '')
        setRatingSaved(false)
        // visited подтягивается асинхронно — синхронизируемся и по нему
    }, [stop.place_id, visited?.rating, visited?.comment])

    const invalidateVisited = () => queryClient.invalidateQueries({ queryKey: ['visited'] })

    const toggleVisited = async () => {
        if (visited) await unmarkVisited(stop.place_id)
        else await markVisited(stop.place_id)
        invalidateVisited()
    }

    const saveRating = async () => {
        // оценка сама помечает место посещённым (создаёт строку)
        await markVisited(stop.place_id, {
            rating: rating || null,
            comment: comment.trim() || null,
        })
        setRatingSaved(true)
        invalidateVisited()
    }

    const saveCost = async () => {
        // S9 WP-A/ТЗ-E: ручной ввод суммы -> cost_source=manual, движок её не трогает
        if ((costInput || null) === stop.estimated_cost) return
        await updateStop(stop.trip_id, stop.id, { estimated_cost: costInput || null })
        onChanged()
    }

    const resetCostToAuto = async () => {
        // ТЗ-E: «вернуть авто» — сброс ручной суммы + пересчёт из цен места
        await updateStop(stop.trip_id, stop.id, { cost_source: 'auto' })
        setCostInput('')
        onChanged()
    }

    // ТЗ-E/ТЗ-Meili: примерная стоимость в валюте поездки — общие правила
    // в utils/costLabel; null (нет данных/чужая валюта) → «цена не указана»
    const isAuto = stop.cost_source === 'auto'
    const label = stopCostLabel(stop, trip?.currency, i18n.language, t('budget.free'))
    const approx = label?.approx ?? false
    const costLabel = label?.text ?? t('budget.noPrice')

    const handleBook = async (provider: string) => {
        setBusy(true)
        setError(null)
        try {
            const b = await createBooking(stop.id, provider, visitDate ?? undefined)
            setBooking(b)
            if (b.deep_link) window.open(b.deep_link, '_blank', 'noopener')
        } catch {
            setError(t('booking.createError'))
        } finally {
            setBusy(false)
        }
    }

    const handleConfirm = async () => {
        if (!booking) return
        setBusy(true)
        setError(null)
        try {
            const b = await confirmBooking(booking.id, {
                external_id: refInput || undefined,
                amount: amountInput || undefined,
                currency: amountInput ? currency : undefined,
            })
            setBooking(b)
            onChanged()
        } catch {
            setError(t('booking.confirmError'))
        } finally {
            setBusy(false)
        }
    }

    const handleCancel = async () => {
        if (!booking) return
        setBusy(true)
        try {
            await cancelBooking(booking.id)
            setBooking(null)
            setRefInput('')
            onChanged()
        } finally {
            setBusy(false)
        }
    }

    return (
        <div style={{ padding: 16 }}>
            <button onClick={onClose} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--accent)', fontSize: 13, padding: 0, marginBottom: 12,
            }}>
                {t('booking.backToRoute')}
            </button>

            <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>
                {stop.place_name || t('common.untitled')}
            </h3>
            {stop.place_address && (
                <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)' }}>
                    {stop.place_address}
                </p>
            )}

            <GroupSummary
                adults={trip?.adults_count ?? 1}
                children={trip?.children_count ?? 0}
            />
            {/* S16: дату визита задаёт день маршрута, здесь она только показана */}
            {visitDate && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '4px 0' }}>
                    📅 {new Intl.DateTimeFormat(i18n.language, {
                        weekday: 'short', day: 'numeric', month: 'long',
                    }).format(new Date(visitDate + 'T00:00:00'))}
                </div>
            )}
            {/* ТЗ-E: примерная стоимость. Табличные цифры — суммы не прыгают */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '4px 0', flexWrap: 'wrap' }}>
                <span>💶</span>
                <span title={approx ? t('budget.approxHint') : t('budget.manualHint')}
                    style={{
                        fontVariantNumeric: 'tabular-nums',
                        color: label === null ? 'var(--text-muted)' : 'var(--text-primary)',
                    }}>
                    {costLabel}
                </span>
                <input placeholder={t('budget.estimatedCost')} value={costInput} inputMode="decimal"
                    onChange={e => setCostInput(e.target.value)} onBlur={saveCost}
                    style={{ width: 90, padding: 4, border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, marginLeft: 'auto' }} />
                {!isAuto && (
                    <button onClick={resetCostToAuto} title={t('budget.approxHint')}
                        style={{
                            border: '1px solid var(--border)', background: 'var(--surface-raised)',
                            borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '2px 6px',
                            color: 'var(--text-muted)',
                        }}>
                        {t('budget.backToAuto')}
                    </button>
                )}
            </div>

            {error && <p style={{ color: 'var(--accent)', fontSize: 13 }}>{error}</p>}

            {/* нет активной брони — выбор провайдера */}
            {!booking && (
                <div style={{ marginTop: 8 }}>
                    <PriceSummary amount={null} currency={null} />
                    <div style={{ fontSize: 13, fontWeight: 'bold', margin: '8px 0 6px' }}>
                        {t('booking.bookVia')}
                    </div>
                    {PROVIDERS.map(p => (
                        <button key={p.value} disabled={busy} onClick={() => handleBook(p.value)}
                            style={{
                                display: 'block', width: '100%', textAlign: 'left',
                                padding: '8px 12px', marginBottom: 6,
                                background: 'var(--surface-raised)', border: '1px solid var(--border)',
                                borderRadius: 8, cursor: busy ? 'wait' : 'pointer', fontSize: 13,
                            }}>
                            <strong>{p.label}</strong>
                            <span style={{ color: 'var(--text-muted)' }}> — {t(`booking.hint${p.label === 'Viator' ? 'Viator' : p.label === 'OpenTable' ? 'Opentable' : 'Thefork'}`)}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* бронь создана — ждём подтверждения от пользователя */}
            {booking && booking.status === 'pending' && (
                <div style={{
                    background: 'var(--surface)', border: '1px solid var(--accent)',
                    borderRadius: 8, padding: 12, marginTop: 8,
                }}>
                    <div style={{ fontSize: 13, marginBottom: 8 }}>
                        {t('booking.created', { provider: booking.provider })}
                        {booking.deep_link && (
                            <>
                                {' '}
                                <a href={booking.deep_link} target="_blank" rel="noopener noreferrer"
                                    style={{ color: 'var(--accent)' }}>
                                    {t('booking.openPartner')}
                                </a>
                            </>
                        )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                        {t('booking.confirmHint')}
                    </div>
                    <input placeholder={t('booking.refPlaceholder')} value={refInput}
                        onChange={e => setRefInput(e.target.value)}
                        style={{
                            width: '100%', padding: 6, marginBottom: 6, boxSizing: 'border-box',
                            border: '1px solid var(--border)', borderRadius: 6, fontSize: 13,
                        }} />
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        <input placeholder={t('booking.amountPlaceholder')} value={amountInput} inputMode="decimal"
                            onChange={e => setAmountInput(e.target.value)}
                            style={{
                                flex: 1, padding: 6, boxSizing: 'border-box',
                                border: '1px solid var(--border)', borderRadius: 6, fontSize: 13,
                            }} />
                        <select value={currency} onChange={e => setCurrency(e.target.value)}
                            style={{
                                padding: 6, border: '1px solid var(--border)',
                                borderRadius: 6, fontSize: 13, background: 'var(--surface-raised)',
                            }}>
                            {['EUR', 'USD', 'RUB'].map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={handleConfirm} disabled={busy} style={{
                            padding: '6px 12px', background: 'var(--accent)', color: 'var(--surface)',
                            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                        }}>
                            {t('booking.confirm')}
                        </button>
                        <button onClick={handleCancel} disabled={busy} style={{
                            padding: '6px 12px', background: 'none', color: 'var(--text-muted)',
                            border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                        }}>
                            {t('booking.cancel')}
                        </button>
                    </div>
                </div>
            )}

            {/* подтверждена */}
            {booking && booking.status === 'confirmed' && (
                <BookingConfirmation booking={booking} onCancel={handleCancel} />
            )}

            {/* S15: блок «Оценка» — под бронированием; отметка глобальная (юзер↔место) */}
            <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 'bold' }}>{t('visited.rateTitle')}</span>
                    <button onClick={toggleVisited} style={{
                        border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
                        fontSize: 12, padding: '3px 8px',
                        background: visited ? 'var(--accent)' : 'var(--surface-raised)',
                        color: visited ? 'var(--surface)' : 'var(--text-muted)',
                    }}>
                        ✓ {visited ? t('visited.visited') : t('visited.markVisited')}
                    </button>
                </div>
                <RatingStars value={rating} onChange={v => { setRating(v); setRatingSaved(false) }} />
                <textarea placeholder={t('visited.commentPlaceholder')} value={comment}
                    onChange={e => { setComment(e.target.value); setRatingSaved(false) }}
                    rows={2}
                    style={{
                        width: '100%', boxSizing: 'border-box', marginTop: 6, padding: 6,
                        border: '1px solid var(--border)', borderRadius: 6, fontSize: 13,
                        background: 'var(--surface-raised)', resize: 'vertical', fontFamily: 'inherit',
                    }} />
                <button onClick={saveRating}
                    disabled={rating === 0 && !comment.trim() && !visited}
                    style={{
                        marginTop: 6, padding: '5px 12px', fontSize: 13, border: 'none',
                        borderRadius: 6, cursor: 'pointer',
                        background: 'var(--accent)', color: 'var(--surface)',
                        opacity: rating === 0 && !comment.trim() && !visited ? 0.5 : 1,
                    }}>
                    {ratingSaved ? `✓ ${t('common.save')}` : t('common.save')}
                </button>
            </div>
        </div>
    )
}
