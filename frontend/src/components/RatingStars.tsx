// S15: пять звёзд оценки места — общий контрол панели стопа и вечернего опроса
interface Props {
    value: number            // 0 = не выбрано
    onChange: (v: number) => void
    size?: number
}

export default function RatingStars({ value, onChange, size = 22 }: Props) {
    return (
        <div style={{ display: 'flex', gap: 2 }}>
            {[1, 2, 3, 4, 5].map(n => (
                <span key={n} onClick={() => onChange(n === value ? 0 : n)}
                    style={{
                        fontSize: size, cursor: 'pointer', userSelect: 'none', lineHeight: 1,
                        color: n <= value ? 'var(--accent)' : 'var(--border)',
                    }}>
                    ★
                </span>
            ))}
        </div>
    )
}
