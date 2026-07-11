import { useTranslation } from 'react-i18next'
import type { Booking } from '../api/bookings'
import PriceSummary from './PriceSummary'

// Итог успешной брони: номер подтверждения + сумма.
interface Props {
    booking: Booking
    onCancel: () => void
}

export default function BookingConfirmation({ booking, onCancel }: Props) {
    const { t } = useTranslation()
    return (
        <div style={{
            background: '#ecfdf5', border: '1px solid #10b981',
            borderRadius: 8, padding: 12, marginTop: 8,
        }}>
            <div style={{ fontSize: 14, fontWeight: 'bold', color: '#065f46', marginBottom: 4 }}>
                {t('booking.confirmed')}
            </div>
            <div style={{ fontSize: 13, color: '#374151' }}>
                {t('booking.refLabel')} <strong>{booking.external_id ?? booking.id.slice(0, 8)}</strong>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
                {t('booking.viaProvider', { provider: booking.provider })}
            </div>
            <PriceSummary amount={booking.amount} currency={booking.currency} />
            <button onClick={onCancel} style={{
                marginTop: 8, padding: '4px 10px', background: 'none',
                border: '1px solid #ef4444', color: '#ef4444',
                borderRadius: 6, cursor: 'pointer', fontSize: 12,
            }}>
                {t('booking.cancelBooking')}
            </button>
        </div>
    )
}
