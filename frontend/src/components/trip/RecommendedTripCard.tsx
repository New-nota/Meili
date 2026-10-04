import { useState } from 'react'
import { Heart } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Trip } from '../../types'
import { likeTrip, unlikeTrip } from '../../api/trips'
import { tripDaysCount } from './tripRowUtils'

// S16 §2.4: карточка рекомендованной поездки — одна и та же в блоке
// «Похожие выбирают» и в Discover (двух реализаций больше нет).
// Превью карты не рендерится; редизайн «Лес»: без «большой цифры» —
// название первым, остановки/дни/лайки одной строкой меты.
// Единственное место профиля, где сердце это ПЕРЕКЛЮЧАТЕЛЬ.

interface Props {
    trip: Trip
    onOpen: (id: string) => void
}

export default function RecommendedTripCard({ trip, onOpen }: Props) {
    const { t } = useTranslation()
    const [liked, setLiked] = useState(!!trip.liked_by_me)
    const [likes, setLikes] = useState(trip.likes_count)

    const toggleLike = async (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()          // клик по сердцу не открывает поездку
        const next = !liked
        setLiked(next)
        setLikes(n => n + (next ? 1 : -1))
        try {
            if (next) await likeTrip(trip.id)
            else await unlikeTrip(trip.id)
        } catch {
            setLiked(!next)          // откат: состояние переживает перезагрузку
            setLikes(n => n + (next ? -1 : 1))
        }
    }

    const days = tripDaysCount(trip)
    const meta = [
        days > 0 ? t('profile.meta.days', { count: days }) : null,
        t('profile.meta.stops', { count: trip.stops_count }),
        likes > 0 ? t('profile.similar.likedBy', { count: likes }) : null,
    ].filter(Boolean).join(' · ')
    const about = trip.description || trip.city

    return (
        <div className="trip-tile">
            <button type="button" className="trip-tile-open" onClick={() => onOpen(trip.id)} style={{ minHeight: 0 }}>
                <strong style={{ fontSize: 17, lineHeight: 1.25, paddingRight: 36 }}>{trip.title}</strong>
                {about && <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>{about}</span>}
                <span style={{ fontSize: 13.5, color: 'var(--ink-3)', paddingTop: 4 }}>{meta}</span>
            </button>
            <button type="button" onClick={toggleLike} className="icon-btn sm"
                aria-label={t('profile.liked.title')} aria-pressed={liked}
                style={{ position: 'absolute', top: 10, right: 10, background: 'var(--raised)', boxShadow: 'var(--shadow-1)',
                    color: liked ? 'var(--danger)' : 'var(--ink-3)' }}>
                <Heart fill={liked ? 'currentColor' : 'none'} />
            </button>
        </div>
    )
}
