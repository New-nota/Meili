import i18n from 'i18next'
import type { TFunction } from 'i18next'
import { ApiError } from '../api/client'

// QA: единая точка «ошибка API → текст для юзера». Раньше каждый экран
// разбирал ошибку по-своему, и почти всё, кроме машинных кодов, падало в
// безликое «Что-то пошло не так»: 422 от Pydantic (невалидный email, пустое
// название), лежащий бэкенд (fetch бросает TypeError, а не ApiError), 429,
// 5xx. Порядок: машинный код с бэка (errors.<code>) → 422 с полями →
// по статусу → fallback экрана.

type ValidationItem = { loc?: unknown[]; msg?: string }

export function apiErrorMessage(e: unknown, t: TFunction, fallback?: string): string {
    const fb = fallback ?? t('common.error')
    if (!(e instanceof ApiError)) {
        // fetch падает TypeError'ом, когда бэк недоступен / оборвалась сеть
        return e instanceof TypeError ? t('errors.network') : fb
    }
    const detail = (e.body as { detail?: unknown } | null)?.detail
    if (typeof detail === 'string' && i18n.exists(`errors.${detail}`)) {
        return t(`errors.${detail}`)
    }
    if (e.status === 422 && Array.isArray(detail)) {
        const fields = [...new Set(
            (detail as ValidationItem[])
                .map(d => d.loc?.[d.loc.length - 1])
                .filter((f): f is string => typeof f === 'string'),
        )]
        if (fields.length) {
            const labels = fields.map(f => t(`fields.${f}`, { defaultValue: f }))
            return t('errors.validation', { fields: labels.join(', ') })
        }
    }
    if (e.status === 429) return t('errors.too_many_requests')
    if (e.status === 403) return t('errors.forbidden')
    if (e.status === 404) return t('errors.not_found')
    if (e.status >= 500) return t('errors.server')
    return fb
}
