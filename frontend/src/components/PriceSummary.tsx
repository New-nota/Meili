// Стоимость брони. На этапе deep-link цену знает только сайт партнёра,
// поэтому до подтверждения показываем подсказку, после — сумму из брони.
import { useTranslation } from 'react-i18next'

interface Props {
    amount: string | null
    currency: string | null
}

export default function PriceSummary({ amount, currency }: Props) {
    const { t, i18n } = useTranslation()
    const formatted = amount
        ? new Intl.NumberFormat(i18n.language, {
            style: 'currency', currency: currency || 'EUR',
          }).format(parseFloat(amount))
        : null
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 13, color: 'var(--text-primary)', padding: '6px 0',
        }}>
            <span>💰</span>
            {formatted
                ? <strong>{formatted}</strong>
                : <span style={{ color: 'var(--text-muted)' }}>{t('booking.priceAtPartner')}</span>}
        </div>
    )
}
