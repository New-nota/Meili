import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Stop } from '../../types'

// S16 §4.2: «≈ 60 мин на месте». Знак ≈ только пока duration_is_custom=false
// (значение подставлено из места). Как только юзер задал время руками, ≈
// исчезает навсегда — флаг ставит сервер, фронт его не шлёт.

const MIN = 5
const MAX = 720
const STEP = 5

interface Props {
    stop: Stop
    readOnly?: boolean
    onSave: (minutes: number) => void
}

export default function StopDuration({ stop, readOnly, onSave }: Props) {
    const { t } = useTranslation()
    const [editing, setEditing] = useState(false)
    const [value, setValue] = useState(String(stop.duration_minutes))

    const commit = () => {
        setEditing(false)
        const parsed = parseInt(value, 10)
        if (!Number.isFinite(parsed)) return
        const clamped = Math.min(MAX, Math.max(MIN, parsed))
        if (clamped !== stop.duration_minutes) onSave(clamped)
    }

    if (editing) {
        return (
            <input
                type="number" min={MIN} max={MAX} step={STEP} autoFocus
                aria-label={t('planner.stop.editDuration')}
                value={value}
                onChange={e => setValue(e.target.value)}
                onClick={e => e.stopPropagation()}
                onBlur={commit}
                onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); commit() }
                    if (e.key === 'Escape') {
                        e.preventDefault()
                        setValue(String(stop.duration_minutes))
                        setEditing(false)
                    }
                }}
                style={{
                    width: 70, padding: '1px 4px', fontSize: 12,
                    border: '1px solid var(--accent)', borderRadius: 4,
                    background: 'var(--surface-raised)',
                }} />
        )
    }

    const label = t('planner.stop.onSite', {
        duration: `${stop.duration_is_custom ? '' : '≈ '}${stop.duration_minutes} ${t('common.min')}`,
    })

    return (
        <button
            onClick={e => { e.stopPropagation(); if (!readOnly) { setValue(String(stop.duration_minutes)); setEditing(true) } }}
            title={readOnly ? undefined : t('planner.stop.editDuration')}
            style={{
                background: 'none', border: 'none', padding: 0, font: 'inherit',
                fontSize: 12, color: 'var(--text-muted)',
                cursor: readOnly ? 'default' : 'pointer',
            }}>
            {label}
        </button>
    )
}
