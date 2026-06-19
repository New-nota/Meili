import {useQuery, useMutation} from "@tanstack/react-query"
import { getRecommendedTrips } from "../api/recommendations"
import { useNavigate } from "react-router-dom"
import { cloneTrip } from "../api/trips"

export function RecommendedTrips({ city }: {city?: string}) {
    const navigate = useNavigate()

    const { data: trips, isLoading, isError } = useQuery({
        queryKey: ["recommended-trips", city],
        queryFn: () => getRecommendedTrips(city),
    })

    const cloneMutation = useMutation({
        mutationFn: (tripId: string) => cloneTrip(tripId),
        onSuccess: (newTrip) => {navigate(`/trips/${newTrip.id}`)},
    })

    if (isLoading) return <p>Загружаем рекомендации...</p>
    if (isError) return <p>Не удалось загрузить рекомендации...</p>
    if(!trips || trips.length === 0) return null;

    return (
        <section style={{marginTop: 24}}>
            <h2>Похожие выбирают</h2>
            <div style={{display: "flex", gap: 12, flexWrap: "wrap"}}>
                {trips.map((trip) => (
                    <div key={trip.id} style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8}}>
                        <h3>{trip.title}</h3>
                        <p>{trip.city}</p>
                        <button 
                        onClick={() => cloneMutation.mutate(trip.id)}
                        disabled={cloneMutation.isPending}
                        style={{padding: "6px 12px", background: "#3b82f6", color: "white", border: "none", borderRadius:6, cursor: "pointer"}}>
                            {cloneMutation.isPending ? "Клонируем...": "Клонировать"}
                        </button>
                    </div>
                ))}
            </div>
        </section>
    );
}