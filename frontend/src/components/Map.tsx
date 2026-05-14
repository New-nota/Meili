import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Stop } from '../types/index'
import { getStops, getValhallaRoute, optimizeTrip, reorderStops, updateStopTransport } from '../api/trips'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
// временно
const TRIP_ID = '6f838e55-df11-4392-a7f3-ab9ecf908649'
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2Y2YxYTkwOS1jZWJlLTRlZjktYTQ5Mi1jY2UxYmQ5ODAwMWIiLCJleHAiOjE3Nzg3NjM4ODksInR5cGUiOiJhY2Nlc3MifQ.5bPjtbxYvhqXlrdzOewbY4xQUBPwHFi2HDwx4P8XqVE'
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
}

function SortableStop({stop, index, isLast, onTransportChange }: SortableStopProps){
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

export default function Map() {
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
                const {setToken} = await import('../api/trips')
                setToken(TOKEN)
                setStops(await getStops(TRIP_ID))
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
        await reorderStops(TRIP_ID, newStops.map(s => s.id))
    }
    const handleOptimize = async () => {
        setIsOptimizing(true)
        try {
            await optimizeTrip(TRIP_ID)
            setStops( await getStops(TRIP_ID))
        } catch {
            setError('Ошибка оптимизации')
        } finally {
            setIsOptimizing(false)
        }
    }
    const handleTransportChange = async (stopId: string, transport: string) => {
        setStops(prev => prev.map(s => s.id === stopId ? {...s, transport_to_next: transport}: s))
        await updateStopTransport(TRIP_ID, stopId, transport)
        setStops(await getStops(TRIP_ID))
    }
    return (
        <div style={{ position: 'relative', width: '100vw', height: '100vh'}}>
            <div ref={mapContainer} style={{ width: '100%', height: '100%'}} />
            { /*список остановок поверх карты будет тут*/}
            <div style={{
                position: 'absolute',
                top: 16,
                left: 16,
                background: 'white',
                borderRadius: 8,
                padding: 16,
                minWidth: 240,
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                maxHeight: '80vh',
                overflowY: 'auto'
            }}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom:12}}>
                <h3 style={{margin: '0',fontSize: 16}}>Маршрут </h3>
                <button onClick={handleOptimize} disabled={isOptimizing} style={{
                    padding: '6px 12px', background: isOptimizing ? '#9ca3af':'#3b82f6',
                    color: 'white', border: 'none', borderRadius: 6, cursor: isOptimizing ? 'not-allowed': 'pointer', fontSize: 13
                }}>
                    {isOptimizing ? '⏳...' : '✨ Оптимизировать'}
                </button>
                </div>
                {error && <p style={{color: 'red', fontSize:13}}>{error}</p>}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={stops.map(s => s.id)} strategy={verticalListSortingStrategy}>
                        {stops.map((stop, i)=>(
                            <SortableStop key={stop.id} stop={stop} index={i} isLast={i === stops.length - 1} onTransportChange={handleTransportChange} />
                            ))}
                    </SortableContext>
                </DndContext>
                </div>
                </div>
    )
    }
