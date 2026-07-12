import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { RecommendedTrips } from "../components/RecommendedTrips"
import { apiFetch, logout } from "../api/client"
import LanguageSwitcher from "../components/LanguageSwitcher"
import Logo from "../components/Logo"

interface Trip {
    id: string
    title: string
    description?: string
    city?: string
    adults_count: number
    children_count: number
}

export default function Discover() {
    const { t } = useTranslation()
    const [trips, setTrips] = useState<Trip[]>([])
    const [isCreating, setIsCreating] =  useState(false)
    const [newTitle, setNewTitle] = useState('')
    const [newCity, setNewCity] = useState('')
    const navigate = useNavigate()
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const load = async () => {
            try {
                const data = await apiFetch<Trip[]>('/trips/') 
                setTrips(data)
        } catch {
            setError(t('trip.loadError'))
        }}
    load()
    }, [])
    const createTrip = async () => {
        try {const trip = await apiFetch<Trip>('/trips/', {
            method: 'POST',
            body: JSON.stringify({title: newTitle, city: newCity})
        })
        
        navigate(`/trips/${trip.id}`)
        } catch {
            setError(t('trip.saveError'))
        }
        
    }
    const deleteTrip = async (id: string) => {
        try { await apiFetch(`/trips/${id}`, {method: 'DELETE' })
        setTrips(prev => prev.filter(tr => tr.id !== id)) }catch {setError(t('common.error'))

        } finally {
            setDeletingId(null)
        }

    }
    return (<div className="discover-page" style={{padding: 32, maxWidth: 800, margin: '0 auto'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24}}>
            <span style={{display: 'flex', alignItems: 'center', gap: 14}}>
                <Logo size={30} withWordmark />
                <h2 style={{margin: 0, fontSize: 20}}>{t('nav.myTrips')}</h2>
            </span>
            <div style={{display: 'flex', gap: 8}}>
                <LanguageSwitcher />
                <button onClick={() => navigate('/profile')}
                style={{padding: '8px 16px', background: 'none', color: 'var(--text-primary)',
                border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 14}}>
                    {t('nav.profile')}
                </button>
                <button onClick={() => setIsCreating(true)} style={{padding: '8px 16px', background: 'var(--accent)',
                color: 'var(--surface)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14}}>
                    {t('nav.planTrip')}
                </button>
                <button onClick={async () => { await logout(); navigate('/auth') }}
                style={{padding: '8px 16px', background: 'none', color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 14}}>
                    {t('nav.logout')}
                </button>
            </div>
        </div>
        {error && <p style={{color: 'var(--accent)', fontSize: 13, marginBottom: 12}}>{error}</p>}
        {isCreating && (
            <div style={{padding: 16, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 24,
                display: 'flex', flexDirection: 'column', gap: 8
            }}>
                <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder={t('trip.titlePlaceholder')}
                style={{padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14}} />
                <input value={newCity} onChange={e => setNewCity(e.target.value)} placeholder={t('trip.cityPlaceholder')}
                 style={{padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14}} />
                 <div style={{display: 'flex', gap:8}}>
                    <button onClick={createTrip} style={{padding: '8px 16px', background: 'var(--accent)', color: 'var(--surface)',
                        border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14}}>{t('common.create')}</button>
                        <button onClick={() => setIsCreating(false)} style={{padding: '8px 16px', background: 'none', color: 'var(--text-muted)', border: '1px solid var(--border)',
                            borderRadius:6, cursor: 'pointer', fontSize: 14
                        }}>{t('common.cancel')}</button>
                        </div>
                    </div>
                    )}
                    <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
                        {trips.map(trip => (
                            <div key={trip.id} onClick={() => navigate(`/trips/${trip.id}`)}
                            style={{padding: 16, border: '1px solid var(--border)', borderRadius: 8, cursor:'pointer', transition: 'box-shadow 0.15s'}}
                            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px color-mix(in srgb, var(--text-primary) 10%, transparent)'}
                            onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
                                <div style ={{display: 'flex', justifyContent: 'space-between'}}>
                                    <strong style={{fontSize:16}}>{trip.title}</strong>
                                    <button onClick={(e) => {
                                        e.stopPropagation()
                                        setDeletingId(trip.id)}} style={{background: 'none', border: 'none', cursor:'pointer', color: 'var(--text-muted)', fontSize: 18}}>✕</button>
                                    
                                    <span style={{fontSize:13, color: 'var(--text-muted)'}}>
                                        👥{t('trip.peopleCount', {count: trip.adults_count + trip.children_count})}
                                    </span>
                                </div>
                                {trip.city && <div style={{fontSize: 13, color: 'var(--text-muted)', marginTop: 4}}>📍 {trip.city}</div> }
                            </div>
                        ))}
                        {trips.length === 0 && (
                            <div style={{textAlign: 'center', color: 'var(--text-muted)', padding: 48}}>
                                {t('trip.noTripsYet')}
                                </div>
                        )}
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
                                <button onClick={()=> deleteTrip(deletingId)} style={{
                                    padding: '8px 16px', background: 'var(--accent)', color: 'var(--surface)',
                                    border: 'none', borderRadius: 6, cursor: 'pointer'
                                }}>{t('common.delete')}</button>
                            </div>
                        </div>
                    </div>

                           
                        )}
                    </div>
                    {/* без city: бэкенд отдаёт рекомендации по всем городам */}
                    <RecommendedTrips />
                </div>
                
        )
}