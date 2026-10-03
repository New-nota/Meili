import { useState } from 'react'
import { clampInt } from '../utils/limits'

// QA: целочисленное поле с границами. Раньше числовые инпуты жили как
// `onChange={e => set(Math.max(1, parseInt(v) || 1))}` — поле нельзя было
// очистить (стёр «1» — тут же снова «1», дописал «3» — стало «13»), а
// верхней границы не было вовсе: «99999» в «детях» рисовало 99999 полей
// возраста и вешало вкладку. Здесь текст живёт локально, наружу уходит
// только валидное число в [min, max], на blur поле приводится к нему.

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'type'> {
    value: number
    min: number
    max: number
    onChange: (value: number) => void
}

export default function IntInput({ value, min, max, onChange, onBlur, ...rest }: Props) {
    const [text, setText] = useState(String(value))
    // внешнее значение поменялось (кнопки +/-, загрузка) — синхронизируем
    // прямо в рендере (рекомендованный React паттерн вместо эффекта)
    const [seen, setSeen] = useState(value)
    if (seen !== value) {
        setSeen(value)
        setText(String(value))
    }

    return (
        <input {...rest} type="number" inputMode="numeric" min={min} max={max} step={1}
            value={text}
            onChange={e => {
                const raw = e.target.value
                setText(raw)
                if (raw.trim() === '') return  // даём стереть и набрать заново
                const n = clampInt(raw, min, max, value)
                if (n !== value) onChange(n)
            }}
            onBlur={e => {
                const n = clampInt(text, min, max, value)
                setText(String(n))
                if (n !== value) onChange(n)
                onBlur?.(e)
            }} />
    )
}
