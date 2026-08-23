import { useTranslation } from 'react-i18next'
import type { TripDay } from '../api/days'
import { formatMoney } from '../utils/money'
import { dayLabelShort } from '../utils/dayLabel'

// S13: бюджет в превью чужой поездки — ТОЛЬКО активности из стопов
// (рестораны + достопримечательности), без статей трат/жилья и без owner-ручки
// бюджета (она приватная). Сумма = Σ estimated_cost стопов; null не считается.
interface Props {
    days: TripDay[]
    currency?: string
}

function daySum(day: TripDay): number {
    return day.stops
        .filter(s => s.included_in_route)
        .reduce((acc, s) => acc + (s.estimated_cost ? parseFloat(s.estimated_cost) : 0), 0)
}

export default function PreviewBudget({ days, currency }: Props) {
    const { t, i18n } = useTranslation()
    const cur = currency ?? 'EUR'
    const total = days.reduce((acc, d) => acc + daySum(d), 0)
    const fmt = (v: number) => formatMoney(String(v.toFixed(2)), cur, i18n.language)

    const row: React.CSSProperties = {
        display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0',
    }

    return (
        <div style={{ padding: 16 }}>
            <div style={row}>
                <span>{t('budget.activities')}</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>≈ {fmt(total)}</strong>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 12px' }}>
                {t('preview.budgetHint')}
            </p>
            {days.filter(d => daySum(d) > 0).map(d => (
                <div key={d.id} style={row}>
                    <span>{dayLabelShort(d, t)}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>≈ {fmt(daySum(d))}</span>
                </div>
            ))}
            {total === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('preview.noBudget')}</p>
            )}
        </div>
    )
}
