import { CalendarDays, MapPin, Users, Wallet, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Trip } from '../../types'
import { formatMoneyCompact } from '../../utils/money'
import { formatDateRange, tripDaysCount } from './tripRowUtils'

// S17: карточка поездки в сетке «Мои поездки» — коротко о главном:
// даты, сколько дней, сколько людей, бюджет. Крестик удаления — в правом
// верхнем углу ячейки. Редизайн «Лес»: без рамки, мягкая плитка, иконки вместо
// эмодзи; название первым — даты в строке фактов, а не «кикером» над ним.
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
        ? formatMoneyCompact(trip.budget_total, trip.currency, i18n.language)
        : null

    const fact = (Icon: typeof Users, text: string) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
            <Icon size={15} style={{ color: 'var(--ink-3)' }} />{text}
        </span>
    )

    return (
        <div className="trip-tile">
            {/* вся плитка — ссылка-кнопка; удаление отдельной кнопкой поверх */}
            <button type="button" className="trip-tile-open" onClick={() => onOpen(trip.id)}>
                <strong style={{ fontSize: 18, lineHeight: 1.2, letterSpacing: '-0.01em', paddingRight: 28 }}>
                    {trip.title || t('common.untitled')}
                </strong>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 'auto', paddingTop: 10, fontSize: 13.5, color: 'var(--ink-2)' }}>
                    {fact(CalendarDays, range
                        ? (days > 0 ? `${range}, ${t('profile.meta.days', { count: days })}` : range)
                        : t('profile.status.draft'))}
                    {trip.city && fact(MapPin, trip.city)}
                    {fact(Users, String(people))}
                    {budget && fact(Wallet, budget)}
                </span>
            </button>
            <button type="button" className="icon-btn sm trip-tile-del"
                aria-label={t('trip.deleteTrip')} title={t('trip.deleteTrip')}
                onClick={() => onDelete(trip.id)}>
                <X />
            </button>
        </div>
    )
}
