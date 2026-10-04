import { Minus, Plus } from 'lucide-react'

// Редизайн «Лес»: «− 2 +» для состава группы — один вид в настройках и мастере.
interface Props {
    value: number
    min: number
    max: number
    onChange: (value: number) => void
    label: string           // для скринридера: «Взрослые»
}

export default function Stepper({ value, min, max, onChange, label }: Props) {
    return (
        <div role="group" aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'var(--birch)', borderRadius: 999, padding: 3 }}>
            <button type="button" className="icon-btn sm" disabled={value <= min} aria-label={`${label}: −1`}
                onClick={() => onChange(Math.max(min, value - 1))} style={{ background: 'var(--raised)' }}>
                <Minus />
            </button>
            <span aria-live="polite" style={{ minWidth: 28, textAlign: 'center', fontSize: 16, fontWeight: 700 }}>{value}</span>
            <button type="button" className="icon-btn sm" disabled={value >= max} aria-label={`${label}: +1`}
                onClick={() => onChange(Math.min(max, value + 1))} style={{ background: 'var(--raised)' }}>
                <Plus />
            </button>
        </div>
    )
}
