import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Stop } from '../types/index'
import { getStops, getValhallaRoute, optimizeTrip, reorderStops, updateStopTransport } from '../api/trips'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import PlaceSearch from '../components/PlaceSearch'

const TRANSPORT_OPTIONS = [
    {value: 'pedestrian', label: '🚶'},
    {value: 'bicycle', label: '🚲'},
    {value: 'auto', label:'🚗'},
]
interface SortableStopProps {
    stop: Stop
    index: number
    isLast: boolean
    onTransportChange: (stopId: string, transport: string) => void
    onDelete: (stopId: string) => void
}

function SortableStop({stop, index, isLast, onTransportChange, onDelete }: SortableStopProps){
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.id})
    return (
        <div ref={setNodeRef} style = {{transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1}}
        {...attributes}>
            {/*строка с номером и названием*/}
            <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4}}>
                <span {...listeners} style={{cursor: 'grab', color: '#9ca3af', fontSize: 18, userSelect: 'none'}}>
                     ⠿
                </span>
                <div style={{
                    width: 24, height: 24, background: '#3b82f6', borderRadius: '50%',
                    color: 'white', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 12, fontWeight: 'bold', flexShrink: 0
                }}>
                    { index + 1}
                </div>
                <span style={{fontSize: 14}}>{stop.place_name || 'Без названия'}</span>
                <button onClick={() => onDelete(stop.id)} style={{background: 'none', border: 'none', cursor: 'pointer',
                    color: '#9ca3af', fontSize: 16, padding: '0 4px', lineHeight: 1
                }}>✕</button>
            </div>
            {/* переключатель транспорта не показываем для последней точки*/}
            {!isLast && (
                <div style={{display: 'flex', gap: 4, marginLeft: 44, marginBottom: 10}}>
                    {TRANSPORT_OPTIONS.map(opt => (<button key={opt.value} onClick={() => onTransportChange(stop.id, opt.value)}
                    style={{padding: '2px 8px', border: `1px solid ${stop.transport_to_next === opt.value ? '#eff6ff' : '#e5e7eb'}`,
                    borderRadius: 12, background: stop.transport_to_next == opt.value ? '#eff6ff' : 'white', cursor: 'pointer', fontSize: 14}}> 
                    {opt.label} </button>
                    ))}
                    </div>
            )}
        </div>
    )
}

