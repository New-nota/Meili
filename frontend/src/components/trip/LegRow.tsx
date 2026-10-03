import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RouteLeg } from '../../api/trips'
import { TRANSPORT_MODES, type TransportMode } from '../../types'
import { formatDuration } from '../../utils/format'

// S16 §4.1: строка перегона между точками — «13 мин пешком ⌄».
// Время только из RouteLeg (расчёт Valhalla, он же в матрице TSPTW):
// ручного ввода нет, иначе показывали бы одно, а оптимизировали по другому.

interface Props {
    leg: RouteLeg | null       // null = маршрут ещё грузится -> скелетон
    loading: boolean
    readOnly?: boolean
    onChangeTransport: (mode: TransportMode) => void
}

export default function LegRow({ leg, loading, readOnly, onChangeTransport }: Props) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)

    // QA: маршрут не построился (Valhalla недоступна / вне покрытия) — раньше
    // тут висел вечный скелетон «загрузки». Теперь честный прочерк.
    if (!loading && !leg) {
        return (
            <div style={{ margin: '2px 0 6px 32px', fontSize: 12, color: 'var(--text-muted)' }}
                title={t('planner.leg.unavailable')}>—</div>
        )
    }
    // скелетон вместо «0 мин» и вместо пустоты
    if (loading || !leg) {
        return (
            <div style={{ margin: '2px 0 6px 32px' }}>
                <span style={{
                    display: 'inline-block', width: 72, height: 12, borderRadius: 6,
                    background: 'var(--surface)', opacity: 0.8,
                }} />
            </div>
        )
    }

    return (
        <div style={{ position: 'relative', margin: '2px 0 6px 32px' }}>
            <button
                onClick={() => !readOnly && setOpen(o => !o)}
                disabled={readOnly}
                style={{
                    background: 'none', border: 'none', padding: 0, font: 'inherit',
                    fontSize: 12, color: 'var(--text-muted)',
                    cursor: readOnly ? 'default' : 'pointer',
                }}>
                {formatDuration(leg.duration_seconds, t)} {t(`planner.leg.${leg.costing}`)}
                {!readOnly && ' ⌄'}
            </button>

            {/* клик мимо меню закрывает его */}
            {open && <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 4 }} />}
            {open && (
                <div style={{
                    position: 'absolute', top: '100%', left: 0, zIndex: 5,
                    background: 'var(--surface-raised)', border: '1px solid var(--border)',
                    borderRadius: 6, boxShadow: '0 4px 12px color-mix(in srgb, var(--text-primary) 15%, transparent)',
                    minWidth: 130,
                }}>
                    {TRANSPORT_MODES.map(mode => (
                        <div key={mode}
                            onClick={() => { setOpen(false); onChangeTransport(mode) }}
                            style={{
                                padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                                fontWeight: mode === leg.costing ? 600 : 400,
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            {t(`planner.leg.${mode}`)}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
