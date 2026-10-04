import { afterEach, describe, expect, it, vi } from 'vitest'
import { geocode, inCoverage, placeContext, viewboxAround, type GeocodeHit } from './geocode'

// По миру: поиск в округе города поездки, пусто — по всему миру; покрытие
// маршрутов приходит с бэка, пустое = везде.

const hit = (name: string): GeocodeHit => ({ place_id: 1, display_name: name, lat: '0', lon: '0' })

afterEach(() => vi.unstubAllGlobals())

function mockNominatim(...answers: GeocodeHit[][]) {
    const calls: URLSearchParams[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        calls.push(new URL(url).searchParams)
        return new Response(JSON.stringify(answers[calls.length - 1] ?? []))
    }))
    return calls
}

describe('geocode', () => {
    it('без города поездки — один глобальный запрос', async () => {
        const calls = mockNominatim([hit('Paris')])
        await geocode('Paris', { lang: 'ru' })
        expect(calls).toHaveLength(1)
        expect(calls[0].has('viewbox')).toBe(false)
    })

    it('в поездке — сначала округа города', async () => {
        const calls = mockNominatim([hit('Notre-Dame')])
        const res = await geocode('собор', { lang: 'ru', near: { lat: 48.86, lon: 2.35 } })
        expect(res[0].display_name).toBe('Notre-Dame')
        expect(calls).toHaveLength(1)
        expect(calls[0].get('bounded')).toBe('1')
    })

    it('в округе пусто — ищем по миру (поездка по нескольким городам)', async () => {
        const calls = mockNominatim([], [hit('Versailles')])
        const res = await geocode('Версаль', { lang: 'ru', near: { lat: 48.86, lon: 2.35 } })
        expect(res[0].display_name).toBe('Versailles')
        expect(calls).toHaveLength(2)
        expect(calls[1].has('viewbox')).toBe(false)
    })
})

it('viewbox вокруг точки: minLon,maxLat,maxLon,minLat', () => {
    const [w, n, e, s] = viewboxAround({ lat: 0, lon: 0 }, 111).split(',').map(Number)
    expect([w, n, e, s]).toEqual([-1, 1, 1, -1])
})

it('покрытие: пусто — весь мир, иначе любой из N прямоугольников', () => {
    expect(inCoverage(undefined, 48.86, 2.34)).toBe(true)
    expect(inCoverage([], 48.86, 2.34)).toBe(true)
    const nCities: [number, number, number, number][] = [[54.3, 19.6, 55.35, 23.05], [48.7, 2.1, 49, 2.6]]
    expect(inCoverage(nCities, 48.86, 2.34)).toBe(true)
    expect(inCoverage(nCities, 52.52, 13.4)).toBe(false)
})

it('регион и страна различают тёзок', () => {
    expect(placeContext({ ...hit('Paris'), address: { state: 'Île-de-France', country: 'France' } }))
        .toBe('Île-de-France, France')
    expect(placeContext({ ...hit('Paris'), address: { state: 'Texas', country: 'United States' } }))
        .toBe('Texas, United States')
    expect(placeContext(hit('x'))).toBe('')
})