export default function TripPlanner() {
    const {tripId} = useParams<{tripId: string}>()
    const mapContainer = useRef<HTMLDivElement>(null)
    const mapRef = useRef<maplibregl.Map | null>(null)
    const markersRef = useRef<maplibregl.Marker[]>([])
    const [stops, setStops] = useState<Stop[]>([])
    const [error, setError] = useState<string | null>(null)
    const [isOptimizing, setIsOptimizing] = useState(false)
    const sensors = useSensors(useSensor(PointerSensor))
    useEffect(()=> {
        if(!mapContainer.current) return
        const map = new maplibregl.Map({
            container: mapContainer.current,
            style: 'https://tiles.openfreemap.org/styles/liberty',
            center: [20.5114, 54.7104],
            zoom: 13
        })
        map.addControl( new maplibregl.NavigationControl())
        mapRef.current = map
        map.on('load',() => {map.addSource('route', {type: 'geojson', data: {type: 'Feature', geometry: {type: 'LineString', coordinates: []}, properties: {}}
        })
        map.on('click', async (e) => {
            const {lng, lat} = e.lngLat
            const res = await fetch (`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
                {headers: {'Accept-Language': 'ru'}}
            )
            const data = await res.json()
            new maplibregl.Popup().setLngLat([lng, lat]).setHTML(
                `<div style="padding: 8px; min-width: 200px">
                <strong style="font-size: 14px"> ${data.name || data.display_name.split(',')[0]}</strong>
                <p style="font-size: 12px; color: #6b7280; matgin: 4px 0 8px">${data.display_name.split(',').slice(0,3).join(',')}</p>
                <button id="add-place-btn" data-name="${(data.name || data.display_name.split(',')[0]).replace(/"/g, '')}"
                data-lat="${lat}"
                data-lon="${lng}"
                data-address="${data.display_name.replace(/"/g, '')}"
                style="padding: 6px 12px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px">
                + Добавить в маршрут
                </button>
                </div>`
            ).addTo(map)

            setTimeout(()=> {
                document.getElementById('add-place-btn')?.addEventListener('click', async (ev) => {
                    const btn = ev.target as HTMLButtonElement
                    const name = btn.dataset.name! 
                    const lat = parseFloat(btn.dataset.lat!)
                    const lon = parseFloat(btn.dataset.lon!)
                    const address = btn.dataset.address!
                    const placeRes = await fetch('http://localhost:8000/places', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
                        },
                        body: JSON.stringify({name, lat, lon, address})
                    })
                    if (!placeRes.ok) return
                    const place = await placeRes.json()
                    await fetch(`http://localhost:8000/trips/${tripId}/stops`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
                        },
                        body: JSON.stringify({place_id: place.id})
                    })
                    reloadStops()
                })
            }, 50)
        })
        map.addLayer({
            id: 'route-line', type: 'line', source: 'route', 
            layout: {'line-join': 'round', 'line-cap': 'round'},
            paint: {'line-color': '#3b82f6', 'line-width': 4, 'line-opacity': 0.8}
        })
        })
        return () => map.remove()
    }, [])
    useEffect(() => {
        const load = async () => {
            try {
                setStops(await getStops(tripId!))
            } catch {
                setError('Не удалось загрузить остановки :(')
            }
        }
        load()
    }, [])
    useEffect(() => {
    const map = mapRef.current
    if (!map || stops.length === 0) return
    const drawRoute = async () => {
        // получаем координаты из valhalla
        const coordinates = await getValhallaRoute(stops)
        // ждем карту
        const updateMap = () => {
            markersRef.current.forEach(m => m.remove())
            markersRef.current = []
            const source = map.getSource('route') as maplibregl.GeoJSONSource

            // обновляем данные источника линии перестраиваются автоматически
            source?.setData ({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates
                },
                properties: {}
            })
            // добавляем маркер на каждую остановку
            stops.forEach((stop, index) => {
                if(!stop.place_lat || !stop.place_lon) return
                const el = document.createElement('div')
                el.style.cssText = `
                    width: 32px;
                    height: 32px;
                    background: #3b82f6;
                    border: 2px solid white;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: bold;
                    font-size: 14px;
                    cursor: pointer;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                `
                el.textContent = String(index + 1)

                // появится при клике на маркер
                const popup = new maplibregl.Popup({offset: 20}).setHTML(`
                    <div style="padding: 8px">
                    <strong>${stop.place_name || 'Без названия'}</strong>
                    ${stop.duration_minutes ? `<p style="margin: 4px 0 0">⏱ ${stop.duration_minutes} мин</p>`: ''}
                    </div>
                    `)
                
                const marker = new maplibregl.Marker({element: el}).setLngLat([stop.place_lon, stop.place_lat]).setPopup(popup).addTo(map) 
                markersRef.current.push(marker)
            })
            // выравниваем чтобы пользователь видел все точки
                const lons = stops.filter(s => s.place_lon).map(s => s.place_lon!)
                const lats = stops.filter(s => s.place_lat).map( s => s.place_lat!)
                
                if (lons.length > 1) {
                    
                    map.fitBounds(
                        [
                            [Math.min(...lons), Math.min(...lats)],
                            [Math.max(...lons), Math.max(...lats)]
                        ],
                        { padding: 80}
                    )
                }
            }
            if (map.isStyleLoaded()) {
                updateMap()
            } else {
                map.once('load', updateMap)
            }
        }
        drawRoute()

    }, [stops])
    
    const handleDragEnd = async (event: DragEndEvent) => {
        const {active, over} = event
        if(!over || active.id === over.id) return
        const oldIndex = stops.findIndex(s => s.id === active.id)
        const newIndex = stops.findIndex(s => s.id === over.id)
        const newStops = arrayMove (stops, oldIndex, newIndex)
        setStops(newStops)
        await reorderStops(tripId!, newStops.map(s => s.id))
    }
    const handleOptimize = async () => {
        setIsOptimizing(true)
        try {
            await optimizeTrip(tripId!)
            setStops( await getStops(tripId!))
        } catch {
            setError('Ошибка оптимизации')
        } finally {
            setIsOptimizing(false)
        }
    }
    const handleTransportChange = async (stopId: string, transport: string) => {
        setStops(prev => prev.map(s => s.id === stopId ? {...s, transport_to_next: transport}: s))
        await updateStopTransport(tripId!, stopId, transport)
        setStops(await getStops(tripId!))
    }
     const reloadStops = async () => {
        setStops(await getStops(tripId!))
    }
    const handleDelete = async (stopId: string) => {
        await fetch (`http://localhost:8000/trips/${tripId!}/stops/${stopId}`, {
            method: 'DELETE',
            headers: {'Authorization': `Bearer ${localStorage.getItem('access_token')}`}
        })
        await reloadStops()
    }
    if (!tripId) return <div>Поездка не найдена</div>
    return (
        <div style={{ display: 'flex', width: '100vw', height: '100vh'}}>
            {/*Left pannel*/}
            <div style={{
                width: 320,
                flexShrink: 0,
                background: 'white',
                borderRight: '1px solid #e5e7eb',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
            }}>
                {/* Заголовок */}
                <div style={{padding: '16px', borderBottom: '1px solid #e5e7eb'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom:12}}>
                <h3 style={{margin: '0',fontSize: 16}}>Маршрут </h3>
                <button onClick={handleOptimize} disabled={isOptimizing} style={{
                    padding: '6px 12px', background: isOptimizing ? '#9ca3af':'#3b82f6',
                    color: 'white', border: 'none', borderRadius: 6, cursor: isOptimizing ? 'not-allowed': 'pointer', fontSize: 13
                }}>
                    {isOptimizing ? '⏳...' : '✨ Оптимизировать'}
                </button>
                </div>
                </div>
                <PlaceSearch tripId={tripId} onPlaceAdded={reloadStops}/>
                {/*Сприсок остановок скролится  */}
                <div style={{flex: 1, overflowY: 'auto', padding: 16}}>
                {error && <p style={{color: 'red', fontSize:13}}>{error}</p>}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={stops.map(s => s.id)} strategy={verticalListSortingStrategy}>
                        {stops.map((stop, i)=>(
                            <SortableStop key={stop.id} stop={stop} index={i} isLast={i === stops.length - 1} onTransportChange={handleTransportChange} onDelete={handleDelete}/>
                            ))}
                    </SortableContext>
                </DndContext>
                </div>
                </div>
                {/* Карта все остальное место займет*/}
                <div ref={mapContainer} style={{flex: 1}} />
                </div>
            
    )
    }
