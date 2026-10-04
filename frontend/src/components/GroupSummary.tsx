// Состав группы поездки — показывается в панели бронирования,
// чтобы пользователь бронировал на нужное число человек.
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'

interface Props {
    adults: number
    children: number
}

export default function GroupSummary({ adults, children }: Props) {
    const { t } = useTranslation()
    const parts = [t('booking.adults', { count: adults })]
    if (children > 0) parts.push(t('booking.children', { count: children }))
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Users size={16} style={{ color: 'var(--ink-3)' }} />
            {parts.join(', ')}
        </span>
    )
}
