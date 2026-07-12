// Состав группы поездки — показывается в панели бронирования,
// чтобы пользователь бронировал на нужное число человек.
import { useTranslation } from 'react-i18next'

interface Props {
    adults: number
    children: number
}

export default function GroupSummary({ adults, children }: Props) {
    const { t } = useTranslation()
    const parts = [t('booking.adults', { count: adults })]
    if (children > 0) parts.push(t('booking.children', { count: children }))
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 13, color: 'var(--text-primary)', padding: '6px 0',
        }}>
            <span>👥</span>
            <span>{parts.join(' · ')}</span>
        </div>
    )
}
