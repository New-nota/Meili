import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
    BedDouble, Beer, Binoculars, Coffee, Landmark, LoaderCircle, MapPin, Plus,
    ShoppingBag, Star, Theater, Trees, Umbrella, UtensilsCrossed, Check, FerrisWheel, Castle,
} from 'lucide-react'
import type { PlaceCard } from '../../api/meili'
import type { TripDay } from '../../api/days'
import { setLodging } from '../../api/days'
import { apiFetch } from '../../api/client'
import { apiErrorMessage } from '../../utils/apiError'
import { dayLabelShort } from '../../utils/dayLabel'
import { formatMoneyCompact } from '../../utils/money'
import Menu, { type MenuEntry } from '../ui/Menu'

// meili_upgrade: карточки найденных мест под ответом Meili. Всё на карточке —
// факты системы из search_places (event: places), а не текст модели: так
// видно, что место настоящее. Кнопки пишут от имени юзера обычными ручками
// (стоп / жильё) — это не обход «Применить»: модель тут ничего не решает.
interface Props {
    places: PlaceCard[]
    tripId?: string | null
    days?: TripDay[]
    activeDayId?: string | null
    onChanged?: () => void
    onShowPlace?: (place: PlaceCard) => void
}

const ICONS: Record<string, typeof MapPin> = {
    hotel: BedDouble, museum: Landmark, landmark: Landmark, attraction: FerrisWheel,
    viewpoint: Binoculars, restaurant: UtensilsCrossed, cafe: Coffee, bar: Beer,
    park: Trees, theatre: Theater, beach: Umbrella, shopping: ShoppingBag, historic: Castle,
}

const SUBTYPES = new Set(['hotel', 'hostel', 'guest_house', 'apartment', 'motel', 'pub', 'zoo', 'aquarium', 'theme_park'])

