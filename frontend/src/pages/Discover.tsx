import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { Plus, Trash2, User } from "lucide-react"
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
    return (
        <div className="page">
            <header className="page-head">
                <HermodLogo size={30} />
                <h1>{t('nav.myTrips')}</h1>
                <button type="button" onClick={() => setIsCreating(true)} className="btn btn-primary page-cta">
                    <Plus />{t('nav.planTrip')}
                </button>
                {/* S18: вход в профиль — только иконка-силуэт; язык и выход переехали внутрь */}
                <button type="button" onClick={() => navigate('/profile')} className="icon-btn filled"
                    aria-label={t('nav.profile')} title={t('nav.profile')}>
                    <User />
                </button>
            </header>
            {loadError != null && <p className="error-text" role="alert" style={{ marginBottom: 12 }}>{apiErrorMessage(loadError, t, t('trip.loadError'))}</p>}
            {error && <p className="error-text" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
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
            {trips.length === 0 && loadError == null && (
                <div style={{ padding: '24px', background: 'var(--surface)', borderRadius: 'var(--radius-xl)' }}>
                    <p style={{ fontSize: 17, fontWeight: 650 }}>{t('trip.noTripsYet')}</p>
                    <p style={{ fontSize: 14.5, color: 'var(--ink-2)', marginTop: 4 }}>{t('profile.myTrips.empty.subtitle')}</p>
                </div>
            )}
            {deletingId && (
                <div className="modal-scrim" onClick={() => setDeletingId(null)}>
                    <div className="modal-sheet" role="alertdialog" aria-modal="true" aria-labelledby="del-title"
                        onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
                        <h2 id="del-title" style={{ fontSize: 21, marginBottom: 6 }}>{t('trip.deleteTitle')}</h2>
                        <p style={{ color: 'var(--ink-2)', fontSize: 15, marginBottom: 22 }}>{t('trip.deleteWarning')}</p>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button type="button" onClick={() => setDeletingId(null)} className="btn btn-ghost">{t('common.cancel')}</button>
                            <button type="button" onClick={() => deleteTrip(deletingId)} disabled={deleting} className="btn btn-danger-solid">
                                <Trash2 />{t('common.delete')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* без city: бэкенд отдаёт рекомендации по всем городам */}
            <div style={{ marginTop: 44 }}>
                <RecommendedTrips />
            </div>
        </div>
    )
}
