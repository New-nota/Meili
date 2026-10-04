import { Star } from 'lucide-react'

// S15: пять звёзд оценки места — общий контрол панели стопа и вечернего опроса
interface Props {
    value: number            // 0 = не выбрано
    onChange: (v: number) => void
    size?: number
}

export default function RatingStars({ value, onChange, size = 24 }: Props) {
    return (
        <div role="radiogroup" style={{ display: 'flex', gap: 2 }}>
            {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" role="radio" aria-checked={n === value} aria-label={String(n)}
                    onClick={() => onChange(n === value ? 0 : n)}
                    style={{ background: 'none', border: 0, padding: 2, cursor: 'pointer', lineHeight: 0,
                        color: n <= value ? 'var(--warn)' : 'var(--birch-2)' }}>
                    <Star size={size} fill={n <= value ? 'currentColor' : 'none'} strokeWidth={1.8} />
                </button>
            ))}
        </div>
    )
}