export default function PlaceCards({ places, tripId, days = [], activeDayId, onChanged, onShowPlace }: Props) {
    const { t, i18n } = useTranslation()
    const [busy, setBusy] = useState<string | null>(null)
    const [done, setDone] = useState<Record<string, string>>({})
    const [error, setError] = useState<string | null>(null)
    const canWrite = Boolean(tripId) && days.length > 0

    // ошибки сети — текстом под карточками, а не молча (паттерн safely)
    const safely = async (placeId: string, action: () => Promise<string>) => {
        setBusy(placeId)
        setError(null)
        try {
            const note = await action()
            setDone(prev => ({ ...prev, [placeId]: note }))
            onChanged?.()
        } catch (e) {
            setError(apiErrorMessage(e, t))
        } finally {
            setBusy(null)
        }
    }

    const addToDay = (p: PlaceCard, day: TripDay) => safely(p.place_id, async () => {
        await apiFetch(`/trips/${tripId}/stops`, {
            method: 'POST', body: JSON.stringify({ place_id: p.place_id, day_id: day.id }),
        })
        return t('meili.cardAdded', { day: dayLabelShort(day, t) })
    })

    const lodge = (p: PlaceCard, day: TripDay | null) => safely(p.place_id, async () => {
        await setLodging(tripId!, { place_id: p.place_id, ...(day ? { day_ids: [day.id] } : {}) })
        return day ? `${t('meili.cardLodged')}: ${dayLabelShort(day, t)}` : t('meili.cardLodged')
    })

    // открытый день — первым пунктом, остальные по порядку
    const orderedDays = [...days].sort((a, b) =>
        (a.id === activeDayId ? -1 : b.id === activeDayId ? 1 : a.position - b.position))

    const subline = (p: PlaceCard): string[] => {
        const bits: string[] = []
        const subtype = p.tags?.find(tag => SUBTYPES.has(tag))
        bits.push(subtype ? t(`meili.subtype.${subtype}`) : p.category ? t(`meili.category.${p.category}`) : '')
        // класс отеля из OSM — словами: звёздочка рядом с рейтингом 2ГИС читалась как вторая оценка
        const stars = p.tags?.find(tag => tag.startsWith('stars:'))?.slice(6)
        if (stars) bits.push(t('meili.hotelStars', { count: Number(stars) }))
        // короткие факты — до адреса: на узкой панели хвост строки обрезается
        if (p.distance_m != null) bits.push(p.distance_m < 1000
            ? t('meili.distanceM', { count: p.distance_m })
            : t('meili.distanceKm', { km: (p.distance_m / 1000).toFixed(1) }))
        if (p.is_open_now === true) bits.push(t('meili.openNow'))
        if (p.is_open_now === false) bits.push(t('meili.closedNow'))
        if (p.outside_requested_city && p.city) bits.push(`${p.city} · ${t('meili.outsideCity')}`)
        else if (p.address) bits.push(p.address)
        return bits.filter(Boolean)
    }

    // этап B: цена — своей строкой: на узкой панели хвост общей строки обрезался
    // именно на ней. «≈» (средний счёт) и «от» (жильё) — не точная сумма
    const priceLine = (p: PlaceCard): string | null => {
        const bits: string[] = []
        if (p.avg_check && p.price_currency) bits.push(t('meili.cardAvgCheck',
            { amount: formatMoneyCompact(p.avg_check, p.price_currency, i18n.language) }))
        if (p.lodging_price_from && p.price_currency) bits.push(t('meili.cardLodgingFrom',
            { amount: formatMoneyCompact(p.lodging_price_from, p.price_currency, i18n.language) }))
        if (!bits.length) return null
        if (p.price_source === '2gis') bits.push(t('meili.source2gis'))
        return bits.join(' · ')
    }

    return (
        <div role="list" aria-label={t('meili.placesFound')}
            // minmax(0, 1fr): иначе длинная строка с nowrap растягивает трек,
            // и кнопка «В день» уезжает за край узкой панели
            style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 6, marginLeft: 28, minWidth: 0 }}>
            {places.map(p => {
                const Icon = ICONS[p.category ?? ''] ?? MapPin
                const price = priceLine(p)
                const isHotel = p.category === 'hotel'
                const items: MenuEntry[] = isHotel
                    ? [
                        { label: t('meili.cardAllDays'), onSelect: () => lodge(p, null) },
                        { type: 'sep' },
                        ...orderedDays.map(d => ({ label: dayLabelShort(d, t), onSelect: () => lodge(p, d) })),
                    ]
                    : orderedDays.map(d => ({ label: dayLabelShort(d, t), onSelect: () => addToDay(p, d) }))
                return (
                    <div key={p.place_id} role="listitem" style={{
                        display: 'flex', gap: 10, alignItems: 'center',
                        background: 'var(--raised)', boxShadow: 'var(--shadow-1)',
                        borderRadius: 'var(--radius)', padding: '8px 10px',
                    }}>
                        <Icon size={18} style={{ color: 'var(--moss)', flexShrink: 0 }} aria-hidden />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                                {p.rating && p.rating_count ? (
                                    <span title={t('meili.cardReviews', { count: p.rating_count })}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                                        <Star size={12} fill="currentColor" aria-hidden />
                                        {Number(p.rating).toLocaleString(i18n.language, { maximumFractionDigits: 1 })}
                                        <span style={{ color: 'var(--ink-3)' }}>({p.rating_count})</span>
                                    </span>
                                ) : null}

                            </div>
                            {price && (
                                <div style={{ fontSize: 13, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {price}
                                </div>
                            )}
                            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {subline(p).join(' · ')}
                            </div>
                            {done[p.place_id] && (
                                <div style={{ fontSize: 12.5, color: 'var(--moss)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                                    <Check size={13} />{done[p.place_id]}
                                </div>
                            )}
                        </div>
                        {onShowPlace && p.lat != null && p.lon != null && (
                            <button type="button" className="icon-btn sm" onClick={() => onShowPlace(p)}
                                title={t('meili.cardShowOnMap')} aria-label={t('meili.cardShowOnMap')}>
                                <MapPin />
                            </button>
                        )}
                        {canWrite && (
                            <Menu items={items} label={isHotel ? t('meili.cardLodging') : t('meili.cardAddToDay')}
                                trigger={props => (
                                    <button type="button" {...props} className="btn btn-sm"
                                        disabled={busy !== null} style={{ flexShrink: 0 }}>
                                        {busy === p.place_id
                                            ? <LoaderCircle className="spin" />
                                            : isHotel ? <BedDouble /> : <Plus />}
                                        {isHotel ? t('meili.cardLodging') : t('meili.cardAddToDay')}
                                    </button>
                                )} />
                        )}
                    </div>
                )
            })}
            {error && <p className="error-text" role="alert">{error}</p>}
        </div>
    )
}
