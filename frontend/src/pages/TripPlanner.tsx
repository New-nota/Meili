import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Stop } from '../types/index'
import { getStops, getValhallaRouteForPoints, reorderStops, updateStopTransport, getTrip, downloadExport } from '../api/trips'
import { addLocation, getDays, getLocations, updateDay, type TripDay, type TripLocation } from '../api/days'
import DayCard from '../components/DayCard'
import BudgetPanel from '../components/BudgetPanel'
import { formatPlaceLabel, type ClickedPoint, type NominatimReverseResult } from '../utils/mapPoint'
import { applyPaperStyle, DAY_HEX } from '../utils/mapStyle'
import Logo from '../components/Logo'
import DayPill from '../components/DayPill'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import PlaceSearch from '../components/PlaceSearch'
import StartPoint from '../components/StartPoint'
import StopDetailPanel from '../components/StopDetailPanel'
import { apiFetch } from '../api/client'
import { useQueryClient } from '@tanstack/react-query'
import type { Place } from '../types/index'

const TRANSPORT_OPTIONS = [
    {value: 'pedestrian', label: '🚶'},
    {value: 'bicycle', label: '🚲'},
    {value: 'auto', label:'🚗'},
]
// стартовый вид карты до загрузки остановок (MVP-регион — Калининград);
// после загрузки камера подстраивается через fitBounds
const DEFAULT_MAP_CENTER: [number, number] = [20.5114, 54.7104]
const DEFAULT_MAP_ZOOM = 13
interface SortableStopProps {
    stop: Stop
    index: number
    isLast: boolean
    onTransportChange: (stopId: string, transport: string) => void
    onDelete: (stopId: string) => void
    onSelect: (stop: Stop) => void
}

function SortableStop({stop, index, isLast, onTransportChange, onDelete, onSelect }: SortableStopProps){
    const { t } = useTranslation()
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.id})
    return (
        <div ref={setNodeRef} style = {{transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1}}
        {...attributes}>
            {/*строка с номером и названием*/}
            <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4}}>
                <span {...listeners} style={{cursor: 'grab', color: 'var(--text-muted)', fontSize: 18, userSelect: 'none'}}>
                     ⠿
                </span>
                <div style={{
                    width: 24, height: 24, background: 'var(--accent)', borderRadius: '50%',
                    color: 'var(--surface)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 12, fontWeight: 'bold', flexShrink: 0
                }}>
                    { index + 1}
                </div>
                <span onClick={() => onSelect(stop)} style={{fontSize: 14, cursor: 'pointer', flex: 1}}>
                    {stop.place_name || t('common.untitled')}
                    {stop.is_booked && <span title="🎟"> 🎟</span>}
                </span>
                <button onClick={() => onDelete(stop.id)} style={{background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', fontSize: 16, padding: '0 4px', lineHeight: 1
                }}>✕</button>
            </div>
            {/* переключатель транспорта не показываем для последней точки*/}
            {!isLast && (
                <div style={{display: 'flex', gap: 4, marginLeft: 44, marginBottom: 10}}>
                    {TRANSPORT_OPTIONS.map(opt => (<button key={opt.value} onClick={() => onTransportChange(stop.id, opt.value)}
                    style={{padding: '2px 8px', border: `1px solid ${stop.transport_to_next === opt.value ? 'var(--surface)' : 'var(--border)'}`,
                    borderRadius: 12, background: stop.transport_to_next == opt.value ? 'var(--surface)' : 'var(--surface-raised)', cursor: 'pointer', fontSize: 14}}> 
                    {opt.label} </button>
                    ))}
                    </div>
            )}
        </div>
    )
}

