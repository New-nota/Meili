import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { RecommendedTrips } from "../components/RecommendedTrips"
import { apiFetch } from "../api/client"

interface Trip {
    id: string
    title: string
    description?: string
    city?: string
    adults_count: number
    children_count: number
}

export default function Discover() {
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
            setError('Не смогли загрузить данные')
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
            setError('Не удалось создать поездку')
        }
        
    }
    const deleteTrip = async (id: string) => {
        try { await apiFetch(`/trips/${id}`, {method: 'DELETE' })
        setTrips(prev => prev.filter(t => t.id !== id)) }catch {setError('Не удалость удалить поездку')

        } finally {
            setDeletingId(null)
        }

    }
    return (<div className="discover-page" style={{padding: 32, maxWidth: 800, margin: '0 auto'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24}}>
            <h2 style={{margin: 0}}>Мои поездки</h2>
            <button onClick={() => setIsCreating(true)} style={{padding: '8px 16px', background: '#3b82f6',
            color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14}}>
                Запланировать поездку
            </button>
        </div>
        {error && <p style={{color: 'red', fontSize: 13, marginBottom: 12}}>{error}</p>}
        {isCreating && (
            <div style={{padding: 16, border: '1px solid #e5e7ed', borderRadius: 8, marginBottom: 24,
                display: 'flex', flexDirection: 'column', gap: 8
            }}>
                <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Название поездки"
                style={{padding: '8px 10px', border: '1px solid #e5e7ed', borderRadius: 6, fontSize: 14}} />
                <input value={newCity} onChange={e => setNewCity(e.target.value)} placeholder="Город (Опционально)"
                 style={{padding: '8px 10px', border: '1px solid #e5e7ed', borderRadius: 6, fontSize: 14}} />
                 <div style={{display: 'flex', gap:8}}>
                    <button onClick={createTrip} style={{padding: '8px 16px', background: '#10b981', color: 'white',
                        border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14}}>Создать</button>
                        <button onClick={() => setIsCreating(false)} style={{padding: '8px 16px', background: 'none', color: '#6b7280', border: '1px solid #e5e7ed',
                            borderRadius:6, cursor: 'pointer', fontSize: 14
                        }}>Отмена</button>
                        </div>
                    </div>
                    )}
                    <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
                        {trips.map(trip => (
                            <div key={trip.id} onClick={() => navigate(`/trips/${trip.id}`)}
                            style={{padding: 16, border: '1px solid #e5e7ed', borderRadius: 8, cursor:'pointer', transition: 'box-shadow 0.15s'}}
                            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'}
                            onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
                                <div style ={{display: 'flex', justifyContent: 'space-between'}}>
                                    <strong style={{fontSize:16}}>{trip.title}</strong>
                                    <button onClick={(e) => {
                                        e.stopPropagation()
                                        setDeletingId(trip.id)}} style={{background: 'none', border: 'none', cursor:'pointer', color: '#9ca3af', fontSize: 18}}>✕</button>
                                    
                                    <span style={{fontSize:13, color: '#6b7280'}}>
                                        👥{trip.adults_count + trip.children_count} человек
                                    </span>
                                </div>
                                {trip.city && <div style={{fontSize: 13, color: '#6b7280', marginTop: 4}}>📍 {trip.city}</div> }
                            </div>
                        ))}
                        {trips.length === 0 && (
                            <div style={{textAlign: 'center', color: '#9ca3af', padding: 48}}>
                                Пока нет поездок. Спланируйте первую! 
                                </div>
                        )}
                        {deletingId && (
                            <div style={{
                                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000}}>

                            <div style={{background: 'white', borderRadius: 12, padding: 24, maxWidth: 400, width: '90%'}}>
                            <h3 style={{margin: '0 0 8px'}}>Удалить поездку?</h3>
                            <p style={{color: '#6b7280', fontSize: 14, margin: '0 0 20px'}}>Это действие нельзя отменить</p>
                            <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
                                <button onClick={()=> setDeletingId(null)} style={{
                                    padding: '8px 16px', background: 'white', color: '#374151',
                                    border: '1px solid #e5e7eb', borderRadius:6, cursor: 'pointer'
                                }}>Отмена</button>
                                <button onClick={()=> deleteTrip(deletingId)} style={{
                                    padding: '8px 16px', background: '#ef4444', color: 'white',
                                    border: 'none', borderRadius: 6, cursor: 'pointer'
                                }}>Удалить</button>
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