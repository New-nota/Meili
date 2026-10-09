import type { PlaceCard } from '../api/meili'

/** Где посмотреть место, если нашей карты рядом нет (чат мастера):
 *  2ГИС — фото, меню, отзывы; без объекта 2ГИС — точка в OpenStreetMap. */
export function externalPlaceUrl(p: PlaceCard): string | null {
    if (p.dgis_id) return `https://2gis.ru/firm/${p.dgis_id}`
    if (p.lat != null && p.lon != null) {
        return `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}`
    }
    return null
}
