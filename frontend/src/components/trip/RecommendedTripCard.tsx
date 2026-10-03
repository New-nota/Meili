import { useState } from 'react'
import { Heart } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Trip } from '../../types'
import { likeTrip, unlikeTrip } from '../../api/trips'
import { tripDaysCount } from './tripRowUtils'

// S16 §2.4: карточка рекомендованной поездки — одна и та же в блоке
// «Похожие выбирают» и в Discover (двух реализаций больше нет).
// Превью карты не рендерится: вместо него — число остановок крупно.
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
    const subtitle = [
        days > 0 ? t('profile.meta.days', { count: days }) : null,
        trip.description || trip.city,
    ].filter(Boolean).join(' · ')

    return (
        <div onClick={() => onOpen(trip.id)}
            style={{
                position: 'relative', borderRadius: 12, overflow: 'hidden',
                background: 'var(--surface-raised)', border: '1px solid var(--border)',
                cursor: 'pointer', display: 'flex', flexDirection: 'column',
            }}>
            {/* верхняя зона вместо превью карты */}
            <div style={{
                height: 88, background: 'var(--surface)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
            }}>
                <span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>
                    {trip.stops_count}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {t('profile.similar.stops')}
                </span>
            </div>

            <button onClick={toggleLike}
                aria-label={t('profile.liked.title')}
                aria-pressed={liked}
                style={{
                    position: 'absolute', top: 8, right: 8, width: 30, height: 30,
                    borderRadius: '50%', border: 'none', cursor: 'pointer',
                    background: 'var(--surface-raised)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 1px 4px color-mix(in srgb, var(--text-primary) 20%, transparent)',
                    color: liked ? 'var(--accent)' : 'var(--text-muted)',
                }}>
                <Heart size={15} fill={liked ? 'currentColor' : 'none'} />
            </button>

            <div style={{ padding: 12 }}>
                <strong style={{ fontSize: 14, display: 'block' }}>{trip.title}</strong>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {subtitle}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {t('profile.similar.likedBy', { count: likes })}
                </div>
            </div>
        </div>
    )
}
