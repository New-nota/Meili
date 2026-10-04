import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import {getTrip, updateTrip} from "../api/trips"
import { apiFetch, ApiError } from "../api/client";
import { apiErrorMessage } from "../utils/apiError";
import { MAX_GROUP } from "../utils/limits";
import IntInput from "../components/IntInput";
import Stepper from "../components/ui/Stepper";
import { ArrowLeft, Globe, Trash2, Users } from "lucide-react";

const MAX_TRIP_DAYS = 60


export default function TripSettings() {
    const { t } = useTranslation()
    const {tripId} = useParams<{tripId: string}>()
    const navigate = useNavigate()

    const [title, setTitle] = useState('')
    const [city, setCity] = useState('')
    const [country, setCountry] = useState('')
    const [adultsCount, setAdultsCount] = useState(1)
    const [childrenCount, setChildrenCount] = useState(0)
    const [childrenAges, setChildrenAges] = useState<number[]>([])
    const [isPublic, setIsPublic] = useState(false)
    // S8 WP-3: диапазон дат -> дни поездки
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [datesError, setDatesError] = useState<string | null>(null)
    const [isSaving, setIsSaving] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [deleting, setDeleting] = useState(false)
    // QA: ошибка загрузки (чужая/удалённая поездка, сеть) раньше оставляла
    // вечное «Загрузка...» и необработанный промис
    const [loadError, setLoadError] = useState<unknown>(null)
    useEffect(() => {
        const load = async () => {
            if(!tripId) return
            try {
                const trip = await getTrip(tripId)
                setTitle(trip.title || '')
                setCity(trip.city || '')
                setCountry(trip.country || '')
                setAdultsCount(trip.adults_count || 1)
                setChildrenCount(trip.children_count || 0)
                // длина возрастов = число детей (старые поездки могли
                // хранить рассинхрон — бэк теперь его отвергает)
                const ages = (trip.children_ages || []).slice(0, trip.children_count || 0)
                while (ages.length < (trip.children_count || 0)) ages.push(0)
                setChildrenAges(ages)
                setIsPublic(trip.is_public || false)
                setStartDate(trip.start_date || '')
                setEndDate(trip.end_date || '')
                setIsLoading(false)
            } catch (e) {
                setLoadError(e)
            }
        }
        load()
    }, [tripId])
    const handleChildrenCount = (count: number) => {
        setChildrenCount(count)
        setChildrenAges(prev => {
            if (count > prev.length) {
                return[...prev, ...Array(count - prev.length).fill(0)]
            }
            return prev.slice(0,count)
        })
    }
    const validate = (): string | null => {
        if (!title.trim()) return t('trip.wizard.errTitle')
        if (!startDate || !endDate) return t('trip.wizard.errDates')
        if (endDate < startDate) return t('trip.wizard.errRange')
        const span = Math.round((new Date(endDate + 'T00:00:00').getTime()
            - new Date(startDate + 'T00:00:00').getTime()) / 86_400_000) + 1
        if (span > MAX_TRIP_DAYS) return t('trip.wizard.errTooLong', { max: MAX_TRIP_DAYS })
        return null
    }

    const save = async () => {
        if(!tripId || isSaving) return
        const err = validate()
        if (err) { setDatesError(err); return }
        setIsSaving(true)
        setDatesError(null)
        try {
            await updateTrip(tripId, {
                title: title.trim(), city, country, adults_count: adultsCount,
                children_count: childrenCount, children_ages: childrenAges,
                is_public: isPublic,
                start_date: startDate || null,
                end_date: endDate || null,
            })
            navigate(`/trips/${tripId}`)
        } catch (e: unknown) {
            // 409: в удаляемом дне остались стопы — машинный код локализуется
            setDatesError(apiErrorMessage(e, t, t('trip.saveError')))
        } finally {
            setIsSaving(false)
        }
    }

    const deleteTrip = async () => {
        if (deleting) return
        setDeleting(true)
        try {
            await apiFetch(`/trips/${tripId}`, {
                method: 'DELETE',
            })
            navigate('/discover')
        } catch (e) {
            // уже удалена (второй клик/другая вкладка) — цель достигнута
            if (e instanceof ApiError && e.status === 404) { navigate('/discover'); return }
            setShowDeleteModal(false)
            setDatesError(apiErrorMessage(e, t))
        } finally {
            setDeleting(false)
        }
    }
    if (loadError != null) return (
        <div className="page" style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
            <p className="error-text" role="alert" style={{ fontSize: 15 }}>
                {loadError instanceof ApiError && (loadError.status === 404 || loadError.status === 422)
                    ? t('trip.notFound') : apiErrorMessage(loadError, t, t('trip.loadError'))}
            </p>
            <button type="button" onClick={() => navigate('/discover')} className="btn btn-primary">{t('nav.myTrips')}</button>
        </div>
    )
    if (isLoading) return <div className="page" style={{ color: 'var(--ink-3)' }}>{t('common.loading')}</div>

    const block: React.CSSProperties = { padding: '16px 18px', background: 'var(--surface)', borderRadius: 'var(--radius-xl)' }

    return (
        <div className="page" style={{ maxWidth: 640 }}>
            <header className="page-head">
                <button type="button" onClick={() => navigate(`/trips/${tripId}`)} className="icon-btn filled"
                    aria-label={t('common.back')} title={t('common.back')}>
                    <ArrowLeft />
                </button>
                <h1>{t('trip.settingsTitle')}</h1>
            </header>

            <div style={{ display: 'grid', gap: 16 }}>
                <label className="field">
                    <span className="field-label">{t('trip.titleLabel')}</span>
                    <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} className="input" />
                </label>
                <div className="grid-2">
                    <label className="field">
                        <span className="field-label">{t('trip.city')}</span>
                        <input value={city} onChange={e => setCity(e.target.value)} className="input" />
                    </label>
                    <label className="field">
                        <span className="field-label">{t('trip.country')}</span>
                        <input value={country} onChange={e => setCountry(e.target.value)} className="input" />
                    </label>
                </div>
                {/* Даты поездки (S8 WP-3): диапазон генерирует дни */}
                <div className="grid-2">
                    <label className="field">
                        <span className="field-label">{t('trip.startDate')}</span>
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input" />
                    </label>
                    <label className="field">
                        <span className="field-label">{t('trip.endDate')}</span>
                        <input type="date" value={endDate} min={startDate || undefined} onChange={e => setEndDate(e.target.value)} className="input" />
                    </label>
                </div>
                {datesError && <p className="error-text" role="alert">{datesError}</p>}

                {/* Группа */}
                <div className="on-surface" style={{ ...block, display: 'grid', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700 }}>
                        <Users size={18} style={{ color: 'var(--moss)' }} />{t('trip.group')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <span>{t('trip.adults')}</span>
                        <Stepper label={t('trip.adults')} value={adultsCount} min={1} max={MAX_GROUP} onChange={setAdultsCount} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <span>{t('trip.children')}</span>
                        <Stepper label={t('trip.children')} value={childrenCount} min={0} max={MAX_GROUP} onChange={handleChildrenCount} />
                    </div>
                    {/* Возраст детей */}
                    {childrenCount > 0 && (
                        <div className="field">
                            <span className="field-label">{t('trip.childrenAges')}</span>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {childrenAges.map((age, i) => (
                                    <IntInput key={i} value={age} min={0} max={17} className="input input-sm"
                                        aria-label={t('trip.wizard.childN', { n: i + 1 })}
                                        onChange={v => setChildrenAges(prev => prev.map((a, j) => j === i ? v : a))}
                                        style={{ width: 64, textAlign: 'center' }} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Публикация */}
                <label style={{ ...block, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, cursor: 'pointer' }}>
                    <span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700 }}>
                            <Globe size={18} style={{ color: 'var(--moss)' }} />{t('trip.publicTitle')}
                        </span>
                        <span style={{ display: 'block', fontSize: 14, color: 'var(--ink-2)', marginTop: 2 }}>{t('trip.publicHint')}</span>
                    </span>
                    <input type="checkbox" role="switch" className="switch" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
                </label>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                    <button type="button" onClick={save} disabled={isSaving} className="btn btn-primary btn-lg" style={{ flex: 1 }}>
                        {isSaving ? t('common.saving') : t('common.save')}
                    </button>
                    <button type="button" onClick={() => setShowDeleteModal(true)} className="btn btn-lg btn-danger">
                        <Trash2 />{t('trip.deleteTrip')}
                    </button>
                </div>
            </div>

            {/* Подтверждение */}
            {showDeleteModal && (
                <div className="modal-scrim" onClick={() => setShowDeleteModal(false)}>
                    <div className="modal-sheet" role="alertdialog" aria-modal="true" aria-labelledby="del-title"
                        onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
                        <h2 id="del-title" style={{ fontSize: 21, marginBottom: 6 }}>{t('trip.deleteTitle')}</h2>
                        <p style={{ color: 'var(--ink-2)', fontSize: 15, marginBottom: 22 }}>{t('trip.deleteWarning')}</p>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button type="button" onClick={() => setShowDeleteModal(false)} className="btn btn-ghost">{t('common.cancel')}</button>
                            <button type="button" onClick={deleteTrip} disabled={deleting} className="btn btn-danger-solid">
                                <Trash2 />{t('common.delete')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
