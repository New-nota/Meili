import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { getRecommendedTrips } from "../api/recommendations"
import { useNavigate } from "react-router-dom"
import RecommendedTripCard from "./trip/RecommendedTripCard"

// S13: клик по карточке чужой поездки открывает превью (readOnly-планировщик),
// где лайк/копирование живут в шапке. Кнопку «Клонировать» с карточки убрали.
// S16 §2.5: карточка — общая с блоком «Похожие выбирают» в профиле.
export function RecommendedTrips({ city }: {city?: string}) {
    const { t } = useTranslation()
    const navigate = useNavigate()

    const { data: trips, isLoading, isError } = useQuery({
        queryKey: ["recommended-trips", city],
        queryFn: () => getRecommendedTrips(city),
    })

    // S17: секция рендерится всегда — она отбивает нижнюю часть Discover,
    // и пустой заголовок без подписи выглядел бы поломкой
    const muted: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted)' }

    return (
        <section style={{marginTop: 16}}>
            <h2 style={{fontSize: 17, margin: '0 0 10px'}}>{t('trip.recommendationsTitle')}</h2>
            {isLoading && <p style={muted}>{t('trip.recommendedLoading')}</p>}
            {isError && <p style={muted}>{t('trip.recommendedError')}</p>}
            {!isLoading && !isError && (!trips || trips.length === 0) && (
                <p style={muted}>{t('trip.recommendationsEmpty')}</p>
            )}
            {trips && trips.length > 0 && (
                <div className="recommended-grid">
                    {trips.map((trip) => (
                        <RecommendedTripCard key={trip.id} trip={trip}
                            onOpen={id => navigate(`/trips/${id}/preview`)} />
                    ))}
                </div>
            )}
        </section>
    );
}
