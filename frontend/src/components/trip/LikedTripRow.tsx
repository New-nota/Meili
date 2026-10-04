import { Heart, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Trip } from '../../types'
import { rowGrid, metaStyle, tripDaysCount } from './tripRowUtils'

// S16 §2.3: строка понравившейся поездки. Сердце здесь — МАРКЕР, не кнопка:
// всё в блоке лайкнуто по определению, а снять лайк можно крестиком справа
// (второй переключатель делал бы то же самое двумя способами).

interface Props {
    trip: Trip
    onOpen: (id: string) => void
    onRemove: (id: string) => void
}

export default function LikedTripRow({ trip, onOpen, onRemove }: Props) {
    const { t } = useTranslation()
    const days = tripDaysCount(trip)
    const meta = [
        days > 0 ? t('profile.meta.days', { count: days }) : null,
        t('profile.meta.stops', { count: trip.stops_count }),
    ].filter(Boolean).join(' · ')

    return (
        <div
            onClick={() => onOpen(trip.id)}
            className="trip-row"
            style={rowGrid}>
            <Heart aria-hidden="true" size={14} fill="currentColor"
                style={{ color: 'var(--danger)', marginTop: 4 }} />

            <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 15, display: 'block' }}>
                    {trip.title || t('common.untitled')}
                </span>
                <span style={{ ...metaStyle, display: 'block' }}>{meta}</span>
            </span>

            <span />

            {/* кнопка видна всегда — иначе недоступна с клавиатуры и на тач-экранах */}
            <button type="button" className="icon-btn sm trip-tile-del" style={{ position: 'static' }}
                aria-label={t('profile.liked.remove')}
                title={t('profile.liked.remove')}
                onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()   // клик по крестику не открывает поездку
                    onRemove(trip.id)
                }}>
                <X />
            </button>
        </div>
    )
}
