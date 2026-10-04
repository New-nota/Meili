// QA: те же потолки, что у бэкенда (backend/app/schemas/common.py) —
// фронт режет ввод заранее, а не ждёт 422
export const MAX_GROUP = 50
// Numeric(10,2)
export const MAX_MONEY = 99_999_999.99
export const MONEY_RE = /^\d+([.,]\d{1,2})?$/

// целое в [min, max]; мусор -> fallback (см. components/IntInput)
export const clampInt = (raw: string | number, min: number, max: number, fallback: number): number => {
    const n = typeof raw === 'number' ? raw : parseInt(raw, 10)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, Math.trunc(n)))
}
