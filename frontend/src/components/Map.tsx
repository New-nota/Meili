import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { getStops, getValhallaRoute } from '../api/trips'
import type { Stop } from '../types/index'
// временно
const TRIP_ID = '6f838e55-df11-4392-a7f3-ab9ecf908649'
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2Y2YxYTkwOS1jZWJlLTRlZjktYTQ5Mi1jY2UxYmQ5ODAwMWIiLCJleHAiOjE3Nzg1NzEzOTMsInR5cGUiOiJhY2Nlc3MifQ.WrU2YccCJxfAc48qLFMaeIkLThuKeWrga3sOh8fkE74'

export default function Map() {
    const mapContainer = useRef<HTMLDivElement>(null)
    const mapRef = useRef<maplibregl.Map | null>(null)
    const [stops, setStops] = useState<Stop[]>([])
    const [error, setError] = useState<string | null>(null)


//инициализация карты
useEffect(()=> {
    if(!mapContainer.current) return

    const map = new maplibregl.Map({
        container: mapContainer.current,
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [20.5114, 54.7104],
        zoom: 13
    })
    map.addControl(new maplibregl.NavigationControl())
    mapRef.current = map // сохраняем ссылку на карту для переиспользования

    // Когда карта загрузила тайлы — добавляем слои для маршрута
    // Слои нельзя добавить до загрузки карты
    map.on('load', ()=> {
        map.addSource('route', {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: {type: 'LineString', coordinates: []},
                properties: {}
            }
        })
    // Слой — как рисовать данные из источника
    // source и style разделены: можно менять данные не трогая стиль
    map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: {
            'line-join': 'round',
            'line-cap': 'round'
        },
        paint: {
            'line-color': '#3b82f6',
            'line-width': 4,
            'line-opacity': 0.8
            }
        })
    })
    return () => map.remove()
}, [])  

// загрузка остановок с бэкенда
// Запускается один раз после инициализации
useEffect(()=> {
    const loadStops = async () => {
        try {
            const { setToken } = await import ('../api/trips')
            setToken(TOKEN)
            const data = await getStops(TRIP_ID)
            setStops(data)
        } catch (e) {
            setError('Не удалось загрузить остановки :(')
        }
    }
    loadStops()
}, [])

//когда stops обновился — рисуем маршрут и маркеры
// Зависит от stops — запускается каждый раз когда stops меняется

useEffect(() => {
    const map = mapRef.current
    if (!map || stops.length === 0) return
    const drawRoute = async () => {
        // получаем координаты из valhalla
        const coordinates = await getValhallaRoute(stops)
        // ждем карту
        const updateMap = () => {
            const source = map.getSource('route') as maplibregl.GeoJSONSource
            if (!source) return

            // обновляем данные источника линии перестраиваются автоматически
            source.setData ({
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
                    ${stop.transport_to_next ? `<p style="margin: 4px 0 0"> → ${stop.transport_to_next}</p>` : ''}
                    </div>
                    `)
                new maplibregl.Marker({element: el}).setLngLat([stop.place_lon, stop.place_lat]).setPopup(popup).addTo(map)
            })
            // выравниваем чтобы пользователь видел все точки
            if (stops.length > 0) {
                const lons = stops.filter(s => s.place_lon).map(s => s.place_lon!)
                const lats = stops.filter(s => s.place_lat).map( s => s.place_lat!)
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
            minWidth: 200,
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            maxHeight: '80vh',
            overflowY: 'auto'
        }}>
            <h3 style={{margin: '0 0 12px',fontSize: 16}}>Маршрут </h3>
            {error && <p style={{color: 'red'}}>{error}</p>}
            {stops.map((stop, i) => (
                <div key={stop.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 8
                }}>
                    <div style={{
                        width: 24, height: 24,
                        background: '#3b82f6',
                        borderRadius: '50%',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 'bold',
                        flexShrink: 0
                    }}> {i + 1} </div>
                    <span style={{ fontSize: 14 }}>
                        {stop.place_name || 'Без названия'}
                    </span>
                    </div>
            ))}
            </div>
            </div>
)
}