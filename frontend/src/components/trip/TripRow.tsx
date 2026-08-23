import { useTranslation } from 'react-i18next'
import type { Trip } from '../../types'
import { getTripStatus, type TripStatus } from '../../utils/tripStatus'
import { formatMoney } from '../../utils/money'

// S16 §2.2: строка маршрута в профиле — без окантовки, во всю ширину блока.
// Grid: точка статуса | название+мета+описание | бюджет | пилюля.

const DOT_COLOR: Record<TripStatus, string> = {
    completed: 'var(--accent)',        // терракота
    draft: 'var(--text-muted)',        // нейтральный серый
    active: '#6E8F5E',                 // зелёный: поездка живая
}

/** «12–15 июля» — месяц пишем один раз, если он общий. */
export function formatDateRange(
    start: string | null, end: string | null, locale: string,
): string | null {
    if (!start) return null
    const from = new Date(start + 'T00:00:00')
    const to = end ? new Date(end + 'T00:00:00') : null
    const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric' })
    const fullFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' })
    if (!to || start === end) return fullFmt.format(from)
    const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()
    return sameMonth
        ? `${dayFmt.format(from)}–${fullFmt.format(to)}`
        : `${fullFmt.format(from)} – ${fullFmt.format(to)}`
}

/** Число дней поездки включительно (для меты). */
export function tripDaysCount(trip: Pick<Trip, 'start_date' | 'end_date'>): number {
    if (!trip.start_date || !trip.end_date) return 0
    const from = new Date(trip.start_date + 'T00:00:00').getTime()
    const to = new Date(trip.end_date + 'T00:00:00').getTime()
    return Math.round((to - from) / 86_400_000) + 1
}

export const rowGrid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '10px 1fr auto auto',
    columnGap: 12,
    alignItems: 'start',
    padding: '16px 20px',
    borderRadius: 12,
    border: 'none',
    background: 'transparent',
    transition: 'background-color 120ms ease-out',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    font: 'inherit',
    color: 'inherit',
}

export const metaStyle: React.CSSProperties = {
    fontSize: 13, color: 'var(--text-muted)', marginTop: 2,
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
        ? formatMoney(trip.planned_total!, trip.currency, i18n.language)
        : null

    return (
        <button
            onClick={() => onOpen(trip.id)}
            className="trip-row"
            style={rowGrid}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
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
                    fontSize: 12, padding: '2px 10px', borderRadius: 12,
                    background: 'var(--surface)', color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                }}>
                    {t(`profile.status.${status}`)}
                </span>
            )}
        </button>
    )
}
