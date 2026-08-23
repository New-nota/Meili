import { Heart, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Trip } from '../../types'
import { rowGrid, metaStyle, tripDaysCount } from './TripRow'

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
            style={rowGrid}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
            <Heart aria-hidden="true" size={14} fill="currentColor"
                style={{ color: 'var(--accent)', marginTop: 4 }} />

            <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 15, display: 'block' }}>
                    {trip.title || t('common.untitled')}
                </span>
                <span style={{ ...metaStyle, display: 'block' }}>{meta}</span>
            </span>

            <span />

            {/* кнопка видна всегда — иначе недоступна с клавиатуры и на тач-экранах */}
            <button
                aria-label={t('profile.liked.remove')}
                title={t('profile.liked.remove')}
                onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()   // клик по крестику не открывает поездку
                    onRemove(trip.id)
                }}
                style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                    color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                <X size={16} />
            </button>
        </div>
    )
}
