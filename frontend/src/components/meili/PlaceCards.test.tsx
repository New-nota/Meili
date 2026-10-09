/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import i18n from '../../i18n'
import PlaceCards from './PlaceCards'
import type { PlaceCard } from '../../api/meili'
import type { TripDay } from '../../api/days'

// meili_upgrade: карточки найденного под ответом Meili
const hostel: PlaceCard = {
    place_id: 'p1', name: 'Хостел Арбат', category: 'hotel', address: 'Арбат, 1',
    tags: ['hostel', 'stars:2'], lat: 55.75, lon: 37.59, is_open_now: true,
}
const cafe: PlaceCard = { place_id: 'p2', name: 'Кафе Пушкин', category: 'cafe', distance_m: 420 }
const day = { id: 'd1', position: 1, title: null } as unknown as TripDay

describe('PlaceCards', () => {
    beforeAll(() => i18n.changeLanguage('ru'))

    it('рисует факты системы: подтип, звёзды, открытость, расстояние', () => {
        const html = renderToStaticMarkup(<PlaceCards places={[hostel, cafe]} />)
        expect(html).toContain('Хостел Арбат')
        expect(html).toContain('хостел')
        expect(html).toContain('2 звезды')
        expect(html).toContain('открыто')
        expect(html).toContain('420 м')
    })

    it('этап B: рейтинг с отзывами, ≈ средний счёт, «номер от», подпись 2ГИС', () => {
        const html = renderToStaticMarkup(<PlaceCards places={[
            { ...cafe, rating: '4.60', rating_count: 231, avg_check: '1750.00', price_currency: 'RUB', price_source: '2gis' },
            { ...hostel, lodging_price_from: '3500.00', price_currency: 'RUB', price_source: '2gis' },
        ]} />)
        expect(html).toContain('4,6')
        expect(html).toContain('(231)')
        expect(html).toMatch(/≈ 1\s?750\s?₽ на человека/)
        expect(html).toMatch(/номер от 3\s?500\s?₽/)
        expect(html).toContain('2ГИС')
    })

    it('без поездки — только карточки, кнопок записи нет', () => {
        const html = renderToStaticMarkup(<PlaceCards places={[hostel, cafe]} tripId={null} />)
        expect(html).not.toContain('В день')
        expect(html).not.toContain('Жильё')
    })

    it('в поездке: отель — «Жильё», остальное — «В день»', () => {
        const html = renderToStaticMarkup(<PlaceCards places={[hostel, cafe]} tripId="t1" days={[day]} />)
        expect(html).toContain('Жильё')
        expect(html).toContain('В день')
    })
})
