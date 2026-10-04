import { useTranslation } from 'react-i18next'
import { BadgeCheck } from 'lucide-react'
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
        <div style={{ background: 'var(--moss-wash)', borderRadius: 'var(--radius-lg)', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15.5, fontWeight: 700, color: 'var(--moss-2)', marginBottom: 4 }}>
                <BadgeCheck size={19} />{t('booking.confirmed')}
            </div>
            <div style={{ fontSize: 14 }}>
                {t('booking.refLabel')} <strong>{booking.external_id ?? booking.id.slice(0, 8)}</strong>
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                {t('booking.viaProvider', { provider: booking.provider })}
            </div>
            <PriceSummary amount={booking.amount} currency={booking.currency} />
            <button type="button" onClick={onCancel} className="btn btn-sm btn-danger" style={{ marginTop: 6, marginLeft: -12 }}>
                {t('booking.cancelBooking')}
            </button>
        </div>
    )
}
