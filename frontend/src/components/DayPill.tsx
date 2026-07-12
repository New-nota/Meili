import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TripDay } from '../api/days'

// Мобильная пилюля переключателя дней поверх карты (S10, ТЗ Meili зад. 6).
// Отражает то же activeDayId, что и аккордеон; активность — заливкой/жирным.
interface Props {
    days: TripDay[]
    activeDayId: string | null
    onSelect: (dayId: string | null) => void
}

export default function DayPill({ days, activeDayId, onSelect }: Props) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    if (days.length === 0) return null

    const active = days.find(d => d.id === activeDayId) ?? null
    const label = active
        ? t('day.title', { num: active.day_index + 1 })
        : t('day.allDays')

    const pick = (id: string | null) => {
        onSelect(id)
        setOpen(false)
    }

    return (
        <div className="day-pill">
            <button onClick={() => setOpen(!open)} style={{
                padding: '7px 14px', borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border)', background: 'var(--surface-raised)',
                color: 'var(--text-primary)', fontWeight: 500, fontSize: 13,
                cursor: 'pointer',
                boxShadow: '0 2px 6px color-mix(in srgb, var(--text-primary) 15%, transparent)',
            }}>
                {label} ▾
            </button>
            {open && (
                <div style={{
                    marginTop: 4, background: 'var(--surface-raised)',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                    overflow: 'hidden', minWidth: 140,
                    boxShadow: '0 4px 12px color-mix(in srgb, var(--text-primary) 18%, transparent)',
                }}>
                    {/* первая строка — «Все дни» (режим overview) */}
                    <div onClick={() => pick(null)} style={{
                        padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                        fontWeight: activeDayId === null ? 700 : 400,
                        background: activeDayId === null ? 'var(--surface)' : 'transparent',
                        borderBottom: '1px solid var(--border)',
                    }}>
                        {t('day.allDays')}
                    </div>
                    {days.map((d, i) => (
                        <div key={d.id} onClick={() => pick(d.id)} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                            fontWeight: d.id === activeDayId ? 700 : 400,
                            background: d.id === activeDayId ? 'var(--surface)' : 'transparent',
                        }}>
                            <span style={{
                                width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                                background: `var(--day-${(i % 6) + 1})`,
                            }} />
                            {t('day.title', { num: d.day_index + 1 })}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
