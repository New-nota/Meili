import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Stop } from '../types/index'
import {
    PROVIDERS, createBooking, confirmBooking, cancelBooking, listBookings,
    type Booking,
} from '../api/bookings'
import { updateStop } from '../api/trips'
import GroupSummary from './GroupSummary'
import PriceSummary from './PriceSummary'
import AvailabilityCalendar from './AvailabilityCalendar'
import BookingConfirmation from './BookingConfirmation'

// Детали остановки + флоу бронирования (deep-link):
// нет брони -> выбор даты и провайдера -> pending (открыт сайт партнёра)
// -> пользователь вводит номер брони -> confirmed.
interface Props {
    stop: Stop
    trip: { adults_count?: number; children_count?: number } | null
    onClose: () => void
    onChanged: () => void // перезагрузить остановки (is_booked)
}

export default function StopDetailPanel({ stop, trip, onClose, onChanged }: Props) {
    const { t } = useTranslation()
    const [booking, setBooking] = useState<Booking | null>(null)
    const [visitDate, setVisitDate] = useState<string | null>(stop.visit_date)
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

    const saveCost = async () => {
        // S9 WP-A: оценка стоимости активности -> живой пересчёт бюджета
        await updateStop(stop.trip_id, stop.id, { estimated_cost: costInput || null })
        onChanged()
    }

    const handleDateChange = async (date: string) => {
        setVisitDate(date)
        try {
            await updateStop(stop.trip_id, stop.id, { visit_date: date })
        } catch { /* не критично, дата уйдёт вместе с бронью */ }
    }

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
            <AvailabilityCalendar value={visitDate} onChange={handleDateChange} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '4px 0' }}>
                <span>💶</span>
                <input placeholder={t('budget.estimatedCost')} value={costInput} inputMode="decimal"
                    onChange={e => setCostInput(e.target.value)} onBlur={saveCost}
                    style={{ width: 120, padding: 4, border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
            </label>

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
        </div>
    )
}
