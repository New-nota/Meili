import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {getTrip, updateTrip} from "../api/trips"


export default function TripSettings() {
    const {tripId} = useParams<{tripId: string}>()
    const navigate = useNavigate()

    const [title, setTitle] = useState('')
    const [city, setCity] = useState('')
    const [country, setCountry] = useState('')
    const [adultsCount, setAdultsCount] = useState(1)
    const [childrenCount, setChildrenCount] = useState(0)
    const [childrenAges, setChildrenAges] = useState<number[]>([])
    const [isPublic, setIsPublic] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    useEffect(() => {
        const load = async () => {
            if(!tripId) return
            const trip = await getTrip(tripId)
            setTitle(trip.title || '')
            setCity(trip.city || '')
            setCountry(trip.country || '')
            setAdultsCount(trip.adults_count || 1)
            setChildrenCount(trip.children_count || 0)
            setChildrenAges(trip.childrens_ages || [])
            setIsPublic(trip.is_public || false)
            setIsLoading(false)
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
    const save = async () => {
        if(!tripId) return
        setIsSaving(true)
        try {
            await updateTrip(tripId, {title, city, country, adults_count: adultsCount, children_count: childrenCount, children_ages: childrenAges, is_public: isPublic})
            navigate(`/trips/${tripId}`)
        } finally {
            setIsSaving(false)
        }
    }

    const deleteTrip = async () => {
        await fetch(`http://localhost:8000/trips/${tripId}`, {
            method: 'DELETE',
            headers: {'Authorization': `Bearer ${localStorage.getItem('access_token')}`}
        })
        navigate('/discover')
    }
    if (isLoading) return <div style={{padding:32}}>Загрузка...</div>

    return (
        <div style={{padding: 32, maxWidth: 600, margin: '0 auto'}}>
            <div style={{display: 'flex', alignItems: 'center', gap:12, marginBottom: 24}}>
                <button onClick={() => navigate(`/trips/${tripId}`)} style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#6b7280'}}>&#8592;</button>
                    <h2 style={{margin: 0}}>Состав поездки</h2>
            </div>

            <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
                {/*MAIN */}
                <div>
                    <label style={{fontSize: 13, color: '#6b7280'}}>Название для путешествия</label>
                    <input value={title} onChange={e => setTitle(e.target.value)}
                    style={{display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid #e5e7ed', borderRadius: 6, fontSize: 14, boxSizing: 'border-box'}} />
                </div>
                <div style={{display: 'flex', gap:12}}>
                    <div style={{flex: 1}}>
                        <label style={{fontSize: 13, color: '6b7280'}}>Город</label>
                        <input value={city} onChange={e => setCity(e.target.value)}
                        style={{display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid #e5e7ed', borderRadius: 6, fontSize: 14, boxSizing: 'border-box'}} />
                    </div>
                    <div style={{flex: 1}}>
                        <label style={{fontSize: 13, color: '6b7280'}}>Страна</label>
                        <input value={country} onChange={e => setCountry(e.target.value)}
                        style={{display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid #e5e7ed', borderRadius: 6, fontSize: 14, boxSizing: 'border-box'}} />
                    </div>
                </div>
                {/*Группа */}
                <div style={{padding: 16, border: '1px solid #e5e7eb', borderRadius: 8}}>
                    <div style={{fontSize: 14, fontWeight: 500, marginBottom: 12}}>&#128101; Группа 

                    </div>
                    <div style={{display: 'flex', alignItems: 'center', gap: 8, marginTop: 4}}>
                        <button onClick={() => setAdultsCount(Math.max(1, adultsCount - 1))}
                        style={{width: 28, height: 28, border: '1px solid #e5e7eb', borderRadius: 4, cursor: 'pointer'}}>-</button>
                        <span style={{fontSize: 16, minWidth:20, textAlign: 'center'}}>{adultsCount}</span>
                        <button onClick={()=> setAdultsCount(adultsCount + 1)}
                        style={{width: 28, height: 28, border: '1px solid #e5e7eb', borderRadius: 4, cursor: 'pointer'}}>+</button>
                    </div>
                
                <div>
                    <label style={{ fontSize: 13, color: '#6b7280'}}>Дети</label>
                    <div style={{display: 'flex', alignItems: 'center', gap: 8, marginTop: 4}}>
                        <button onClick={() => handleChildrenCount(Math.max(0, childrenCount - 1))}
                        style={{width: 28, height: 28, border: '1px solid #e5e7eb', borderRadius: 4, cursor: 'pointer'}}>-</button>
                        <span style={{fontSize: 16, minWidth: 20, textAlign: 'center'}}>{childrenCount}</span>
                        <button onClick={() => handleChildrenCount(childrenCount + 1)}
                            style={{width: 28, height: 28, border: '1px solid #0000', borderRadius: 4, cursor: 'pointer'}}>+</button>
                    </div>
                
            {/*Возраст детей */}
            {childrenCount > 0 && (
                <div >
                    <label style={{fontSize: 13, color: '#6b7280'}}>Возраст детей</label>
                    <div style={{display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap'}}>
                        {childrenAges.map((age, i) => (
                            <input key={i} type="number" min={0} max={17} value={age}
                            onChange={e => {const newAges = [...childrenAges]
                                 newAges[i]= parseInt(e.target.value) || 0
                                setChildrenAges(newAges)}}
                                style={{width: 56, padding: '6px, 8px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize:15, textAlign: 'center'}} />
                        ))}
                    </div>
                
                </div>
            )}
            </div>
        </div>
        </div>
        {/*Публикация */}
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, border: '1px solid #e5e7eb', borderRadius: 8}}>
            <div>
                <div style={{fontSize: 14, fontWeight: 500}}>&#127757; Публичный маршрут</div>
                <div style={{fontSize: 13, color: '#6b7280', marginTop: 2}}>Дрегие пользователи будут видеть ваш маршрут и смогут в будующем повторить</div>
            </div>
            <input type="checkbox" checked={isPublic} onChange={e=> setIsPublic(e.target.checked)}
            style={{width:18, height: 18, cursor: 'pointer'}} />
        </div>
        <button onClick={save} disabled={isSaving} style={{
            padding: '10px 24px', background: isSaving ? '#9ca3af': '#3b82f6',
            color: 'white', border: 'none', borderRadius: 6, cursor: isSaving ? 'not-allowed':'pointer', fontSize: 14}}>
        {isSaving ? 'Сохранение...' : 'Сохранить'}</button>
        {/*Удалить*/}
        <button onClick={() => setShowDeleteModal(true)} style={{
            padding: '10px 24px', background: 'none', color: '#ef4444',
            border: '1px solid #ef4444', borderRadius: 6, cursor: 'pointer', fontSize: 14
        }}> Удалить поездку</button>
        {/*Подтверждение */}
        {showDeleteModal && (
            <div style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
            }}>
                <div style={{background: 'white', borderRadius: 12, padding: 24, maxWidth: 400, width: '90%'}}>
                    <h3 style={{margin: '0 0 8px'}}>Удалить поездку?</h3>
                    <p style={{color: '#6b7280', fontSize: 14, margin: ' 0 0 20px'}}>
                        Это действие нельзя отменить.
                    </p>
                <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
                    <button onClick={() => setShowDeleteModal(false)} style={{
                        padding: '8px 16px', background: 'none', color: '#374151', border: '1px solid #e5e7eb',
                        borderRadius: 6, cursor: 'pointer'
                    }}>Отмена</button>
                <button onClick={deleteTrip} style={{
                    padding: '8px 16px', background: '#ef4444', color: 'white',
                    border: 'none', borderRadius: 6, cursor: 'pointer'
                }}>Удалить</button>
                </div>
                </div>
            </div>)}
        </div>
    )
}