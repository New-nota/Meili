// S9 WP-E: формат метки точки и toggle-логика карточки.
import { describe, expect, it } from 'vitest'
import { formatPlaceLabel, nextClickedPoint, type ClickedPoint } from './mapPoint'

describe('formatPlaceLabel', () => {
    it('POI показывается по названию (namedetails)', () => {
        expect(formatPlaceLabel({
            namedetails: { name: 'Кафедральный собор' },
            address: { road: 'улица Канта', house_number: '1' },
        })).toBe('Кафедральный собор')
    })

    it('POI по классу tourism с name', () => {
        expect(formatPlaceLabel({
            class: 'tourism', name: 'Музей янтаря',
            address: { road: 'площадь Василевского' },
        })).toBe('Музей янтаря')
    })

    it('адрес в порядке «улица дом», с городом', () => {
        expect(formatPlaceLabel({
            address: { road: 'Римская улица', house_number: '3а', city: 'Калининград' },
        })).toBe('Римская улица 3а, Калининград')
    })

    it('улица без дома', () => {
        expect(formatPlaceLabel({
            address: { road: 'Ленинский проспект', town: 'Светлогорск' },
        })).toBe('Ленинский проспект, Светлогорск')
    })

    it('без road — фолбэк на значимый компонент', () => {
        expect(formatPlaceLabel({
            address: { suburb: 'Амалиенау', city: 'Калининград' },
        })).toBe('Амалиенау')
    })

    it('совсем пусто — координаты', () => {
        expect(formatPlaceLabel({}, 54.71, 20.51)).toBe('54.71000, 20.51000')
    })

    it('обычный класс (highway) НЕ считается POI', () => {
        expect(formatPlaceLabel({
            class: 'highway', name: 'A-229',
            address: { road: 'Московский проспект', city: 'Калининград' },
        })).toBe('Московский проспект, Калининград')
    })
})

describe('nextClickedPoint (toggle как в Google Maps)', () => {
    const point: ClickedPoint = {
        lat: 54.7, lng: 20.5, label: 'X', address: null, osmId: null,
    }

    it('клик при закрытой карточке открывает её', () => {
        expect(nextClickedPoint(null, point)).toEqual(point)
    })

    it('повторный клик по пустой карте закрывает карточку, пин не ставится', () => {
        const other: ClickedPoint = { ...point, lat: 54.8, label: 'Y' }
        expect(nextClickedPoint(point, other)).toBeNull()
    })
})
