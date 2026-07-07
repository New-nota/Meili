// Стоимость брони. На этапе deep-link цену знает только сайт партнёра,
// поэтому до подтверждения показываем подсказку, после — сумму из брони.
interface Props {
    amount: string | null
    currency: string | null
}

export default function PriceSummary({ amount, currency }: Props) {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 13, color: '#374151', padding: '6px 0',
        }}>
            <span>💰</span>
            {amount
                ? <strong>{amount} {currency ?? ''}</strong>
                : <span style={{ color: '#9ca3af' }}>цена — на сайте партнёра</span>}
        </div>
    )
}
