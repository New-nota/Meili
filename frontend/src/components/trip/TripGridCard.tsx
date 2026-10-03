import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Trip } from '../../types'
import { formatMoney } from '../../utils/money'
import { formatDateRange, tripDaysCount } from './tripRowUtils'

// S17: карточка поездки в сетке Discover — коротко о главном:
// даты, сколько дней, сколько людей, бюджет. Крестик удаления — в правом
// верхнем углу ячейки, поверх карточки.
interface Props {
    trip: Trip
    onOpen: (id: string) => void
    onDelete: (id: string) => void
}

export default function TripGridCard({ trip, onOpen, onDelete }: Props) {
    const { t, i18n } = useTranslation()
    const days = tripDaysCount(trip)
    const people = trip.adults_count + trip.children_count
    const range = formatDateRange(trip.start_date, trip.end_date, i18n.language)
    const budget = trip.budget_total && parseFloat(trip.budget_total) > 0
        ? formatMoney(trip.budget_total, trip.currency, i18n.language)
        : null

    const chip: React.CSSProperties = {
        fontSize: 12, color: 'var(--text-muted)', display: 'flex',
        alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
    }

    return (
        <div onClick={() => onOpen(trip.id)}
            style={{
                position: 'relative', padding: 16, borderRadius: 12,
                border: '1px solid var(--border)', background: 'var(--surface-raised)',
                cursor: 'pointer', transition: 'box-shadow .15s',
                display: 'flex', flexDirection: 'column', gap: 6,
            }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 10px color-mix(in srgb, var(--text-primary) 12%, transparent)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>

            {/* удаление — в правом верхнем углу ячейки */}
            <button
                aria-label={t('trip.deleteTrip')}
                title={t('trip.deleteTrip')}
                onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(trip.id) }}
                style={{
                    position: 'absolute', top: 8, right: 8, padding: 2, lineHeight: 0,
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                <X size={16} />
            </button>

            <strong style={{ fontSize: 15, paddingRight: 22 }}>
                {trip.title || t('common.untitled')}
            </strong>
            {trip.city && (
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>📍 {trip.city}</span>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 2 }}>
                {range && <span style={chip}>📅 {range}</span>}
                {days > 0 && <span style={chip}>{t('profile.meta.days', { count: days })}</span>}
                <span style={chip}>👥 {people}</span>
                {budget && (
                    <span style={{ ...chip, fontVariantNumeric: 'tabular-nums' }}>💰 {budget}</span>
                )}
            </div>
        </div>
    )
}
