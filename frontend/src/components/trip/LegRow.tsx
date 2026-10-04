import { useTranslation } from 'react-i18next'
import { Car, ChevronDown, Footprints, TramFront } from 'lucide-react'
import type { RouteLeg } from '../../api/trips'
import { TRANSPORT_MODES, type TransportMode } from '../../types'
import { formatDistance, formatDuration } from '../../utils/format'
import Menu from '../ui/Menu'

// S16 §4.1: строка перегона между точками — «13 мин пешком · 1,1 км ⌄».
// Время только из RouteLeg (расчёт Valhalla, он же в матрице TSPTW):
// ручного ввода нет, иначе показывали бы одно, а оптимизировали по другому.
// Редизайн «Лес»: слева пунктир-«тропа» цвета интерфейса (на машине — сплошная),
// смена способа — общим меню.

const MODE_ICON: Record<TransportMode, typeof Footprints> = {
    walking: Footprints, driving: Car, transit: TramFront,
}

interface Props {
    leg: RouteLeg | null       // null = маршрут ещё грузится -> скелетон
    loading: boolean
    readOnly?: boolean
    columns: string            // сетка строки стопа — тропа встаёт ровно под номер
    railColumn: number
    onChangeTransport: (mode: TransportMode) => void
}

export default function LegRow({ leg, loading, readOnly, columns, railColumn, onChangeTransport }: Props) {
    const { t, i18n } = useTranslation()
    const solid = leg?.costing === 'driving'
    const rail = (
        <span aria-hidden="true" style={{
            gridColumn: railColumn, justifySelf: 'center', width: 4, alignSelf: 'stretch', minHeight: 30,
            background: solid
                ? 'linear-gradient(var(--moss), var(--moss)) center / 2px 100% no-repeat'
                : 'radial-gradient(circle, var(--moss) 1.6px, transparent 1.9px) center top / 4px 8px repeat-y',
        }} />
    )
    const wrap = (content: React.ReactNode) => (
        <div style={{ display: 'grid', gridTemplateColumns: columns, columnGap: 10, alignItems: 'center', padding: '0 8px' }}>
            {rail}
            <div style={{ gridColumn: `${railColumn + 1} / -1`, minWidth: 0 }}>{content}</div>
        </div>
    )

    // QA: маршрут не построился (Valhalla недоступна / вне покрытия) — раньше
    // тут висел вечный скелетон «загрузки». Теперь честный прочерк.
    if (!loading && !leg) {
        return wrap(<span title={t('planner.leg.unavailable')} style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>—</span>)
    }
    // скелетон вместо «0 мин» и вместо пустоты
    if (loading || !leg) {
        return wrap(<span style={{ display: 'inline-block', width: 132, height: 12, borderRadius: 6, background: 'var(--birch)' }} />)
    }

    const Icon = MODE_ICON[leg.costing] ?? Footprints
    const text = `${formatDuration(leg.duration_seconds, t)} ${t(`planner.leg.${leg.costing}`)} · ${formatDistance(leg.distance_meters, i18n.language, t('common.km'))}`
    const look: React.CSSProperties = {
        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: 'var(--ink-2)',
        padding: '4px 10px', marginLeft: -10, borderRadius: 999, background: 'none', border: 0,
    }
    if (readOnly) return wrap(<span style={look}><Icon size={15} />{text}</span>)

    return wrap(
        <Menu label={t('planner.leg.change')}
            items={TRANSPORT_MODES.map(mode => {
                const MIcon = MODE_ICON[mode]
                return {
                    label: t(`planner.leg.${mode}`), icon: <MIcon />,
                    checked: mode === leg.costing,
                    onSelect: () => { if (mode !== leg.costing) onChangeTransport(mode) },
                }
            })}
            align="start"
            trigger={props => (
                <button {...props} type="button" title={t('planner.leg.change')} className="leg-btn">
                    <Icon size={15} />{text}<ChevronDown size={14} style={{ color: 'var(--ink-3)' }} />
                </button>
            )} />,
    )
}
