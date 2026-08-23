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
