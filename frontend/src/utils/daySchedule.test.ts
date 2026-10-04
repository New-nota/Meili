import { describe, expect, it } from 'vitest'
import { dayCost, daySchedule } from './daySchedule'
import type { RouteLeg } from '../api/trips'

const leg = (from: string | null, to: string | null, minutes: number): RouteLeg => ({
    from_stop_id: from, to_stop_id: to, duration_seconds: minutes * 60,
    distance_meters: 100, costing: 'walking', geometry: '',
})

describe('daySchedule', () => {
    const stops = [{ id: 'a', duration_minutes: 60 }, { id: 'b', duration_minutes: 30 }]

    it('без маршрута времени нет', () => {
        expect(daySchedule('09:00:00', stops, null)).toBeNull()
    })

    it('старт + время на месте + перегоны', () => {
        const s = daySchedule('09:00:00', stops, [leg('a', 'b', 6)])
        expect(s).toEqual({ arrive: { a: '09:00', b: '10:06' }, finish: '10:36' })
    })

    it('перегон от старта дня и до финиша входят в расписание', () => {
        const s = daySchedule('09:00', stops, [leg(null, 'a', 15), leg('a', 'b', 5), leg('b', null, 10)])
        expect(s).toEqual({ arrive: { a: '09:15', b: '10:20' }, finish: '11:00' })
    })
})

describe('dayCost', () => {
    const base = {
        included_in_route: true, estimated_cost: null, cost_source: 'auto' as const,
        cost_min: null, cost_max: null, cost_is_estimate: false, place_pricing_model: null,
    }

    it('нет данных — не ноль, а счётчик', () => {
        expect(dayCost([base, base])).toEqual({ min: 0, max: 0, approx: false, priced: 0, missing: 2 })
    })

    it('бронь важнее оценки, диапазон даёт min–max, бесплатно — известная цена', () => {
        const c = dayCost([
            { ...base, estimated_cost: '500.00', booked_amount: '1800.00' },
            { ...base, cost_min: '800.00', cost_max: '1100.00', cost_source: 'estimate' },
            { ...base, estimated_cost: '0.00', place_pricing_model: 'free' },
        ])
        expect(c).toEqual({ min: 2600, max: 2900, approx: true, priced: 3, missing: 0 })
    })

    it('«не влезло в день» не считается, кроме подтверждённой брони', () => {
        const c = dayCost([
            { ...base, included_in_route: false, estimated_cost: '700.00' },
            { ...base, included_in_route: false, booked_amount: '300.00' },
        ])
        expect(c.min).toBe(300)
        expect(c.priced).toBe(1)
    })
})
