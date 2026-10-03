import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import {getTrip, updateTrip} from "../api/trips"
import { apiFetch, ApiError } from "../api/client";
import { apiErrorMessage } from "../utils/apiError";
import { MAX_GROUP } from "../utils/limits";
import IntInput from "../components/IntInput";

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
        <div style={{padding: 32, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start'}}>
            <p style={{color: 'var(--accent)', margin: 0}}>
                {loadError instanceof ApiError && (loadError.status === 404 || loadError.status === 422)
                    ? t('trip.notFound') : apiErrorMessage(loadError, t, t('trip.loadError'))}
            </p>
            <button onClick={() => navigate('/discover')} style={{padding: '8px 16px', background: 'var(--accent)',
                color: 'var(--surface)', border: 'none', borderRadius: 6, cursor: 'pointer'}}>{t('nav.myTrips')}</button>
        </div>
    )
    if (isLoading) return <div style={{padding:32}}>{t('common.loading')}</div>

    return (
        <div style={{padding: 32, maxWidth: 600, margin: '0 auto'}}>
            <div style={{display: 'flex', alignItems: 'center', gap:12, marginBottom: 24}}>
                <button onClick={() => navigate(`/trips/${tripId}`)} style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)'}}>&#8592;</button>
                    <h2 style={{margin: 0}}>{t('trip.settingsTitle')}</h2>
            </div>

            <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
                {/*MAIN */}
                <div>
                    <label style={{fontSize: 13, color: 'var(--text-muted)'}}>{t('trip.titleLabel')}</label>
                    <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
                    style={{display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, boxSizing: 'border-box'}} />
                </div>
                <div style={{display: 'flex', gap:12}}>
                    <div style={{flex: 1}}>
                        <label style={{fontSize: 13, color: 'var(--text-muted)'}}>{t('trip.city')}</label>
                        <input value={city} onChange={e => setCity(e.target.value)}
                        style={{display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, boxSizing: 'border-box'}} />
                    </div>
                    <div style={{flex: 1}}>
                        <label style={{fontSize: 13, color: 'var(--text-muted)'}}>{t('trip.country')}</label>
                        <input value={country} onChange={e => setCountry(e.target.value)}
                        style={{display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, boxSizing: 'border-box'}} />
                    </div>
                </div>
                {/* Даты поездки (S8 WP-3): диапазон генерирует дни */}
                <div style={{display: 'flex', gap:12}}>
                    <div style={{flex: 1}}>
                        <label style={{fontSize: 13, color: 'var(--text-muted)'}}>{t('trip.startDate')}</label>
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                        style={{display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, boxSizing: 'border-box'}} />
                    </div>
                    <div style={{flex: 1}}>
                        <label style={{fontSize: 13, color: 'var(--text-muted)'}}>{t('trip.endDate')}</label>
                        <input type="date" value={endDate} min={startDate || undefined} onChange={e => setEndDate(e.target.value)}
                        style={{display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, boxSizing: 'border-box'}} />
                    </div>
                </div>
                {datesError && <p style={{color: 'var(--accent)', fontSize: 13, margin: 0}}>{datesError}</p>}
                {/*Группа */}
                <div style={{padding: 16, border: '1px solid var(--border)', borderRadius: 8}}>
                    <div style={{fontSize: 14, fontWeight: 500, marginBottom: 12}}>👥 {t('trip.group')} 

                    </div>
                    <div style={{display: 'flex', alignItems: 'center', gap: 8, marginTop: 4}}>
                        <button onClick={() => setAdultsCount(Math.max(1, adultsCount - 1))}
                        style={{width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer'}}>-</button>
                        <span style={{fontSize: 16, minWidth:20, textAlign: 'center'}}>{adultsCount}</span>
                        <button onClick={()=> setAdultsCount(Math.min(MAX_GROUP, adultsCount + 1))}
                        style={{width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer'}}>+</button>
                    </div>
                
                <div>
                    <label style={{ fontSize: 13, color: 'var(--text-muted)'}}>{t('trip.children')}</label>
                    <div style={{display: 'flex', alignItems: 'center', gap: 8, marginTop: 4}}>
                        <button onClick={() => handleChildrenCount(Math.max(0, childrenCount - 1))}
                        style={{width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer'}}>-</button>
                        <span style={{fontSize: 16, minWidth: 20, textAlign: 'center'}}>{childrenCount}</span>
                        <button onClick={() => handleChildrenCount(Math.min(MAX_GROUP, childrenCount + 1))}
                            style={{width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer'}}>+</button>
                    </div>
                
            {/*Возраст детей */}
            {childrenCount > 0 && (
                <div >
                    <label style={{fontSize: 13, color: 'var(--text-muted)'}}>{t('trip.childrenAges')}</label>
                    <div style={{display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap'}}>
                        {childrenAges.map((age, i) => (
                            <IntInput key={i} value={age} min={0} max={17}
                                onChange={v => setChildrenAges(prev => prev.map((a, j) => j === i ? v : a))}
                                style={{width: 56, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize:15, textAlign: 'center'}} />
                        ))}
                    </div>
                
                </div>
            )}
            </div>
        </div>
        </div>
        {/*Публикация */}
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, border: '1px solid var(--border)', borderRadius: 8}}>
            <div>
                <div style={{fontSize: 14, fontWeight: 500}}>🌍 {t('trip.publicTitle')}</div>
                <div style={{fontSize: 13, color: 'var(--text-muted)', marginTop: 2}}>{t('trip.publicHint')}</div>
            </div>
            <input type="checkbox" checked={isPublic} onChange={e=> setIsPublic(e.target.checked)}
            style={{width:18, height: 18, cursor: 'pointer'}} />
        </div>
        <button onClick={save} disabled={isSaving} style={{
            padding: '10px 24px', background: isSaving ? 'var(--text-muted)': 'var(--accent)',
            color: 'var(--surface)', border: 'none', borderRadius: 6, cursor: isSaving ? 'not-allowed':'pointer', fontSize: 14}}>
        {isSaving ? t('common.saving') : t('common.save')}</button>
        {/*Удалить*/}
        <button onClick={() => setShowDeleteModal(true)} style={{
            padding: '10px 24px', background: 'none', color: 'var(--accent)',
            border: '1px solid var(--accent)', borderRadius: 6, cursor: 'pointer', fontSize: 14
        }}> {t('trip.deleteTrip')}</button>
        {/*Подтверждение */}
        {showDeleteModal && (
            <div style={{
                position: 'fixed', inset: 0, background: 'color-mix(in srgb, var(--text-primary) 50%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
            }}>
                <div style={{background: 'var(--surface-raised)', borderRadius: 12, padding: 24, maxWidth: 400, width: '90%'}}>
                    <h3 style={{margin: '0 0 8px'}}>{t('trip.deleteTitle')}</h3>
                    <p style={{color: 'var(--text-muted)', fontSize: 14, margin: ' 0 0 20px'}}>
                        {t('trip.deleteWarning')}
                    </p>
                <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
                    <button onClick={() => setShowDeleteModal(false)} style={{
                        padding: '8px 16px', background: 'none', color: 'var(--text-primary)', border: '1px solid var(--border)',
                        borderRadius: 6, cursor: 'pointer'
                    }}>{t('common.cancel')}</button>
                <button onClick={deleteTrip} disabled={deleting} style={{
                    padding: '8px 16px', background: 'var(--accent)', color: 'var(--surface)',
                    border: 'none', borderRadius: 6, cursor: 'pointer'
                }}>{t('common.delete')}</button>
                </div>
                </div>
            </div>)}
        </div>
    )
}