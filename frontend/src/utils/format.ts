// S16 §4.1: форматирование длительности — одно правило на строку перегона,
// время на точке и сводку дня.

/** `13 мин` / `1 ч 5 мин` / `2 ч` (ровные часы без минут). */
export function formatDuration(
    seconds: number,
    t: (key: string, opts?: Record<string, unknown>) => string,
): string {
    const totalMinutes = Math.max(0, Math.round(seconds / 60))
    if (totalMinutes < 60) return `${totalMinutes} ${t('common.min')}`
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    const h = `${hours} ${t('common.hoursShort')}`
    return minutes === 0 ? h : `${h} ${minutes} ${t('common.min')}`
}

/** Километры с одним знаком: `7,6 км` для ru через Intl. */
export function formatDistance(meters: number, locale: string, kmLabel: string): string {
    const km = meters / 1000
    const num = new Intl.NumberFormat(locale, {
        minimumFractionDigits: 1, maximumFractionDigits: 1,
    }).format(km)
    return `${num} ${kmLabel}`
}
