// Единый форматтер денег: одна точка для локали и фолбэка валюты.
// Суммы с бэка приходят строками ("25.50") — Numeric наружу строками (CLAUDE.md).
// Intl.NumberFormat недёшев в конструировании — кэшируем по locale+currency
const formatters = new Map<string, Intl.NumberFormat>()

export function formatMoney(
    value: string | number,
    currency: string | null | undefined,
    locale: string,
): string {
    const key = `${locale}|${currency || 'EUR'}`
    let formatter = formatters.get(key)
    if (!formatter) {
        formatter = new Intl.NumberFormat(locale, {
            style: 'currency', currency: currency || 'EUR',
        })
        formatters.set(key, formatter)
    }
    return formatter.format(typeof value === 'string' ? parseFloat(value) : value)
}

// Редизайн «Лес»: в сводках (мета поездки, блок дня) целые суммы без «,00» —
// «45 000 ₽», а не «45 000,00 ₽». Копейки, если они есть, остаются.
const compactFormatters = new Map<string, Intl.NumberFormat>()

export function formatMoneyCompact(
    value: string | number,
    currency: string | null | undefined,
    locale: string,
): string {
    const n = typeof value === 'string' ? parseFloat(value) : value
    if (!Number.isInteger(n)) return formatMoney(n, currency, locale)
    const key = `${locale}|${currency || 'EUR'}`
    let formatter = compactFormatters.get(key)
    if (!formatter) {
        formatter = new Intl.NumberFormat(locale, {
            style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0,
        })
        compactFormatters.set(key, formatter)
    }
    return formatter.format(n)
}
