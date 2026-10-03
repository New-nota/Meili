import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { User } from "lucide-react"
import { RecommendedTrips } from "../components/RecommendedTrips"
import { apiFetch, ApiError } from "../api/client"
import { apiErrorMessage } from "../utils/apiError"
import HermodLogo from "../components/HermodLogo"
import CreateTripModal from "../components/CreateTripModal"
import MeiliChatModal from "../components/meili/MeiliChatModal"
import type { TripDraft } from "../api/meili"
import TripGridCard from "../components/trip/TripGridCard"
import type { Trip } from "../types"

export default function Discover() {
    const { t } = useTranslation()
    const [trips, setTrips] = useState<Trip[]>([])
    const [isCreating, setIsCreating] =  useState(false)
    // S17: null — чат закрыт; строка — заготовка первого сообщения Meili
    // S17: заготовка реплики + факты мастера (ревью: факты уходят структурно)
    const [meiliDraft, setMeiliDraft] = useState<string | null>(null)
    const [meiliDraftFields, setMeiliDraftFields] = useState<TripDraft | null>(null)
    const navigate = useNavigate()
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    // сама ошибка, а не текст: перевод — при рендере (смена языка не требует
    // перезагрузки данных, а эффекту не нужен t в зависимостях)
    const [loadError, setLoadError] = useState<unknown>(null)
    const [deleting, setDeleting] = useState(false)

    useEffect(() => {
        const load = async () => {
            try {
                const data = await apiFetch<Trip[]>('/trips/')
                setTrips(data)
        } catch (e) {
            setLoadError(e)
        }}
    load()
    }, [])
    const deleteTrip = async (id: string) => {
        if (deleting) return
        setDeleting(true)
        try {
            await apiFetch(`/trips/${id}`, {method: 'DELETE' })
            setTrips(prev => prev.filter(tr => tr.id !== id))
        } catch (e) {
            // QA: уже удалена (двойной клик, другая вкладка) — цель достигнута,
            // карточку убираем, а не пугаем ошибкой
            if (e instanceof ApiError && e.status === 404) setTrips(prev => prev.filter(tr => tr.id !== id))
            else setError(apiErrorMessage(e, t))
        } finally {
            setDeleting(false)
            setDeletingId(null)
        }
    }
    return (<div className="discover-page" style={{padding: 32, maxWidth: 800, margin: '0 auto'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24}}>
            <span style={{display: 'flex', alignItems: 'center', gap: 14}}>
                <HermodLogo size={30} withWordmark />
                <h2 style={{margin: 0, fontSize: 20}}>{t('nav.myTrips')}</h2>
            </span>
            <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
                <button onClick={() => setIsCreating(true)} style={{padding: '8px 16px', background: 'var(--accent)',
                color: 'var(--surface)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14}}>
                    {t('nav.planTrip')}
                </button>
                {/* S18: вход в профиль — только иконка-силуэт; язык и выход переехали внутрь */}
                <button onClick={() => navigate('/profile')}
                aria-label={t('nav.profile')} title={t('nav.profile')}
                style={{width: 36, height: 36, padding: 0, background: 'none', color: 'var(--text-primary)',
                border: '1px solid var(--border)', borderRadius: '50%', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                    <User size={18} />
                </button>
            </div>
        </div>
        {loadError != null && <p style={{color: 'var(--accent)', fontSize: 13, marginBottom: 12}}>{apiErrorMessage(loadError, t, t('trip.loadError'))}</p>}
        {error && <p style={{color: 'var(--accent)', fontSize: 13, marginBottom: 12}}>{error}</p>}
        {/* S11: мастер создания — модалка со всеми полями.
            S17: из мастера можно уйти обсуждать поездку с Meili */}
        {isCreating && (
            <CreateTripModal
                onClose={() => setIsCreating(false)}
                onCreated={trip => navigate(`/trips/${trip.id}`)}
                onPlanWithMeili={(text, fields) => {
                    setIsCreating(false); setMeiliDraft(text); setMeiliDraftFields(fields)
                }} />
        )}
        {/* S17: чат с Meili прямо с Discover — поездки ещё нет, её создаст план */}
        {meiliDraft !== null && (
            <MeiliChatModal
                initialInput={meiliDraft || undefined}
                draft={meiliDraftFields}
                onClose={() => { setMeiliDraft(null); setMeiliDraftFields(null) }}
                onTripCreated={id => { setMeiliDraft(null); setMeiliDraftFields(null); navigate(`/trips/${id}`) }} />
        )}

                    {/* S17: свои поездки — сеткой, крестик в углу ячейки */}
                    <div className="trip-grid">
                        {trips.map(trip => (
                            <TripGridCard key={trip.id} trip={trip}
                                onOpen={id => navigate(`/trips/${id}`)}
                                onDelete={setDeletingId} />
                        ))}
                    </div>
                    {trips.length === 0 && (
                        <div style={{textAlign: 'center', color: 'var(--text-muted)', padding: 48}}>
                            {t('trip.noTripsYet')}
                        </div>
                    )}
                    <div>
                        {deletingId && (
                            <div style={{
                                position: 'fixed', inset: 0, background: 'color-mix(in srgb, var(--text-primary) 50%, transparent)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000}}>

                            <div style={{background: 'var(--surface-raised)', borderRadius: 12, padding: 24, maxWidth: 400, width: '90%'}}>
                            <h3 style={{margin: '0 0 8px'}}>{t('trip.deleteTitle')}</h3>
                            <p style={{color: 'var(--text-muted)', fontSize: 14, margin: '0 0 20px'}}>{t('trip.deleteWarning')}</p>
                            <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
                                <button onClick={()=> setDeletingId(null)} style={{
                                    padding: '8px 16px', background: 'var(--surface-raised)', color: 'var(--text-primary)',
                                    border: '1px solid var(--border)', borderRadius:6, cursor: 'pointer'
                                }}>{t('common.cancel')}</button>
                                <button onClick={()=> deleteTrip(deletingId)} disabled={deleting} style={{
                                    padding: '8px 16px', background: 'var(--accent)', color: 'var(--surface)',
                                    border: 'none', borderRadius: 6, cursor: 'pointer'
                                }}>{t('common.delete')}</button>
                            </div>
                        </div>
                    </div>

                           
                        )}
                    </div>
                    {/* S17: нижняя часть страницы отсекается линией с подписью;
                        без city: бэкенд отдаёт рекомендации по всем городам */}
                    <div style={{
                        borderTop: '1px solid var(--border)', marginTop: 32, paddingTop: 8,
                    }}>
                        <RecommendedTrips />
                    </div>
                </div>
                
        )
}