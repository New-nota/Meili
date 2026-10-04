// Стоимость брони. На этапе deep-link цену знает только сайт партнёра,
// поэтому до подтверждения показываем подсказку, после — сумму из брони.
import { useTranslation } from 'react-i18next'
import { Wallet } from 'lucide-react'
import { formatMoney } from '../utils/money'

interface Props {
    amount: string | null
    currency: string | null
}

export default function PriceSummary({ amount, currency }: Props) {
    const { t, i18n } = useTranslation()
    const formatted = amount ? formatMoney(amount, currency, i18n.language) : null
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, padding: '4px 0' }}>
            <Wallet size={16} style={{ color: 'var(--ink-3)' }} />
            {formatted
                ? <strong>{formatted}</strong>
                : <span style={{ color: 'var(--ink-3)' }}>{t('booking.priceAtPartner')}</span>}
        </div>
    )
}
