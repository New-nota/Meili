import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Stop } from '../types/index'
import { getStops, getDayRoute, legsToCoordinates, getTrip, downloadExport, cloneTrip, likeTrip, unlikeTrip } from '../api/trips'
import { addLocation, getDays, getLocations, updateDay, reorderDays, type TripDay, type TripLocation } from '../api/days'
import DayCard from '../components/DayCard'
import BudgetPanel from '../components/BudgetPanel'
import PreviewBudget from '../components/PreviewBudget'
import { formatPlaceLabel, type ClickedPoint, type NominatimReverseResult } from '../utils/mapPoint'
import { applyPaperStyle, DAY_HEX } from '../utils/mapStyle'
import HermodLogo from '../components/HermodLogo'
import DayPill from '../components/DayPill'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import PlaceSearch from '../components/PlaceSearch'
import StartPoint from '../components/StartPoint'
import StopDetailPanel from '../components/StopDetailPanel'
import MeiliChat from '../components/meili/MeiliChat'
import { apiFetch } from '../api/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getVisitedPlaces } from '../api/visited'
import type { Place } from '../types/index'

// стартовый вид карты до загрузки остановок (MVP-регион — Калининград);
// после загрузки камера подстраивается через fitBounds
const DEFAULT_MAP_CENTER: [number, number] = [20.5114, 54.7104]
const DEFAULT_MAP_ZOOM = 13
// S11: ресайз панели — дефолт 400, мин 320, макс min(640, 50vw); память в localStorage
const PANEL_MIN = 320
const PANEL_DEFAULT = 400
const PANEL_KEY = 'hermod:panelWidth'
const panelMax = () => Math.min(640, window.innerWidth * 0.5)
const clampPanel = (w: number) => Math.max(PANEL_MIN, Math.min(panelMax(), w))
export default function TripPlanner({ readOnly = false }: { readOnly?: boolean } = {}) {
    const { t, i18n } = useTranslation()
    const {tripId} = useParams<{tripId: string}>()
    const mapContainer = useRef<HTMLDivElement>(null)
    const mapRef = useRef<maplibregl.Map | null>(null)
    const markersRef = useRef<maplibregl.Marker[]>([])
    const [stops, setStops] = useState<Stop[]>([])
    const [error, setError] = useState<string | null>(null)
    // S12: реордер дней — активация после 5px, чтобы клик по грипу не путался
    // с toggle аккордеона; сам drag висит на грипе в шапке DayCard
    const daySensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
    const [trip, setTrip] = useState<{title?: string, start_lat?: number, start_lon?: number, start_address?: string, start_time?: string, adults_count?: number, children_count?: number, currency?: string, city_lat?: number | null, city_lon?: number | null, liked_by_me?: boolean} | null>(null)
    const [selectedStop, setSelectedStop] = useState<Stop | null>(null)
    // S8 WP-3: мульти-день
    const [days, setDays] = useState<TripDay[]>([])
    const [locations, setLocations] = useState<TripLocation[]>([])
    const [expandedDayId, setExpandedDayId] = useState<string | null>(null)
    const [panelTab, setPanelTab] = useState<'route' | 'budget' | 'meili'>('route')
    // S9 WP-E: карточка точки на карте (toggle, Esc, «сделать точкой старта»)
    const [clickedPoint, setClickedPoint] = useState<ClickedPoint | null>(null)
    const clickedPointRef = useRef<ClickedPoint | null>(null)
    clickedPointRef.current = clickedPoint
    // S13: readOnly в замыканиях эффектов карты (клик, отрисовка депо) читаем через ref
    const readOnlyRef = useRef(readOnly)
    readOnlyRef.current = readOnly
    const i18nRef = useRef(i18n)
    i18nRef.current = i18n
    const pinRef = useRef<maplibregl.Marker | null>(null)
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    // S11: ширина панели (ресайз тягой за границу), помним в localStorage
    const [panelWidth, setPanelWidth] = useState<number>(() => {
        const saved = Number(localStorage.getItem(PANEL_KEY))
        return saved ? clampPanel(saved) : PANEL_DEFAULT
    })
    const [resizing, setResizing] = useState(false)
    // S11: реальная ширина панели (для «спрессовывания» шапки) — учитывает и
    // ресайз, и мобильную раскладку (там панель во всю ширину)
    const panelElRef = useRef<HTMLDivElement>(null)
    const [panelPx, setPanelPx] = useState(PANEL_DEFAULT)
    useEffect(() => {
        const el = panelElRef.current
        if (!el) return
        const ro = new ResizeObserver(entries => setPanelPx(entries[0].contentRect.width))
        ro.observe(el)
        return () => ro.disconnect()
    }, [])
    const compactHeader = panelPx < 380

    const startResize = (e: React.PointerEvent) => {
        e.preventDefault()
        setResizing(true)
        // панель прижата к левому краю вьюпорта -> новая ширина = clientX
        const onMove = (ev: PointerEvent) => setPanelWidth(clampPanel(ev.clientX))
        const onUp = () => {
            setResizing(false)
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            setPanelWidth(w => { localStorage.setItem(PANEL_KEY, String(w)); return w })
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
    }

    // карта (WebGL-канвас) должна пересчитаться под новую ширину контейнера
    useEffect(() => { mapRef.current?.resize() }, [panelWidth])

    // S15: отметки «посещено» — бейджи ✓ в днях (в превью не показываем)
    const { data: visitedList } = useQuery({
        queryKey: ['visited'], queryFn: getVisitedPlaces, enabled: !readOnly,
    })
    const visitedPlaceIds = new Set((visitedList ?? []).map(v => v.place_id))

    // S15: последняя открытая поездка — адресат вечернего опроса «как вам день»
    useEffect(() => {
        if (!readOnly && tripId) localStorage.setItem('hermod:lastOpenedTripId', tripId)
    }, [tripId, readOnly])

    // S11: центрируем карту на выбранном городе — только для пустой поездки
    // (есть стопы -> fitBounds по ним главнее)
    useEffect(() => {
        const map = mapRef.current
        if (!map || trip?.city_lat == null || trip?.city_lon == null) return
        const hasPoints = stops.length > 0 || days.some(d => d.stops.length > 0)
        if (hasPoints) return
        const center: [number, number] = [trip.city_lon, trip.city_lat]
        const go = () => map.jumpTo({ center, zoom: DEFAULT_MAP_ZOOM })
        if (map.isStyleLoaded()) go(); else map.once('load', go)
    }, [trip, stops, days])

    // S13: превью — лайк (оптимистично) и копирование в свою редактируемую поездку
    const toggleLike = async () => {
        if (!trip) return
        const liked = !!trip.liked_by_me
        setTrip(prev => prev ? { ...prev, liked_by_me: !liked } : prev)
        try {
            if (liked) await unlikeTrip(tripId!)
            else await likeTrip(tripId!)
        } catch {
            setTrip(prev => prev ? { ...prev, liked_by_me: liked } : prev)
        }
    }
    const copyTrip = async () => {
        const nt = await cloneTrip(tripId!)
        navigate(`/trips/${nt.id}`)
    }

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
            // S13: в превью карта не редактируется — клик ничего не добавляет
            if (readOnlyRef.current) return
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
                    // S16: геометрия берётся из перегонов — у каждого свой транспорт
                    const coords = dayStops.length
                        ? await getDayRoute(tripId!, day.id)
                            .then(r => legsToCoordinates(r.legs)).catch(() => [])
                        : []
                    ;(map.getSource(`route-day-${i % DAY_HEX.length}`) as maplibregl.GeoJSONSource | undefined)
                        ?.setData({type: 'Feature', geometry: {type: 'LineString', coordinates: coords}, properties: {}})
                    // номерные бейджи цвета дня
                    dayStops.forEach((st, idx) => {
                        const el = document.createElement('div')
                        el.style.cssText = `width:24px;height:24px;background:var(--day-${(i % 12) + 1});border:2px solid var(--surface-raised);border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--surface-raised);font-weight:bold;font-size:11px;cursor:pointer;`
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

        // исключённые селективным прогоном (S8 WP-4) в линию не входят
        const includedStops = routeStops.filter(s => s.included_in_route !== false)
        // S16: линия дня — геометрия перегонов (учитывает транспорт каждого)
        const coordinates = activeDay && includedStops.length
            ? await getDayRoute(tripId!, activeDay.id)
                .then(r => legsToCoordinates(r.legs)).catch(() => [])
            : []
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
            // S13: депо старта/финиша и «дом» в превью не рисуем (Q9)
            if (!readOnlyRef.current && activeDay?.start_location) depotMarker(activeDay.start_location, t('day.startOfDay'))
            if (!readOnlyRef.current && activeDay?.end_location) depotMarker(activeDay.end_location, t('day.endOfDay'))
            if (!readOnlyRef.current && !activeDay && trip?.start_lat && trip?.start_lon) {
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
                if (!readOnlyRef.current && activeDay?.start_location) { lons.push(activeDay.start_location.lon); lats.push(activeDay.start_location.lat) }
                if (!readOnlyRef.current && activeDay?.end_location) { lons.push(activeDay.end_location.lon); lats.push(activeDay.end_location.lat) }
                
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
    
    // S16 §1.5: реордер дней — новый порядок id; сервер переставляет содержимое
    // по фиксированному пулу дат и возвращает дни уже в новом порядке
    const handleDaysDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const oldIndex = days.findIndex(d => d.id === active.id)
        const newIndex = days.findIndex(d => d.id === over.id)
        if (oldIndex < 0 || newIndex < 0) return
        const newOrder = arrayMove(days, oldIndex, newIndex)
        const updated = await reorderDays(tripId!, newOrder.map(d => d.id))
        setDays(updated)
        await reloadStops()
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
    // S16 §3.2: оптимистичное переименование дня (откат делает DayHeader)
    const renameDayLocally = (dayId: string, title: string | null) =>
        setDays(prev => prev.map(d => d.id === dayId ? { ...d, title } : d))

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
        <div className="planner-layout"
            style={{
                ['--panel-w' as string]: `${panelWidth}px`,
                ...(resizing ? { cursor: 'col-resize', userSelect: 'none' } : {}),
            } as React.CSSProperties}>
            {/*Left pannel — на мобильных уезжает под карту (см. index.css)*/}
            <div className="planner-panel" ref={panelElRef}>
                {/* Заголовок */}
                {readOnly ? (
                    /* S13: превью-шапка — назад · название · ❤ · ⧉ + вкладки Маршрут/Бюджет */
                    <div style={{padding: '12px 16px', borderBottom: '1px solid var(--border)'}}>
                        <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10}}>
                            <button onClick={() => navigate('/discover')} title={t('common.back')}
                                style={{background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)'}}>←</button>
                            <strong style={{flex: 1, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                                {trip?.title ?? ''}
                            </strong>
                            <button onClick={toggleLike} title={t('preview.like')}
                                style={{background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                                    cursor: 'pointer', fontSize: 15, padding: '4px 8px',
                                    color: trip?.liked_by_me ? 'var(--accent)' : 'var(--text-muted)'}}>
                                {trip?.liked_by_me ? '❤' : '🤍'}
                            </button>
                            <button onClick={copyTrip} title={t('preview.copy')}
                                style={{background: 'var(--accent)', color: 'var(--surface)', border: 'none',
                                    borderRadius: 6, cursor: 'pointer', fontSize: 13, padding: '5px 10px', whiteSpace: 'nowrap'}}>
                                ⧉ {t('trip.clone')}
                            </button>
                        </div>
                        <div style={{display: 'flex', gap: 4}}>
                            {(['route', 'budget'] as const).map(tab => (
                                <button key={tab} onClick={() => setPanelTab(tab)} style={{
                                    padding: '4px 10px', fontSize: 13, cursor: 'pointer', border: 'none', borderRadius: 6,
                                    background: panelTab === tab ? 'var(--accent)' : 'transparent',
                                    color: panelTab === tab ? 'var(--surface)' : 'var(--text-primary)',
                                }}>
                                    {tab === 'route' ? t('trip.route') : t('budget.title')}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                <div style={{padding: compactHeader ? '12px' : '16px', borderBottom: '1px solid var(--border)'}}>
                {/* S11: flex-wrap — при нехватке ширины кластеры переносятся на 2-ю строку,
                    а не обрезаются за полосой ресайза; отступы ужимаются */}
                <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
                    alignItems: 'center', gap: 8, marginBottom: 12}}>
                    <span style={{display: 'flex', alignItems: 'center', gap: 6}}>
                        <span onClick={() => navigate('/discover')} style={{cursor: 'pointer', display: 'flex'}}>
                            <HermodLogo size={26} withWordmark={!compactHeader} />
                        </span>
                        <button onClick={() => navigate(`/trips/${tripId}/settings`)} style={{background: 'none', border: 'none',cursor: 'pointer', fontSize: 18, color:'var(--text-muted)'}}>&#9881;</button>
                    </span>
                <div style={{display: 'flex', gap: 4}}>
                    {(['route', 'budget', 'meili'] as const).map(tab => {
                        // S11: при узкой панели вкладки схлопываются в иконки
                        const label = tab === 'route' ? t('trip.route') : tab === 'budget' ? t('budget.title') : t('meili.title')
                        const icon = tab === 'route' ? '🗺' : tab === 'budget' ? '💰' : '✨'
                        return (
                        <button key={tab} onClick={() => setPanelTab(tab)} title={compactHeader ? label : undefined} style={{
                            padding: compactHeader ? '4px 8px' : '4px 10px', fontSize: 13, cursor: 'pointer',
                            border: 'none', borderRadius: 6,
                            background: panelTab === tab ? 'var(--accent)' : 'transparent',
                            color: panelTab === tab ? 'var(--surface)' : 'var(--text-primary)',
                        }}>
                            {compactHeader ? icon : label}
                        </button>
                    )})}
                </div>
                <span style={{display: 'flex', gap: 4}}>
                    {/* экспорт (S9 WP-B) — в компактном режиме без текста «PDF» */}
                    <button title={t('export.pdf')} onClick={() => downloadExport(tripId, 'pdf').catch(() => setError(t('export.error')))}
                        style={{border: '1px solid var(--border)', background: 'var(--surface-raised)', borderRadius: 6, cursor: 'pointer', fontSize: 13, padding: '4px 8px'}}>
                        {compactHeader ? '⬇' : '⬇ PDF'}
                    </button>
                    <button title={t('export.ics')} onClick={() => downloadExport(tripId, 'ics').catch(() => setError(t('export.error')))}
                        style={{border: '1px solid var(--border)', background: 'var(--surface-raised)', borderRadius: 6, cursor: 'pointer', fontSize: 13, padding: '4px 8px'}}>
                        📅
                    </button>
                </span>
                </div>
                </div>
                )}
                {panelTab === 'meili' ? (
                    /* AI-ассистент (ТЗ-Meili): диалог привязан к открытой поездке */
                    <div style={{flex: 1, overflowY: 'hidden'}}>
                        <MeiliChat tripId={tripId} onApplied={reloadStops} />
                    </div>
                ) : panelTab === 'budget' ? (
                    <div style={{flex: 1, overflowY: 'auto'}}>
                        {/* S13: в превью — только активности из стопов, без owner-ручки бюджета */}
                        {readOnly
                            ? <PreviewBudget days={days} currency={trip?.currency} />
                            : <BudgetPanel tripId={tripId} days={days} onStopsChanged={reloadStops} />}
                    </div>
                ) : selectedStop && !readOnly ? (
                    /* Детали остановки + бронирование (Sprint 6) */
                    <div style={{flex: 1, overflowY: 'auto'}}>
                        <StopDetailPanel
                            stop={selectedStop}
                            trip={trip}
                            // S16: дата визита приходит от дня стопа
                            dayDate={days.find(d => d.id === selectedStop.day_id)?.date ?? null}
                            onClose={() => setSelectedStop(null)}
                            onChanged={reloadStops}
                        />
                    </div>
                ) : (
                <>
                {/* S13: в превью старт-точка и поиск мест недоступны */}
                {!readOnly && days.length === 0 && <StartPoint tripId={tripId} initialAddress={trip?.start_address ?? undefined} initialTime={trip?.start_time}/>}
                {!readOnly && <PlaceSearch tripId={tripId} dayId={expandedDayId} onPlaceAdded={reloadStops}/>}
                {/*Сприсок остановок скролится  */}
                <div style={{flex: 1, overflowY: 'auto', padding: 16}}>
                {error && <p style={{color: 'var(--accent)', fontSize:13}}>{error}</p>}
                {/* S16: стоп всегда живёт в дне — веток «без дня» больше нет */}
                {days.length > 0 ? (
                    /* S8 WP-3: по-дневная панель — аккордеон дней; S12: DnD-реордер дней */
                    <DndContext sensors={daySensors} collisionDetection={closestCenter} onDragEnd={handleDaysDragEnd}>
                        <SortableContext items={days.map(d => d.id)} strategy={verticalListSortingStrategy}>
                        {days.map(day => (
                            <DayCard
                                key={day.id}
                                tripId={tripId}
                                day={day}
                                allDays={days}
                                locations={locations}
                                currency={trip?.currency}
                                expanded={expandedDayId === day.id}
                                onToggle={() => setExpandedDayId(prev => prev === day.id ? null : day.id)}
                                onChanged={reloadStops}
                                onSelectStop={setSelectedStop}
                                onDayRenamed={renameDayLocally}
                                readOnly={readOnly}
                                visitedPlaceIds={visitedPlaceIds}
                            />
                        ))}
                        </SortableContext>
                    </DndContext>
                ) : (
                    <p style={{fontSize: 12, color: 'var(--text-muted)'}}>
                        {t('trip.setDatesHint')}
                    </p>
                )}
                </div>
                </>
                )}
                </div>
                {/* S11: полоса ресайза (на мобилке скрыта через CSS) */}
                <div className={`panel-resize-handle${resizing ? ' dragging' : ''}`}
                    onPointerDown={startResize} title={t('trip.resizePanel')} />
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
