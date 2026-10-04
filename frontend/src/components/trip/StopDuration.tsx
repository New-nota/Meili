import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Stop } from '../../types'
import { formatDuration } from '../../utils/format'

// S16 §4.2: «≈ 1 ч на месте». Знак ≈ только пока duration_is_custom=false
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                    type="number" min={MIN} max={MAX} step={STEP} autoFocus
                    className="input input-sm"
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
                    style={{ width: 84, height: 30 }} />
                <span>{t('common.min')}</span>
            </span>
        )
    }

    const label = t('planner.stop.onSite', {
        duration: `${stop.duration_is_custom ? '' : '≈ '}${formatDuration(stop.duration_minutes * 60, t)}`,
    })

    if (readOnly) return <span>{label}</span>
    return (
        <button
            type="button"
            onClick={e => { e.stopPropagation(); setValue(String(stop.duration_minutes)); setEditing(true) }}
            title={t('planner.stop.editDuration')}
            className="inline-edit">
            {label}
        </button>
    )
}
