import type { PlanAction } from '../api/meili'
import { costLabelCore } from './costLabel'

// Стоимость действий плана Meili (вынесено из PlanPreview: файл компонента
// экспортирует только компоненты — QA, react-refresh/only-export-components).

// M5.2: оценка рисуется иначе — «≈ 400–700», приглушённо; точная — обычно.
// Правило и формат — общие с ярлыком стопа (utils/costLabel)
export function costText(a: PlanAction, locale: string): { text: string; estimate: boolean } | null {
    const label = costLabelCore({
        amount: (a.cost_amount ?? a.amount) as string | undefined,
        min: a.cost_min as string | undefined,
        max: a.cost_max as string | undefined,
        estimate: Boolean(a.cost_is_estimate ?? a.is_estimate),
    }, (a.cost_currency ?? a.currency ?? null) as string | null, locale)
    return label ? { text: label.text, estimate: label.approx } : null
}

// итоговая смета плана: лимит (set_budget) — не расход, оценки помечаются
export function planTotal(rows: { a: PlanAction; cost: ReturnType<typeof costText> }[]) {
    let min = 0, max = 0, hasEstimate = false, hasAny = false, currency = ''
    for (const { a, cost } of rows) {
        if (a.type === 'set_budget' || !cost) continue
        hasAny = true
        hasEstimate = hasEstimate || cost.estimate
        currency = (a.cost_currency ?? a.currency ?? currency) as string
        const lo = parseFloat((a.cost_min ?? a.cost_amount ?? a.amount ?? '0') as string)
        const hi = parseFloat((a.cost_max ?? a.cost_amount ?? a.amount ?? '0') as string)
        if (!isNaN(lo)) min += lo
        if (!isNaN(hi)) max += hi
    }
    return hasAny ? { min, max, hasEstimate, currency } : null
}
