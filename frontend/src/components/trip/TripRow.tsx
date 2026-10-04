import { useTranslation } from 'react-i18next'
import type { Trip } from '../../types'
import { getTripStatus, type TripStatus } from '../../utils/tripStatus'
import { formatMoneyCompact } from '../../utils/money'
import { formatDateRange, metaStyle, rowGrid, tripDaysCount } from './tripRowUtils'

// S16 §2.2: строка маршрута в профиле — без окантовки, во всю ширину блока.
// Grid: точка статуса | название+мета+описание | бюджет | пилюля.

const DOT_COLOR: Record<TripStatus, string> = {
    completed: 'var(--wood)',          // дерево: поездка позади
    draft: 'var(--birch-2)',           // берёза: ещё не расписана
    active: 'var(--moss)',             // мох: поездка живая
}

/** Однострочное описание с многоточием; пустое — не рендерится вовсе. */
export function RowDescription({ text }: { text: string | null }) {
    if (!text) return null
    return (
        <div style={{
            ...metaStyle,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
            {text}
        </div>
    )
}

interface Props {
    trip: Trip
    onOpen: (id: string) => void
}

export default function TripRow({ trip, onOpen }: Props) {
    const { t, i18n } = useTranslation()
    const status = getTripStatus(trip)
    const range = formatDateRange(trip.start_date, trip.end_date, i18n.language)
    const days = tripDaysCount(trip)

    const meta = [
        range,
        days > 0 ? t('profile.meta.days', { count: days }) : null,
        t('profile.meta.stops', { count: trip.stops_count }),
    ].filter(Boolean).join(' · ')

    // бюджет: 0/null не рисуем совсем
    const planned = trip.planned_total ? parseFloat(trip.planned_total) : 0
    const budgetLabel = planned > 0
        ? formatMoneyCompact(trip.planned_total!, trip.currency, i18n.language)
        : null

    return (
        <button
            onClick={() => onOpen(trip.id)}
            className="trip-row"
            style={rowGrid}>
            {/* точка статуса — по базовой линии заголовка */}
            <span aria-hidden="true" style={{
                width: 8, height: 8, borderRadius: '50%', marginTop: 6,
                background: DOT_COLOR[status], display: 'block',
            }} />

            <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 15, display: 'block' }}>
                    {trip.title || t('common.untitled')}
                </span>
                <span style={{ ...metaStyle, display: 'block' }}>
                    {meta}
                    {/* на узком экране бюджет переезжает сюда (см. index.css) */}
                    {budgetLabel && (
                        <span className="trip-row-budget-inline"
                            style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {' · '}{budgetLabel}
                        </span>
                    )}
                </span>
                <RowDescription text={trip.description} />
            </span>

            {budgetLabel && (
                <span className="trip-row-budget" style={{
                    fontVariantNumeric: 'tabular-nums', fontWeight: 500, fontSize: 14,
                }}>
                    {budgetLabel}
                </span>
            )}

            {status !== 'active' && (
                <span style={{
                    fontSize: 12.5, padding: '3px 10px', borderRadius: 999,
                    background: 'var(--birch)', color: 'var(--ink-2)',
                    whiteSpace: 'nowrap',
                }}>
                    {t(`profile.status.${status}`)}
                </span>
            )}
        </button>
    )
}
