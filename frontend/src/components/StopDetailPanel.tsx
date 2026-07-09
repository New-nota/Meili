import { useEffect, useState } from 'react'
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
            setError('Не удалось создать бронь')
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
            setError('Не удалось подтвердить бронь')
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
                color: '#3b82f6', fontSize: 13, padding: 0, marginBottom: 12,
            }}>
                ← Назад к маршруту
            </button>

            <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>
                {stop.place_name || 'Без названия'}
            </h3>
            {stop.place_address && (
                <p style={{ margin: '0 0 8px', fontSize: 12, color: '#6b7280' }}>
                    {stop.place_address}
                </p>
            )}

            <GroupSummary
                adults={trip?.adults_count ?? 1}
                children={trip?.children_count ?? 0}
            />
            <AvailabilityCalendar value={visitDate} onChange={handleDateChange} />

            {error && <p style={{ color: 'red', fontSize: 13 }}>{error}</p>}

            {/* нет активной брони — выбор провайдера */}
            {!booking && (
                <div style={{ marginTop: 8 }}>
                    <PriceSummary amount={null} currency={null} />
                    <div style={{ fontSize: 13, fontWeight: 'bold', margin: '8px 0 6px' }}>
                        Забронировать через:
                    </div>
                    {PROVIDERS.map(p => (
                        <button key={p.value} disabled={busy} onClick={() => handleBook(p.value)}
                            style={{
                                display: 'block', width: '100%', textAlign: 'left',
                                padding: '8px 12px', marginBottom: 6,
                                background: 'white', border: '1px solid #e5e7eb',
                                borderRadius: 8, cursor: busy ? 'wait' : 'pointer', fontSize: 13,
                            }}>
                            <strong>{p.label}</strong>
                            <span style={{ color: '#9ca3af' }}> — {p.hint}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* бронь создана — ждём подтверждения от пользователя */}
            {booking && booking.status === 'pending' && (
                <div style={{
                    background: '#fffbeb', border: '1px solid #f59e0b',
                    borderRadius: 8, padding: 12, marginTop: 8,
                }}>
                    <div style={{ fontSize: 13, marginBottom: 8 }}>
                        Бронь через <strong>{booking.provider}</strong> создана.
                        {booking.deep_link && (
                            <>
                                {' '}
                                <a href={booking.deep_link} target="_blank" rel="noopener noreferrer"
                                    style={{ color: '#3b82f6' }}>
                                    Открыть сайт партнёра ↗
                                </a>
                            </>
                        )}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
                        Забронировали? Введите номер подтверждения:
                    </div>
                    <input placeholder="Номер брони (опц.)" value={refInput}
                        onChange={e => setRefInput(e.target.value)}
                        style={{
                            width: '100%', padding: 6, marginBottom: 6, boxSizing: 'border-box',
                            border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13,
                        }} />
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        <input placeholder="Сумма (опц.)" value={amountInput} inputMode="decimal"
                            onChange={e => setAmountInput(e.target.value)}
                            style={{
                                flex: 1, padding: 6, boxSizing: 'border-box',
                                border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13,
                            }} />
                        <select value={currency} onChange={e => setCurrency(e.target.value)}
                            style={{
                                padding: 6, border: '1px solid #e5e7eb',
                                borderRadius: 6, fontSize: 13, background: 'white',
                            }}>
                            {['EUR', 'USD', 'RUB'].map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={handleConfirm} disabled={busy} style={{
                            padding: '6px 12px', background: '#10b981', color: 'white',
                            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                        }}>
                            ✓ Подтвердить
                        </button>
                        <button onClick={handleCancel} disabled={busy} style={{
                            padding: '6px 12px', background: 'none', color: '#6b7280',
                            border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                        }}>
                            Отменить
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
