import type { Stop } from '../types'
import type { RouteLeg } from '../api/trips'

// Редизайн «Лес»: время прибытия к каждой точке и конец дня.
// Считается только из того, что посчитала система: старт дня + перегоны
// Valhalla + время на точках. Нет маршрута — нет и времени (null), а не
// выдуманные «09:00, 10:00, 11:00».

const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
}
const clock = (min: number) => {
    const m = Math.round(min) % (24 * 60)
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export interface DaySchedule {
    arrive: Record<string, string>   // stop.id -> «HH:MM»
    finish: string
}

export function daySchedule(
    startTime: string,
    stops: Pick<Stop, 'id' | 'duration_minutes'>[],
    legs: RouteLeg[] | null | undefined,
): DaySchedule | null {
    if (!legs || stops.length === 0) return null
    let t = toMin(startTime)
    // перегон от старта дня до первой точки (есть, только если старт задан)
    const fromDepot = legs.find(l => l.from_stop_id === null && l.to_stop_id === stops[0].id)
    if (fromDepot) t += fromDepot.duration_seconds / 60
    const arrive: Record<string, string> = {}
    for (const s of stops) {
        arrive[s.id] = clock(t)
        t += s.duration_minutes
        const leg = legs.find(l => l.from_stop_id === s.id)
        if (leg) t += leg.duration_seconds / 60
    }
    return { arrive, finish: clock(t) }
}

type CostFields = Pick<
    Stop,
    'included_in_route' | 'estimated_cost' | 'cost_source' | 'cost_min' | 'cost_max' | 'cost_is_estimate' | 'place_pricing_model'
> & Partial<Pick<Stop, 'booked_amount'>>

export interface DayCost {
    min: number
    max: number
    approx: boolean   // есть оценки или диапазоны -> рисуем «≈»
    priced: number    // сколько точек с известной ценой (бесплатно тоже известно)
    missing: number   // «цена не указана» — не ноль, а отдельный счётчик
}

/** Сумма дня по тем же правилам, что бюджет и ярлык стопа (utils/costLabel):
 *  факт брони > диапазон Meili > оценка/ручная сумма; null — не ноль.
 *  «Не влезло в день» не считается, кроме подтверждённой брони. */
export function dayCost(stops: CostFields[]): DayCost {
    const acc: DayCost = { min: 0, max: 0, approx: false, priced: 0, missing: 0 }
    for (const s of stops) {
        if (!s.included_in_route && !s.booked_amount) continue
        if (s.booked_amount) {
            const v = parseFloat(s.booked_amount)
            acc.min += v; acc.max += v; acc.priced++
        } else if (s.cost_min && s.cost_max) {
            acc.min += parseFloat(s.cost_min); acc.max += parseFloat(s.cost_max)
            acc.approx = true; acc.priced++
        } else if (s.estimated_cost != null) {
            const v = parseFloat(s.estimated_cost)
            acc.min += v; acc.max += v; acc.priced++
            if (s.cost_is_estimate || s.cost_source === 'auto' || s.cost_source === 'estimate') acc.approx = acc.approx || v > 0
        } else if (s.cost_source === 'auto' && s.place_pricing_model === 'free') {
            acc.priced++
        } else {
            acc.missing++
        }
    }
    return acc
}
