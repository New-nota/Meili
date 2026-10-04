import { describe, expect, it } from 'vitest'
import { stopCostLabel } from './costLabel'
import { formatMoney } from './money'

// правила ярлыка стоимости (ТЗ-E/ТЗ-Meili) — единые для DayCard/StopDetailPanel
const base = {
    estimated_cost: null as string | null,
    cost_source: 'auto' as const,
    cost_min: null as string | null,
    cost_max: null as string | null,
    cost_is_estimate: false,
    place_pricing_model: null as string | null,
}

describe('formatMoney', () => {
    it('форматирует строку-сумму в валюте', () => {
        const s = formatMoney('25.50', 'EUR', 'ru')
        expect(s).toContain('25,50')
        expect(s).toContain('€')
    })
    it('фолбэк валюты — EUR', () => {
        expect(formatMoney('1.00', null, 'en')).toContain('€')
    })
})

describe('stopCostLabel', () => {
    it('факт брони важнее оценки и диапазона (QA)', () => {
        const label = stopCostLabel(
            { ...base, estimated_cost: '350.50', cost_source: 'manual',
              cost_min: '100.00', cost_max: '200.00', booked_amount: '1200.00' },
            'RUB', 'ru', 'Бесплатно',
        )
        expect(label?.approx).toBe(false)
        expect(label?.text).toContain('1')
        expect(label?.text).toContain('200,00')
        expect(label?.text).not.toContain('≈')
    })

    it('диапазон-оценка приоритетнее суммы', () => {
        const label = stopCostLabel(
            { ...base, estimated_cost: '500.00', cost_min: '400.00', cost_max: '700.00',
              cost_is_estimate: true, cost_source: 'estimate' },
            'EUR', 'ru', 'Бесплатно',
        )
        expect(label?.approx).toBe(true)
        expect(label?.text).toMatch(/^≈ .*400.*–.*700/)
    })

    it('free-место с авто-источником — «Бесплатно», не 0', () => {
        const label = stopCostLabel(
            { ...base, estimated_cost: '0.00', place_pricing_model: 'free' },
            'EUR', 'ru', 'Бесплатно',
        )
        expect(label).toEqual({ text: 'Бесплатно', approx: false })
    })

    it('нет данных — null (вызывающий решает, что рисовать)', () => {
        expect(stopCostLabel(base, 'EUR', 'ru', 'Бесплатно')).toBeNull()
    })

    it('авто и estimate — с «≈», manual и реальный источник — без', () => {
        const auto = stopCostLabel({ ...base, estimated_cost: '20.00' }, 'EUR', 'ru', 'F')
        expect(auto?.text.startsWith('≈ ')).toBe(true)

        const manual = stopCostLabel(
            { ...base, estimated_cost: '20.00', cost_source: 'manual' }, 'EUR', 'ru', 'F')
        expect(manual?.approx).toBe(false)
        expect(manual?.text.startsWith('≈')).toBe(false)

        const real = stopCostLabel(
            { ...base, estimated_cost: '20.00', cost_source: 'price_level' }, 'EUR', 'ru', 'F')
        expect(real?.approx).toBe(false)
    })
})