export default function TripPlanner() {
    const { t, i18n } = useTranslation()
    const {tripId} = useParams<{tripId: string}>()
    const mapContainer = useRef<HTMLDivElement>(null)
    const mapRef = useRef<maplibregl.Map | null>(null)
    const markersRef = useRef<maplibregl.Marker[]>([])
    const [stops, setStops] = useState<Stop[]>([])
    const [error, setError] = useState<string | null>(null)
    const sensors = useSensors(useSensor(PointerSensor))
    const [trip, setTrip] = useState<{start_lat?: number, start_lon?: number, start_address?: string, start_time?: string, adults_count?: number, children_count?: number} | null>(null)
    const [selectedStop, setSelectedStop] = useState<Stop | null>(null)
    // S8 WP-3: мульти-день
    const [days, setDays] = useState<TripDay[]>([])
    const [locations, setLocations] = useState<TripLocation[]>([])
    const [expandedDayId, setExpandedDayId] = useState<string | null>(null)
    const [panelTab, setPanelTab] = useState<'route' | 'budget'>('route')
    // S9 WP-E: карточка точки на карте (toggle, Esc, «сделать точкой старта»)
    const [clickedPoint, setClickedPoint] = useState<ClickedPoint | null>(null)
    const clickedPointRef = useRef<ClickedPoint | null>(null)
    clickedPointRef.current = clickedPoint
    const i18nRef = useRef(i18n)
    i18nRef.current = i18n
    const pinRef = useRef<maplibregl.Marker | null>(null)
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const reloadDays = async () => {
        const [d, l] = await Promise.all([getDays(tripId!), getLocations(tripId!)])
        setDays(d)
        setLocations(l)
        // по умолчанию раскрыт первый день
        setExpandedDayId(prev => prev ?? (d[0]?.id ?? null))
        return d
    }

    useEffect(() => {
        reloadDays().catch(() => {})
    }, [tripId])

    useEffect(()=> {
        const load = async () => {
            const res = await getTrip(tripId!)
            if (res) setTrip(res)
        }
    load()
    // tripId в deps: при переходе между поездками роутер переиспользует компонент
    }, [tripId] )

    useEffect(()=> {
        if(!mapContainer.current) return
        const map = new maplibregl.Map({
            container: mapContainer.current,
            style: 'https://tiles.openfreemap.org/styles/liberty',
            center: DEFAULT_MAP_CENTER,
            zoom: DEFAULT_MAP_ZOOM
        })
        map.addControl( new maplibregl.NavigationControl())
        mapRef.current = map
        map.on('load',() => {
        // S10: приглушённая «бумага» — насыщенным остаётся только маршрут
        applyPaperStyle(map)
        map.addSource('route', {type: 'geojson', data: {type: 'Feature', geometry: {type: 'LineString', coordinates: []}, properties: {}}
        })
        // слои режима «Все дни»: приглушённые тона палитры дней (S10)
        DAY_HEX.forEach((hex, i) => {
            map.addSource(`route-day-${i}`, {type: 'geojson', data: {type: 'Feature', geometry: {type: 'LineString', coordinates: []}, properties: {}}})
            map.addLayer({
                id: `route-day-line-${i}`, type: 'line', source: `route-day-${i}`,
                layout: {'line-join': 'round', 'line-cap': 'round'},
                paint: {'line-color': hex, 'line-width': 3, 'line-opacity': 0.75},
            })
        })
        map.on('click', async (e) => {
            // S9 WP-E Fix 1: toggle как в Google Maps — при открытой карточке
            // клик по пустой карте закрывает её, новый пин не ставится
            if (clickedPointRef.current !== null) {
                setClickedPoint(null)
                return
            }
            const {lng, lat} = e.lngLat
            // Fix 3: addressdetails+namedetails для формата «улица дом» / POI
            const res = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&namedetails=1`,
                {headers: {'Accept-Language': i18nRef.current.language}}
            )
            const data: NominatimReverseResult = await res.json()
            const label = formatPlaceLabel(data, lat, lng)
            setClickedPoint({
                lat, lng, label,
                address: data.display_name ?? null,
                osmId: data.osm_type && data.osm_id ? `${data.osm_type}/${data.osm_id}` : null,
            })
        })
        map.addLayer({
            id: 'route-line', type: 'line', source: 'route', 
            layout: {'line-join': 'round', 'line-cap': 'round'},
            paint: {'line-color': '#B04A24', 'line-width': 4.5, 'line-opacity': 0.9}
        })
        })
        return () => map.remove()
    }, [])

    // Esc закрывает карточку точки (S9 WP-E)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setClickedPoint(null)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    // пин на месте клика
    useEffect(() => {
        pinRef.current?.remove()
        pinRef.current = null
        const map = mapRef.current
        if (map && clickedPoint) {
            pinRef.current = new maplibregl.Marker({ color: 'var(--accent)' })
                .setLngLat([clickedPoint.lng, clickedPoint.lat])
                .addTo(map)
        }
    }, [clickedPoint])

    useEffect(() => {
        const load = async () => {
            try {
                setStops(await getStops(tripId!))
            } catch {
                setError(t('trip.stopsLoadError'))
            }
        }
        load()
    }, [tripId])

    // S8 WP-3: активный день — его стопы и депо; без дней — все стопы поездки
    const activeDay = days.find(d => d.id === expandedDayId) ?? null
    const routeStops = activeDay ? activeDay.stops : stops

    useEffect(() => {
    const map = mapRef.current
    if (!map || (routeStops.length === 0 && !activeDay)) return
    const drawRoute = async () => {
        const emptyLine = {type: 'Feature' as const, geometry: {type: 'LineString' as const, coordinates: [] as number[][]}, properties: {}}
        const clearDayLayers = () => DAY_HEX.forEach((_, i) => {
            (map.getSource(`route-day-${i}`) as maplibregl.GeoJSONSource | undefined)?.setData(emptyLine)
        })

        // S10: режим «Все дни» — маршруты приглушёнными тонами --day-1…6
        if (!activeDay && days.length > 0) {
            const paintOverview = async () => {
                markersRef.current.forEach(m => m.remove())
                markersRef.current = []
                ;(map.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData(emptyLine)
                const lons: number[] = [], lats: number[] = []
                for (let i = 0; i < days.length; i++) {
                    const day = days[i]
                    const dayStops = day.stops.filter(st => st.included_in_route !== false && st.place_lat && st.place_lon)
                    const pts = [
                        ...(day.start_location ? [{lat: day.start_location.lat, lon: day.start_location.lon}] : []),
                        ...dayStops.map(st => ({lat: st.place_lat!, lon: st.place_lon!})),
                        ...(day.end_location ? [{lat: day.end_location.lat, lon: day.end_location.lon}] : []),
                    ]
                    const coords = await getValhallaRouteForPoints(pts)
                    ;(map.getSource(`route-day-${i % DAY_HEX.length}`) as maplibregl.GeoJSONSource | undefined)
                        ?.setData({type: 'Feature', geometry: {type: 'LineString', coordinates: coords}, properties: {}})
                    // номерные бейджи цвета дня
                    dayStops.forEach((st, idx) => {
                        const el = document.createElement('div')
                        el.style.cssText = `width:24px;height:24px;background:var(--day-${(i % 6) + 1});border:2px solid var(--surface-raised);border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--surface-raised);font-weight:bold;font-size:11px;cursor:pointer;`
                        el.textContent = String(idx + 1)
                        markersRef.current.push(
                            new maplibregl.Marker({element: el})
                                .setLngLat([st.place_lon!, st.place_lat!]).addTo(map)
                        )
                        lons.push(st.place_lon!); lats.push(st.place_lat!)
                    })
                }
                if (lons.length > 1) {
                    map.fitBounds(
                        [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
                        {padding: 80},
                    )
                }
            }
            if (map.isStyleLoaded()) paintOverview()
            else map.once('load', paintOverview)
            return
        }

        // точки маршрута: [старт дня] + стопы + [финиш дня];
        // исключённые селективным прогоном (S8 WP-4) в линию не входят
        const includedStops = routeStops.filter(s => s.included_in_route !== false)
        const stopPoints = includedStops
            .filter(s => s.place_lat && s.place_lon)
            .map(s => ({lat: s.place_lat!, lon: s.place_lon!}))
        const routePoints = activeDay
            ? [
                ...(activeDay.start_location ? [{lat: activeDay.start_location.lat, lon: activeDay.start_location.lon}] : []),
                ...stopPoints,
                ...(activeDay.end_location ? [{lat: activeDay.end_location.lat, lon: activeDay.end_location.lon}] : []),
              ]
            : stopPoints
        const coordinates = await getValhallaRouteForPoints(routePoints)
        // ждем карту
        const updateMap = () => {
            markersRef.current.forEach(m => m.remove())
            markersRef.current = []
            clearDayLayers()
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
            // маркеры: включённые — синие с номером; «не влезло» (S8 WP-4) —
            // приглушённые серые, вне линии маршрута
            const droppedStops = routeStops.filter(s => s.included_in_route === false)
            includedStops.forEach((stop, index) => {
                if(!stop.place_lat || !stop.place_lon) return
                const el = document.createElement('div')
                el.style.cssText = `
                    width: 32px;
                    height: 32px;
                    background: var(--accent);
                    border: 2px solid var(--surface-raised);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--surface);
                    font-weight: bold;
                    font-size: 14px;
                    cursor: pointer;
                    box-shadow: 0 2px 4px color-mix(in srgb, var(--text-primary) 30%, transparent);
                `
                el.textContent = String(index + 1)

                // появится при клике на маркер
                const popup = new maplibregl.Popup({offset: 20}).setHTML(`
                    <div style="padding: 8px">
                    <strong>${stop.place_name || t('common.untitled')}</strong>
                    ${stop.duration_minutes ? `<p style="margin: 4px 0 0">${t('place.durationMin', {count: stop.duration_minutes})}</p>`: ''}
                    </div>
                    `)
                
                const marker = new maplibregl.Marker({element: el}).setLngLat([stop.place_lon, stop.place_lat]).setPopup(popup).addTo(map)
                markersRef.current.push(marker)
            })
            // приглушённые маркеры исключённых стопов (S8 WP-4)
            droppedStops.forEach(stop => {
                if(!stop.place_lat || !stop.place_lon) return
                const el = document.createElement('div')
                el.style.cssText = `
                    width: 26px; height: 26px; background: var(--border);
                    border: 2px solid var(--surface-raised); border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    color: var(--text-muted); font-size: 12px; cursor: pointer;
                    opacity: 0.65; box-shadow: 0 1px 3px color-mix(in srgb, var(--text-primary) 20%, transparent);
                `
                el.textContent = '✕'
                const popup = new maplibregl.Popup({offset: 20}).setHTML(`
                    <div style="padding: 8px">
                    <strong>${stop.place_name || t('common.untitled')}</strong>
                    <p style="margin: 4px 0 0; font-size: 12px; color: var(--text-muted)">${t('place.notFitLabel')}</p>
                    </div>`)
                const marker = new maplibregl.Marker({element: el}).setLngLat([stop.place_lon, stop.place_lat]).setPopup(popup).addTo(map)
                markersRef.current.push(marker)
            })
            // депо активного дня: 🏁 старт и финиш (S8 WP-3)
            const depotMarker = (loc: {lat: number, lon: number, name?: string | null}, label: string) => {
                const el = document.createElement('div')
                el.style.cssText = `
                    width: 32px; height: 32px; background: var(--accent); border: 2px solid var(--surface-raised);
                    border-radius: 50%; display: flex; align-items: center; justify-content: center;
                    font-size: 16px; box-shadow: 0 2px 4px color-mix(in srgb, var(--text-primary) 30%, transparent);
                `
                el.textContent = '🏁'
                const popup = new maplibregl.Popup({offset: 20}).setHTML(
                    `<div style="padding: 8px"><strong>${label}</strong><p style="font-size: 12px; color: var(--text-muted)">${loc.name || ''}</p></div>`)
                const m = new maplibregl.Marker({element: el}).setLngLat([loc.lon, loc.lat]).setPopup(popup).addTo(map)
                markersRef.current.push(m)
            }
            if (activeDay?.start_location) depotMarker(activeDay.start_location, t('day.startOfDay'))
            if (activeDay?.end_location) depotMarker(activeDay.end_location, t('day.endOfDay'))
            if (!activeDay && trip?.start_lat && trip?.start_lon) {
                const el = document.createElement('div')
                el.style.cssText = `
                    width: 32px; height: 32px; background: var(--accent); border: 2px solid var(--surface-raised);
                    border-radius: 50%; display: flex; align-items: center; justify-content: center;
                    font-size: 16px; box-shadow: 0 2px 4px color-mix(in srgb, var(--text-primary) 30%, transparent);
                `
                el.textContent = '🏠'
                const popup = new maplibregl.Popup({offset: 20}).setHTML(`<div style="padding: 8px"><strong>${t('place.home')}</strong><p style="font-size: 12px; color: var(--text-muted)">${trip.start_address || ''}</p></div>`)
                new maplibregl.Marker ( {element: el }).setLngLat([trip.start_lon, trip.start_lat]).setPopup(popup).addTo(map)
            }
            // выравниваем по узлам дня (депо + стопы), чтобы всё было видно
                const lons = routeStops.filter(s => s.place_lon).map(s => s.place_lon!)
                const lats = routeStops.filter(s => s.place_lat).map( s => s.place_lat!)
                if (activeDay?.start_location) { lons.push(activeDay.start_location.lon); lats.push(activeDay.start_location.lat) }
                if (activeDay?.end_location) { lons.push(activeDay.end_location.lon); lats.push(activeDay.end_location.lat) }
                
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

    }, [stops, trip, days, expandedDayId])
    
    const handleDragEnd = async (event: DragEndEvent) => {
        const {active, over} = event
        if(!over || active.id === over.id) return
        const oldIndex = stops.findIndex(s => s.id === active.id)
        const newIndex = stops.findIndex(s => s.id === over.id)
        const newStops = arrayMove (stops, oldIndex, newIndex)
        setStops(newStops)
        await reorderStops(tripId!, newStops.map(s => s.id))
    }
    const handleTransportChange = async (stopId: string, transport: string) => {
        setStops(prev => prev.map(s => s.id === stopId ? {...s, transport_to_next: transport}: s))
        await updateStopTransport(tripId!, stopId, transport)
        setStops(await getStops(tripId!))
    }
     const reloadStops = async () => {
        const fresh = await getStops(tripId!)
        setStops(fresh)
        // выбранная остановка могла измениться (например, is_booked)
        setSelectedStop(prev => prev ? fresh.find(s => s.id === prev.id) ?? null : null)
        // стопы дней тоже могли измениться (S8 WP-3)
        await reloadDays().catch(() => {})
        // сводка бюджета пересчитывается вживую (S9 WP-A)
        queryClient.invalidateQueries({ queryKey: ['budget', tripId] })
    }
    const handleDelete = async (stopId: string) => {
        await apiFetch(`/trips/${tripId!}/stops/${stopId}`, {
            method: 'DELETE',
        })
        await reloadStops()
    }

    // S9 WP-E: действия карточки точки
    const addClickedToRoute = async () => {
        if (!clickedPoint) return
        try {
            const place = await apiFetch<Place>('/places', {
                method: 'POST',
                body: JSON.stringify({
                    name: clickedPoint.label,
                    lat: clickedPoint.lat,
                    lon: clickedPoint.lng,
                    address: clickedPoint.address,
                    osm_id: clickedPoint.osmId,
                }),
            })
            await apiFetch(`/trips/${tripId}/stops`, {
                method: 'POST',
                body: JSON.stringify({ place_id: place.id, day_id: expandedDayId }),
            })
            setClickedPoint(null)
            reloadStops()
        } catch {
            setError(t('trip.addPlaceError'))
        }
    }

    const makeClickedStart = async () => {
        // Fix 2: создать локацию из точки и сделать её стартом активного дня
        if (!clickedPoint || !activeDay) return
        const loc = await addLocation(tripId!, {
            name: clickedPoint.label,
            address: clickedPoint.address ?? undefined,
            lat: clickedPoint.lat,
            lon: clickedPoint.lng,
            kind: 'custom',
        })
        await updateDay(tripId!, activeDay.id, { start_location_id: loc.id })
        setClickedPoint(null)
        await reloadDays()
    }

    if (!tripId) return <div>{t('trip.notFound')}</div>
    return (
        <div className="planner-layout">
            {/*Left pannel — на мобильных уезжает под карту (см. index.css)*/}
            <div className="planner-panel">
                {/* Заголовок */}
                <div style={{padding: '16px', borderBottom: '1px solid var(--border)'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom:12}}>
                    <span style={{display: 'flex', alignItems: 'center', gap: 6}}>
                        <span onClick={() => navigate('/discover')} style={{cursor: 'pointer', display: 'flex'}}>
                            <Logo size={26} withWordmark />
                        </span>
                        <button onClick={() => navigate(`/trips/${tripId}/settings`)} style={{background: 'none', border: 'none',cursor: 'pointer', fontSize: 18, color:'var(--text-muted)'}}>&#9881;</button>
                    </span>
                <div style={{display: 'flex', gap: 4}}>
                    {(['route', 'budget'] as const).map(tab => (
                        <button key={tab} onClick={() => setPanelTab(tab)} style={{
                            padding: '4px 10px', fontSize: 13, cursor: 'pointer',
                            border: 'none', borderRadius: 6,
                            background: panelTab === tab ? 'var(--accent)' : 'transparent',
                            color: panelTab === tab ? 'var(--surface)' : 'var(--text-primary)',
                        }}>
                            {tab === 'route' ? t('trip.route') : t('budget.title')}
                        </button>
                    ))}
                </div>
                <span style={{display: 'flex', gap: 4}}>
                    {/* экспорт (S9 WP-B) */}
                    <button title={t('export.pdf')} onClick={() => downloadExport(tripId, 'pdf').catch(() => setError(t('export.error')))}
                        style={{border: '1px solid var(--border)', background: 'var(--surface-raised)', borderRadius: 6, cursor: 'pointer', fontSize: 13, padding: '4px 8px'}}>
                        ⬇ PDF
                    </button>
                    <button title={t('export.ics')} onClick={() => downloadExport(tripId, 'ics').catch(() => setError(t('export.error')))}
                        style={{border: '1px solid var(--border)', background: 'var(--surface-raised)', borderRadius: 6, cursor: 'pointer', fontSize: 13, padding: '4px 8px'}}>
                        📅
                    </button>
                </span>
                </div>
                </div>
                {panelTab === 'budget' ? (
                    <div style={{flex: 1, overflowY: 'auto'}}>
                        <BudgetPanel tripId={tripId} days={days} />
                    </div>
                ) : selectedStop ? (
                    /* Детали остановки + бронирование (Sprint 6) */
                    <div style={{flex: 1, overflowY: 'auto'}}>
                        <StopDetailPanel
                            stop={selectedStop}
                            trip={trip}
                            onClose={() => setSelectedStop(null)}
                            onChanged={reloadStops}
                        />
                    </div>
                ) : (
                <>
                {days.length === 0 && <StartPoint tripId={tripId} initialAddress={trip?.start_address ?? undefined} initialTime={trip?.start_time}/>}
                <PlaceSearch tripId={tripId} dayId={expandedDayId} onPlaceAdded={reloadStops}/>
                {/*Сприсок остановок скролится  */}
                <div style={{flex: 1, overflowY: 'auto', padding: 16}}>
                {error && <p style={{color: 'var(--accent)', fontSize:13}}>{error}</p>}
                {days.length > 0 ? (
                    /* S8 WP-3: по-дневная панель — аккордеон дней */
                    <>
                        {days.map(day => (
                            <DayCard
                                key={day.id}
                                tripId={tripId}
                                day={day}
                                allDays={days}
                                locations={locations}
                                expanded={expandedDayId === day.id}
                                onToggle={() => setExpandedDayId(prev => prev === day.id ? null : day.id)}
                                onChanged={reloadStops}
                                onSelectStop={setSelectedStop}
                            />
                        ))}
                        {/* стопы без дня (созданы до мульти-дня) */}
                        {stops.filter(s => !s.day_id).length > 0 && (
                            <div style={{marginTop: 8}}>
                                <div style={{fontSize: 12, color: 'var(--text-muted)', marginBottom: 4}}>{t('trip.noDayGroup')}</div>
                                {stops.filter(s => !s.day_id).map((stop, i) => (
                                    <SortableStop key={stop.id} stop={stop} index={i} isLast onTransportChange={handleTransportChange} onDelete={handleDelete} onSelect={setSelectedStop}/>
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    <>
                    <p style={{fontSize: 12, color: 'var(--text-muted)'}}>
                        {t('trip.setDatesHint')}
                    </p>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={stops.map(s => s.id)} strategy={verticalListSortingStrategy}>
                            {stops.map((stop, i)=>(
                                <SortableStop key={stop.id} stop={stop} index={i} isLast={i === stops.length - 1} onTransportChange={handleTransportChange} onDelete={handleDelete} onSelect={setSelectedStop}/>
                                ))}
                        </SortableContext>
                    </DndContext>
                    </>
                )}
                </div>
                </>
                )}
                </div>
                {/* Карта все остальное место займет*/}
                <div style={{position: 'relative', flex: 1, minHeight: 0, display: 'flex'}}>
                    <div ref={mapContainer} className="planner-map" style={{flex: 1}} />
                    {/* мобильная пилюля дней (S10) — то же activeDayId, что и аккордеон */}
                    <DayPill days={days} activeDayId={expandedDayId}
                        onSelect={id => setExpandedDayId(id)} />
                    {/* карточка точки (S9 WP-E) */}
                    {clickedPoint && (
                        <div style={{
                            position: 'absolute', left: 12, bottom: 20, zIndex: 5,
                            background: 'var(--surface-raised)', borderRadius: 10, padding: 12,
                            boxShadow: '0 4px 16px color-mix(in srgb, var(--text-primary) 18%, transparent)', minWidth: 220, maxWidth: 300,
                        }}>
                            <div style={{display: 'flex', justifyContent: 'space-between', gap: 8}}>
                                <strong style={{fontSize: 14}}>{clickedPoint.label}</strong>
                                <button onClick={() => setClickedPoint(null)} style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: 0}}>✕</button>
                            </div>
                            {clickedPoint.address && (
                                <p style={{fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 8px'}}>
                                    {clickedPoint.address.split(',').slice(0, 3).join(',')}
                                </p>
                            )}
                            <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                                <button onClick={addClickedToRoute} style={{
                                    padding: '6px 12px', background: 'var(--accent)', color: 'var(--surface)',
                                    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13}}>
                                    {t('place.addToRoute')}
                                </button>
                                <button onClick={makeClickedStart} disabled={!activeDay}
                                    title={!activeDay ? t('map.start_needs_day') : undefined}
                                    style={{
                                        padding: '6px 12px', background: activeDay ? 'var(--surface-raised)' : 'var(--surface)',
                                        color: activeDay ? 'var(--text-primary)' : 'var(--text-muted)',
                                        border: '1px solid var(--border)', borderRadius: 6,
                                        cursor: activeDay ? 'pointer' : 'not-allowed', fontSize: 13}}>
                                    🏁 {t('map.makeStart')}
                                </button>
                                {!activeDay && (
                                    <span style={{fontSize: 11, color: 'var(--text-muted)'}}>{t('map.start_needs_day')}</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
                </div>
            
    )
    }
