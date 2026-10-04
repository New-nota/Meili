import type { Trip } from '../../types'

// Хелперы строк поездки (S16 §2.2). Отдельно от компонентов: файл с
// компонентом должен экспортировать только компоненты, иначе Vite Fast
// Refresh перезагружает страницу целиком (QA: react-refresh/only-export-components).

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
    borderRadius: 16,
    border: 'none',
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
