import type { Stop } from '../types'
import { formatMoney } from './money'

// Ярлык стоимости стопа (ТЗ-E/ТЗ-Meili) — единые правила для DayCard,
// StopDetailPanel и любых будущих мест:
//   «≈ min–max» — диапазон-оценка Meili (приоритетнее суммы)
//   freeText    — бесплатное место с авто-источником (0.00 ≠ «нет данных»)
//   «≈ сумма»   — оценка (auto/estimate/cost_is_estimate)
//   «сумма»     — точная (manual, реальный источник)
//   null        — нет данных: вызывающий скрывает или пишет «цена не указана»
export interface CostLabel {
    text: string
    approx: boolean
}

// Ядро форматирования: диапазон приоритетнее суммы, оценка получает «≈».
// Им пользуются и ярлык стопа, и costText плана (PlanPreview) — одно правило.
export function costLabelCore(
    parts: { amount?: string | null; min?: string | null; max?: string | null; estimate: boolean },
    currency: string | null | undefined,
    locale: string,
): CostLabel | null {
    const fmt = (v: string) => formatMoney(v, currency, locale)
    if (parts.min && parts.max)
        return { text: `≈ ${fmt(parts.min)}–${fmt(parts.max)}`, approx: true }
    if (!parts.amount) return null
    return { text: `${parts.estimate ? '≈ ' : ''}${fmt(parts.amount)}`, approx: parts.estimate }
}

type CostFields = Pick<
    Stop,
    'estimated_cost' | 'cost_source' | 'cost_min' | 'cost_max' | 'cost_is_estimate' | 'place_pricing_model'
>

export function stopCostLabel(
    stop: CostFields,
    currency: string | null | undefined,
    locale: string,
    freeText: string,
): CostLabel | null {
    if (!(stop.cost_min && stop.cost_max)
        && stop.cost_source === 'auto' && stop.place_pricing_model === 'free')
        return { text: freeText, approx: false }
    return costLabelCore({
        amount: stop.estimated_cost,
        min: stop.cost_min,
        max: stop.cost_max,
        estimate: stop.cost_is_estimate
            || stop.cost_source === 'auto' || stop.cost_source === 'estimate',
    }, currency, locale)
}
