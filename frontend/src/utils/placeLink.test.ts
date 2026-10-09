import { describe, expect, it } from 'vitest'
import { externalPlaceUrl } from './placeLink'

// клик по карточке в чате мастера (карты нет): 2ГИС, иначе OpenStreetMap
describe('externalPlaceUrl', () => {
    it('2ГИС — по id объекта', () => {
        expect(externalPlaceUrl({ place_id: 'p', name: 'x', category: null, dgis_id: '4504127908559765', lat: 55.7, lon: 37.6 }))
            .toBe('https://2gis.ru/firm/4504127908559765')
    })
    it('без 2ГИС — точка в OSM, без координат — некуда', () => {
        expect(externalPlaceUrl({ place_id: 'p', name: 'x', category: null, lat: 55.7, lon: 37.6 }))
            .toContain('openstreetmap.org/?mlat=55.7&mlon=37.6')
        expect(externalPlaceUrl({ place_id: 'p', name: 'x', category: null })).toBeNull()
    })
})
