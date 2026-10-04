import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
    ArrowLeft, CalendarPlus, ChevronRight, Copy, FileDown, Flag, Heart, Plus, Settings2, X,
} from 'lucide-react'
import type { Stop } from '../types/index'
import { getStops, getDayRoute, legsToCoordinates, getTrip, downloadExport, cloneTrip, likeTrip, unlikeTrip } from '../api/trips'
import { addLocation, getDays, getLocations, updateDay, reorderDays, type TripDay, type TripLocation } from '../api/days'
import DayPlan from '../components/trip/DayPlan'
import DaySwatches from '../components/trip/DaySwatches'
import BudgetPanel from '../components/BudgetPanel'
import PreviewBudget from '../components/PreviewBudget'
import { formatPlaceLabel, type ClickedPoint, type NominatimReverseResult } from '../utils/mapPoint'
import { markerPopupContent } from '../utils/mapPopup'
import { applyMapStyle, DAY_HEX, ROUTE_CASING_HEX, ROUTE_HEX } from '../utils/mapStyle'
import { dayLabel } from '../utils/dayLabel'
import { formatMoneyCompact } from '../utils/money'
import HermodLogo from '../components/HermodLogo'
import { type DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import PlaceSearch from '../components/PlaceSearch'
import StartPoint from '../components/StartPoint'
import StopDetailPanel from '../components/StopDetailPanel'
import MeiliChat from '../components/meili/MeiliChat'
import { apiFetch, ApiError } from '../api/client'
import { apiErrorMessage } from '../utils/apiError'
import { inCoverage } from '../utils/geocode'
import { SearchAreaContext } from '../utils/searchArea'
import { useRoutingCoverage } from '../api/meta'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getVisitedPlaces } from '../api/visited'
import type { Place } from '../types/index'

// стартовый вид карты до загрузки поездки — весь мир, без «родного» города:
// дальше камера прыгает на город поездки (S11) или fitBounds по точкам
const WORLD_CENTER: [number, number] = [15, 30]
const WORLD_ZOOM = 1.5
// зум города поездки, пока в ней нет точек
const CITY_ZOOM = 13
// S11: ресайз панели — память в localStorage; редизайн «Лес»: дефолт 460, мин 380
const PANEL_MIN = 380
const PANEL_DEFAULT = 460
const PANEL_KEY = 'hermod:panelWidth'
const panelMax = () => Math.min(640, window.innerWidth * 0.5)
const clampPanel = (w: number) => Math.max(PANEL_MIN, Math.min(panelMax(), w))
const MOBILE_QUERY = '(max-width: 768px)'
// поля кадра под маршрут: справа зум, снизу значок атрибуции — метки не прячутся
const fitPadding = () => window.matchMedia(MOBILE_QUERY).matches
    ? { top: 36, right: 56, bottom: 44, left: 36 }
    : { top: 70, right: 80, bottom: 70, left: 70 }

// значки старта/финиша/дома в метках карты — статичная разметка (lucide house/flag)
const ICON_HOUSE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
const ICON_FLAG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>'

type TripInfo = {
    title?: string, start_lat?: number, start_lon?: number, start_address?: string, start_time?: string,
    adults_count?: number, children_count?: number, currency?: string, city_lat?: number | null,
    city_lon?: number | null, liked_by_me?: boolean, start_date?: string | null, end_date?: string | null,
    budget_total?: string | null,
}

export default function TripPlanner({ readOnly = false }: { readOnly?: boolean } = {}) {
    const { t, i18n } = useTranslation()
    const {tripId} = useParams<{tripId: string}>()
    const mapContainer = useRef<HTMLDivElement>(null)
    const mapRef = useRef<maplibregl.Map | null>(null)
    const markersRef = useRef<maplibregl.Marker[]>([])
    const [stops, setStops] = useState<Stop[]>([])
    const [error, setError] = useState<string | null>(null)
    // ошибки загрузки — объектом, перевод при рендере (см. Discover)
    const [loadError, setLoadError] = useState<{ e: unknown, fallback: string } | null>(null)
    // QA: чужая/удалённая/кривая поездка — честный экран «не найдена»
    const [notFoundId, setNotFoundId] = useState<string | null>(null)
    const notFound = notFoundId !== null && notFoundId === tripId
    const [trip, setTrip] = useState<TripInfo | null>(null)
    // по миру: поиски внутри поездки — сначала в округе её города; объект
    // мемоизирован, иначе каждый рендер перезапускал бы поиски-эффекты
    const cityLat = trip?.city_lat, cityLon = trip?.city_lon
    const searchArea = useMemo(
        () => (cityLat != null && cityLon != null ? { lat: cityLat, lon: cityLon } : null),
        [cityLat, cityLon],
    )
    const coverage = useRoutingCoverage()
    const [selectedStop, setSelectedStop] = useState<Stop | null>(null)
    // S8 WP-3: мульти-день; null = режим «Все дни»
    const [days, setDays] = useState<TripDay[]>([])
    const [locations, setLocations] = useState<TripLocation[]>([])
    const [expandedDayId, setExpandedDayId] = useState<string | null>(null)
    // дни какой поездки уже пришли: до этого не рисуем ветку «без дат» —
    // иначе её поиск подменялся поиском дня и набранный текст терялся
    const [daysFor, setDaysFor] = useState<string | null>(null)
    const [panelTab, setPanelTab] = useState<'route' | 'budget' | 'meili'>('route')
    // S9 WP-E: карточка точки на карте (toggle, Esc, «сделать точкой старта»)
    const [clickedPoint, setClickedPoint] = useState<ClickedPoint | null>(null)
    const clickedPointRef = useRef<ClickedPoint | null>(null)
    // S13: readOnly в замыканиях эффектов карты (клик, отрисовка депо) читаем через ref
    const readOnlyRef = useRef(readOnly)
    const i18nRef = useRef(i18n)
    // свежие значения для обработчиков карты — синхронизируем после рендера
    // (запись в ref во время рендера запрещена правилами React)
    useEffect(() => {
        clickedPointRef.current = clickedPoint
        readOnlyRef.current = readOnly
        i18nRef.current = i18n
    })
    const pinRef = useRef<maplibregl.Marker | null>(null)
    // карта прошла 'load': дальше рисуем сразу. isStyleLoaded() для этого не
    // годится — он бывает false уже после 'load', пока догружается источник,
    // и once('load') тогда не срабатывал никогда (маршрут не рисовался)
    const mapReadyRef = useRef(false)
    const whenMapReady = (map: maplibregl.Map, fn: () => void) => {
        if (mapReadyRef.current) fn(); else map.once('load', fn)
    }
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    // S11: ширина панели (ресайз тягой за границу), помним в localStorage
    const [panelWidth, setPanelWidth] = useState<number>(() => {
        const saved = Number(localStorage.getItem(PANEL_KEY))
        return saved ? clampPanel(saved) : PANEL_DEFAULT
    })
    const [resizing, setResizing] = useState(false)

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

    // карта (WebGL-канвас) должна пересчитаться под новую ширину контейнера;
    // на телефоне карта прячется на вкладках «Бюджет»/Meili — после показа тоже
    useEffect(() => { mapRef.current?.resize() }, [panelWidth, panelTab])

    // S15: отметки «посещено» (в превью не показываем)
    const { data: visitedList } = useQuery({
        queryKey: ['visited'], queryFn: getVisitedPlaces, enabled: !readOnly,
    })
    const visitedPlaceIds = new Set((visitedList ?? []).map(v => v.place_id))

    // S15: последняя открытая поездка — адресат вечернего опроса «как вам день»
    useEffect(() => {
        if (!readOnly && tripId) localStorage.setItem('hermod:lastOpenedTripId', tripId)
    }, [tripId, readOnly])

    // S11: центрируем карту на выбранном городе — только для пустой поездки
    useEffect(() => {
        const map = mapRef.current
        if (!map || trip?.city_lat == null || trip?.city_lon == null) return
        const hasPoints = stops.length > 0 || days.some(d => d.stops.length > 0)
        if (hasPoints) return
        // камера не ждёт 'load': стиль с внешнего сервера тайлов грузится
        // секундами, и всё это время карта показывала весь мир — клик по ней
        // ставил точку в Африке («вне зоны карт»). jumpTo работает и без стиля
        map.jumpTo({ center: [trip.city_lon, trip.city_lat], zoom: CITY_ZOOM })
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
        try {
            const nt = await cloneTrip(tripId!)
            navigate(`/trips/${nt.id}`)
        } catch (e) {
            setError(apiErrorMessage(e, t))
        }
    }

    const reloadDays = async () => {
        const [d, l] = await Promise.all([getDays(tripId!), getLocations(tripId!)])
        setDays(d)
        setLocations(l)
        // по умолчанию открыт первый день
        setExpandedDayId(prev => prev ?? (d[0]?.id ?? null))
        return d
    }

    useEffect(() => {
        // QA: при переходе между поездками ответ ПРЕДЫДУЩЕЙ мог прийти позже и
        // показать её дни в новой — устаревший ответ отбрасываем
        let cancelled = false
        Promise.all([getDays(tripId!), getLocations(tripId!)]).then(([d, l]) => {
            if (cancelled) return
            setDays(d)
            setLocations(l)
            setDaysFor(tripId ?? null)
            setExpandedDayId(prev => prev ?? (d[0]?.id ?? null))
        }).catch(() => {})
        return () => { cancelled = true }
    }, [tripId])

    useEffect(()=> {
        const load = async () => {
            try {
                const res = await getTrip(tripId!)
                if (res) setTrip(res)
            } catch (e) {
                if (e instanceof ApiError && (e.status === 404 || e.status === 422 || e.status === 403)) {
                    setNotFoundId(tripId ?? null)
                } else {
                    setLoadError({ e, fallback: 'trip.loadError' })
                }
            }
        }
    load()
    // tripId в deps: при переходе между поездками роутер переиспользует компонент
    }, [tripId] )

    useEffect(()=> {
        if(!mapContainer.current) return
        const mobile = window.matchMedia(MOBILE_QUERY).matches
        const map = new maplibregl.Map({
            container: mapContainer.current,
            style: 'https://tiles.openfreemap.org/styles/liberty',
            center: WORLD_CENTER,
            zoom: WORLD_ZOOM,
            // редизайн «Лес»: на телефоне карта — блок в скроллящейся странице,
            // одним пальцем листаем страницу, двумя — карту
            cooperativeGestures: mobile,
            attributionControl: { compact: true },
            locale: {
                'CooperativeGesturesHandler.WindowsHelpText': i18nRef.current.t('planner.map.gestureWindows'),
                'CooperativeGesturesHandler.MacHelpText': i18nRef.current.t('planner.map.gestureMac'),
                'CooperativeGesturesHandler.MobileHelpText': i18nRef.current.t('planner.map.gestureMobile'),
            },
        })
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }))
        mapRef.current = map
        // QA: клик — сразу, а не по 'load': пока внешний сервер тайлов грузит
        // стиль (секунды, а то и «никогда»), клик по карте молча не работал
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
            // QA: геокодер лёг/429 — карточка всё равно открывается с координатами
            let data: NominatimReverseResult = {}
            try {
                const res = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&namedetails=1`,
                    {headers: {'Accept-Language': i18nRef.current.language}}
                )
                if (res.ok) data = await res.json()
            } catch { /* остаёмся с координатами */ }
            const label = formatPlaceLabel(data, lat, lng)
            setClickedPoint({
                lat, lng, label,
                address: data.display_name ?? null,
                osmId: data.osm_type && data.osm_id ? `${data.osm_type}/${data.osm_id}` : null,
            })
        })
        map.on('load',() => {
        mapReadyRef.current = true
        // компактная атрибуция MapLibre стартует раскрытой и закрывает низ карты
        mapContainer.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
        // «Лес»: тихая тёплая карта — насыщенным остаётся только маршрут
        applyMapStyle(map)
        map.addSource('route', {type: 'geojson', data: {type: 'Feature', geometry: {type: 'LineString', coordinates: []}, properties: {}}
        })
        // слои режима «Все дни»: природная палитра дней
        DAY_HEX.forEach((hex, i) => {
            map.addSource(`route-day-${i}`, {type: 'geojson', data: {type: 'Feature', geometry: {type: 'LineString', coordinates: []}, properties: {}}})
            map.addLayer({
                id: `route-day-line-${i}`, type: 'line', source: `route-day-${i}`,
                layout: {'line-join': 'round', 'line-cap': 'round'},
                paint: {'line-color': hex, 'line-width': 3.5, 'line-opacity': 0.85},
            })
        })
        // маршрут дня — дерево, со светлой «обводкой», чтобы читался поверх дорог
        map.addLayer({
            id: 'route-casing', type: 'line', source: 'route',
            layout: {'line-join': 'round', 'line-cap': 'round'},
            paint: {'line-color': ROUTE_CASING_HEX, 'line-width': 9}
        })
        map.addLayer({
            id: 'route-line', type: 'line', source: 'route',
            layout: {'line-join': 'round', 'line-cap': 'round'},
            paint: {'line-color': ROUTE_HEX, 'line-width': 4.5}
        })
        })
        return () => { mapReadyRef.current = false; map.remove() }
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
            pinRef.current = new maplibregl.Marker({ color: ROUTE_HEX })
                .setLngLat([clickedPoint.lng, clickedPoint.lat])
                .addTo(map)
        }
    }, [clickedPoint])

    useEffect(() => {
        const load = async () => {
            try {
                setStops(await getStops(tripId!))
            } catch (e) {
                setLoadError({ e, fallback: 'trip.stopsLoadError' })
            }
        }
        load()
    }, [tripId])

    // S8 WP-3: активный день — его стопы и депо; без дней — все стопы поездки
    const activeDay = days.find(d => d.id === expandedDayId) ?? null
    const routeStops = activeDay ? activeDay.stops : stops

    useEffect(() => {
    const map = mapRef.current
    // QA: пустой маршрут тоже рисуется (= очищается) — иначе висели «призраки»
    if (!map) return
    // QA: отрисовка асинхронная — устаревший прогон отменяем, иначе дубли меток
    let cancelled = false
    const markEl = (cls: string, content: string, color?: string) => {
        const el = document.createElement('div')
        el.className = `map-mark ${cls}`
        if (color) el.style.background = color
        el.textContent = content
        return el
    }
    const drawRoute = async () => {
        const emptyLine = {type: 'Feature' as const, geometry: {type: 'LineString' as const, coordinates: [] as number[][]}, properties: {}}
        const clearDayLayers = () => DAY_HEX.forEach((_, i) => {
            (map.getSource(`route-day-${i}`) as maplibregl.GeoJSONSource | undefined)?.setData(emptyLine)
        })

        // режим «Все дни» — маршруты в природной палитре дней
        if (!activeDay && days.length > 0) {
            const paintOverview = async () => {
                if (cancelled) return
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
                    if (cancelled) return
                    ;(map.getSource(`route-day-${i % DAY_HEX.length}`) as maplibregl.GeoJSONSource | undefined)
                        ?.setData({type: 'Feature', geometry: {type: 'LineString', coordinates: coords}, properties: {}})
                    dayStops.forEach((st, idx) => {
                        const el = markEl('', String(idx + 1), DAY_HEX[i % DAY_HEX.length])
                        el.style.width = el.style.height = '26px'
                        el.style.fontSize = '12px'
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
                        {padding: fitPadding()},
                    )
                }
            }
            whenMapReady(map, paintOverview)
            return
        }

        // исключённые селективным прогоном (S8 WP-4) в линию не входят
        const includedStops = routeStops.filter(s => s.included_in_route !== false)
        // S16: линия дня — геометрия перегонов (учитывает транспорт каждого)
        const coordinates = activeDay && includedStops.length
            ? await getDayRoute(tripId!, activeDay.id)
                .then(r => legsToCoordinates(r.legs)).catch(() => [])
            : []
        if (cancelled) return
        const updateMap = () => {
            if (cancelled) return
            markersRef.current.forEach(m => m.remove())
            markersRef.current = []
            clearDayLayers()
            ;(map.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData({
                type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {},
            })
            // метки: включённые — дерево с номером (обязательные крупнее);
            // «не влезло» (S8 WP-4) — приглушённые, вне линии маршрута
            const droppedStops = routeStops.filter(s => s.included_in_route === false)
            includedStops.forEach((stop, index) => {
                if(!stop.place_lat || !stop.place_lon) return
                const el = markEl(stop.priority === 2 ? 'must' : '', String(index + 1))
                // setDOMContent, не setHTML — имя места это пользовательский ввод (utils/mapPopup)
                const popup = new maplibregl.Popup({offset: 20}).setDOMContent(
                    markerPopupContent(
                        stop.place_name || t('common.untitled'),
                        stop.duration_minutes ? t('place.durationMin', {count: stop.duration_minutes}) : null,
                        'margin: 4px 0 0; color: var(--ink-3)',
                    ))
                markersRef.current.push(
                    new maplibregl.Marker({element: el}).setLngLat([stop.place_lon, stop.place_lat]).setPopup(popup).addTo(map))
            })
            droppedStops.forEach(stop => {
                if(!stop.place_lat || !stop.place_lon) return
                const el = markEl('dropped', '×')
                const popup = new maplibregl.Popup({offset: 20}).setDOMContent(
                    markerPopupContent(
                        stop.place_name || t('common.untitled'),
                        t('place.notFitLabel'),
                        'margin: 4px 0 0; font-size: 12px; color: var(--ink-3)',
                    ))
                markersRef.current.push(
                    new maplibregl.Marker({element: el}).setLngLat([stop.place_lon, stop.place_lat]).setPopup(popup).addTo(map))
            })
            // депо активного дня: старт и финиш (S8 WP-3)
            const depotMarker = (loc: {lat: number, lon: number, name?: string | null}, label: string, icon: string) => {
                const el = markEl('depot', '')
                el.innerHTML = icon   // статичная разметка значка, без пользовательских данных
                const popup = new maplibregl.Popup({offset: 20}).setDOMContent(
                    markerPopupContent(label, loc.name, 'font-size: 12px; color: var(--ink-3)'))
                markersRef.current.push(
                    new maplibregl.Marker({element: el}).setLngLat([loc.lon, loc.lat]).setPopup(popup).addTo(map))
            }
            // S13: депо старта/финиша и «дом» в превью не рисуем (Q9)
            if (!readOnlyRef.current && activeDay?.start_location) depotMarker(activeDay.start_location, t('day.startOfDay'), ICON_HOUSE)
            if (!readOnlyRef.current && activeDay?.end_location) depotMarker(activeDay.end_location, t('day.endOfDay'), ICON_FLAG)
            if (!readOnlyRef.current && !activeDay && trip?.start_lat && trip?.start_lon) {
                depotMarker({ lat: trip.start_lat, lon: trip.start_lon, name: trip.start_address }, t('place.home'), ICON_HOUSE)
            }
            // выравниваем по узлам дня (депо + стопы), чтобы всё было видно
            const lons = routeStops.filter(s => s.place_lon).map(s => s.place_lon!)
            const lats = routeStops.filter(s => s.place_lat).map( s => s.place_lat!)
            if (!readOnlyRef.current && activeDay?.start_location) { lons.push(activeDay.start_location.lon); lats.push(activeDay.start_location.lat) }
            if (!readOnlyRef.current && activeDay?.end_location) { lons.push(activeDay.end_location.lon); lats.push(activeDay.end_location.lat) }
            // дорога может уходить дальше точек (объезд по проспекту) — её тоже в кадр
            for (const [x, y] of coordinates) { lons.push(x); lats.push(y) }
            if (lons.length > 1) {
                map.fitBounds(
                    [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
                    { padding: fitPadding(), maxZoom: 16 },
                )
            }
        }
        whenMapReady(map, updateMap)
    }
    drawRoute()
    return () => { cancelled = true }

    // activeDay/routeStops — производные от days/expandedDayId/stops со
    // стабильными ссылками; t — подписи попапов при смене языка
    }, [stops, trip, days, expandedDayId, activeDay, routeStops, tripId, t])

    // S16 §1.5: реордер дней — новый порядок id; сервер переставляет содержимое
    // по фиксированному пулу дат и возвращает дни уже в новом порядке
    const handleDaysDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const oldIndex = days.findIndex(d => d.id === active.id)
        const newIndex = days.findIndex(d => d.id === over.id)
        if (oldIndex < 0 || newIndex < 0) return
        const newOrder = arrayMove(days, oldIndex, newIndex)
        // оптимистично: день переезжает сразу, сервер подтверждает/откатываем
        const before = days
        setDays(newOrder)
        try {
            const updated = await reorderDays(tripId!, newOrder.map(d => d.id))
            setDays(updated)
            await reloadStops()
        } catch (e) {
            setDays(before)
            setError(apiErrorMessage(e, t))
        }
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
    // S16 §3.2: оптимистичное переименование дня (откат делает DayPlan)
    const renameDayLocally = (dayId: string, title: string | null) =>
        setDays(prev => prev.map(d => d.id === dayId ? { ...d, title } : d))

    // S9 WP-E: действия карточки точки
    // QA: «добавить в маршрут» в режиме «Все дни» слало day_id: null → 422.
    // Нет открытого дня — кладём в первый.
    const targetDayId = expandedDayId ?? days[0]?.id ?? null
    const addClickedToRoute = async () => {
        if (!clickedPoint) return
        if (!targetDayId) { setError(t('trip.setDatesHint')); return }
        try {
            const place = await apiFetch<Place>('/places/', {
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
                body: JSON.stringify({ place_id: place.id, day_id: targetDayId }),
            })
            setClickedPoint(null)
            if (!expandedDayId) setExpandedDayId(targetDayId)
            reloadStops()
        } catch (e) {
            setError(apiErrorMessage(e, t, t('trip.addPlaceError')))
        }
    }

    const makeClickedStart = async () => {
        // Fix 2: создать локацию из точки и сделать её стартом активного дня
        if (!clickedPoint || !activeDay) return
        try {
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
        } catch (e) {
            setError(apiErrorMessage(e, t))
        }
    }

    if (!tripId || notFound) return (
        <div className="page" style={{ display: 'grid', justifyItems: 'center', gap: 16, paddingTop: 96, textAlign: 'center' }}>
            <HermodLogo size={44} withWordmark vertical />
            <p style={{ color: 'var(--ink-2)', fontSize: 16 }}>{t('trip.notFound')}</p>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/discover')}>
                {t('nav.myTrips')}
            </button>
        </div>
    )

    // мета поездки: «13–15 октября · 2 взрослых, 1 ребёнок · 45 000 ₽»
    const dateRange = (() => {
        if (!trip?.start_date) return null
        const f = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' })
        const a = new Date(trip.start_date + 'T00:00:00')
        const b = new Date((trip.end_date ?? trip.start_date) + 'T00:00:00')
        return a.getTime() === b.getTime() ? f.format(a) : f.formatRange(a, b)
    })()
    const meta = [
        dateRange,
        trip?.adults_count ? [
            t('profile.meta.adults', { count: trip.adults_count }),
            trip.children_count ? t('profile.meta.children', { count: trip.children_count }) : null,
        ].filter(Boolean).join(', ') : null,
        !readOnly && trip?.budget_total ? formatMoneyCompact(trip.budget_total, trip.currency, i18n.language) : null,
    ].filter(Boolean).join(' · ')

    const tabs = readOnly ? (['route', 'budget'] as const) : (['route', 'budget', 'meili'] as const)
    const tabLabel = (tab: 'route' | 'budget' | 'meili') =>
        tab === 'route' ? t('trip.route') : tab === 'budget' ? t('budget.title') : t('meili.title')

    return (
        <SearchAreaContext.Provider value={searchArea}>
        <div className={`planner${panelTab === 'meili' ? ' is-chat' : ''}`}
            style={{
                ['--panel-w' as string]: `${panelWidth}px`,
                ...(resizing ? { cursor: 'col-resize', userSelect: 'none' } : {}),
            } as React.CSSProperties}>
            <header className="planner-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <button type="button" className="icon-btn filled sm" onClick={() => navigate('/discover')}
                        title={t('nav.myTrips')} aria-label={t('nav.myTrips')}>
                        <ArrowLeft />
                    </button>
                    <span style={{ marginRight: 'auto', display: 'flex' }}>
                        <HermodLogo size={28} withWordmark />
                    </span>
                    {readOnly ? (
                        <>
                            <button type="button" className="icon-btn" onClick={toggleLike}
                                aria-pressed={!!trip?.liked_by_me} title={t('preview.like')} aria-label={t('preview.like')}
                                style={trip?.liked_by_me ? { color: 'var(--danger)' } : undefined}>
                                <Heart fill={trip?.liked_by_me ? 'currentColor' : 'none'} />
                            </button>
                            <button type="button" className="btn btn-sm btn-primary btn-pill" onClick={copyTrip} title={t('preview.copy')}>
                                <Copy />{t('trip.clone')}
                            </button>
                        </>
                    ) : (
                        <>
                            {/* экспорт (S9 WP-B) */}
                            <button type="button" className="icon-btn" title={t('export.pdf')} aria-label={t('export.pdf')}
                                onClick={() => downloadExport(tripId, 'pdf').catch(() => setError(t('export.error')))}>
                                <FileDown />
                            </button>
                            <button type="button" className="icon-btn" title={t('export.ics')} aria-label={t('export.ics')}
                                onClick={() => downloadExport(tripId, 'ics').catch(() => setError(t('export.error')))}>
                                <CalendarPlus />
                            </button>
                            <button type="button" className="icon-btn" title={t('trip.settingsTitle')} aria-label={t('trip.settingsTitle')}
                                onClick={() => navigate(`/trips/${tripId}/settings`)}>
                                <Settings2 />
                            </button>
                        </>
                    )}
                </div>
                {/* QA: в своей поездке название — клик ведёт в настройки */}
                {readOnly ? (
                    <h1 style={{ fontSize: 26, lineHeight: 1.12, letterSpacing: '-0.025em' }}>{trip?.title ?? ''}</h1>
                ) : (
                    <h1 style={{ fontSize: 26, lineHeight: 1.12, letterSpacing: '-0.025em' }}>
                        <button type="button" className="dayname" style={{ whiteSpace: 'normal', cursor: 'pointer' }}
                            onClick={() => navigate(`/trips/${tripId}/settings`)} title={t('trip.settingsTitle')}>
                            {trip?.title ?? ''}
                        </button>
                    </h1>
                )}
                {meta && <p style={{ color: 'var(--ink-2)', marginTop: 6, fontSize: 14.5 }}>{meta}</p>}
                <div className="seg" role="tablist" style={{ marginTop: 16, marginBottom: 2 }}>
                    {tabs.map(tab => (
                        <button key={tab} type="button" role="tab" aria-selected={panelTab === tab}
                            onClick={() => { setPanelTab(tab); setSelectedStop(null) }}>
                            {tabLabel(tab)}
                        </button>
                    ))}
                </div>
            </header>

            {/* карта: десктоп — справа в рамке на дубовой подложке; телефон — блок под шапкой */}
            <div className={`planner-mapcell${panelTab !== 'route' ? ' hidden-mobile' : ''}`}>
                <div className="planner-mapframe">
                    <div ref={mapContainer} className="planner-map" />
                    {/* карточка точки (S9 WP-E) */}
                    {clickedPoint && (
                        <div style={{
                            position: 'absolute', left: 12, bottom: 12, zIndex: 5, width: 'min(320px, calc(100% - 24px))',
                            background: 'var(--raised)', borderRadius: 'var(--radius-lg)', padding: 14,
                            boxShadow: 'var(--shadow-2)',
                        }}>
                            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8}}>
                                <strong style={{fontSize: 15.5, lineHeight: 1.25}}>{clickedPoint.label}</strong>
                                <button type="button" className="icon-btn sm" onClick={() => setClickedPoint(null)}
                                    aria-label={t('common.close')} style={{ margin: '-6px -6px 0 0' }}>
                                    <X />
                                </button>
                            </div>
                            {clickedPoint.address && (
                                <p style={{fontSize: 13, color: 'var(--ink-3)', margin: '4px 0 10px'}}>
                                    {clickedPoint.address.split(',').slice(0, 3).join(',')}
                                </p>
                            )}
                            <div style={{display: 'grid', gap: 8}}>
                                {/* QA: точка вне зоны тайлов ломала маршрут всего дня —
                                    бэк её не примет, предупреждаем заранее. Зона — с бэка (/meta) */}
                                {!inCoverage(coverage, clickedPoint.lat, clickedPoint.lng) && (
                                    <span className="error-text">{t('errors.place_out_of_coverage')}</span>
                                )}
                                <button type="button" onClick={addClickedToRoute} className="btn btn-sm btn-accent"
                                    disabled={!inCoverage(coverage, clickedPoint.lat, clickedPoint.lng)}>
                                    <Plus />{t('place.addToRoute')}
                                </button>
                                <button type="button" onClick={makeClickedStart} disabled={!activeDay} className="btn btn-sm"
                                    title={!activeDay ? t('map.start_needs_day') : undefined}>
                                    <Flag />{t('map.makeStart')}
                                </button>
                                {!activeDay && (
                                    <span style={{fontSize: 12.5, color: 'var(--ink-3)'}}>{t('map.start_needs_day')}</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="planner-body">
                {panelTab === 'meili' ? (
                    /* AI-ассистент (ТЗ-Meili): диалог привязан к открытой поездке */
                    <div className="planner-chat">
                        <MeiliChat tripId={tripId} onApplied={reloadStops} />
                    </div>
                ) : panelTab === 'budget' ? (
                    <div style={{ padding: '18px 24px 32px' }} className="planner-pad">
                        {/* S13: в превью — только активности из стопов, без owner-ручки бюджета */}
                        {readOnly
                            ? <PreviewBudget days={days} currency={trip?.currency} />
                            : <BudgetPanel tripId={tripId} days={days} onStopsChanged={reloadStops} />}
                    </div>
                ) : selectedStop && !readOnly ? (
                    /* Детали остановки + бронирование (Sprint 6) */
                    <StopDetailPanel
                        key={selectedStop.id}
                        stop={selectedStop}
                        trip={trip}
                        // S16: дата визита приходит от дня стопа
                        dayDate={days.find(d => d.id === selectedStop.day_id)?.date ?? null}
                        onClose={() => setSelectedStop(null)}
                        onChanged={reloadStops}
                    />
                ) : (
                    <div style={{ padding: '18px 24px 32px' }} className="planner-pad">
                        {loadError && <p className="error-text" role="alert" style={{ marginBottom: 12 }}>{apiErrorMessage(loadError.e, t, t(loadError.fallback))}</p>}
                        {error && (
                            <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12, padding: '10px 12px',
                                background: 'var(--danger-wash)', color: 'var(--danger)', borderRadius: 'var(--radius)', fontSize: 14 }}>
                                <span style={{ flex: 1 }}>{error}</span>
                                <button type="button" className="icon-btn sm" onClick={() => setError(null)} aria-label={t('common.close')}
                                    style={{ color: 'inherit', margin: -4 }}><X /></button>
                            </div>
                        )}
                        {days.length > 0 ? (
                            <>
                                <DaySwatches days={days} activeDayId={expandedDayId} readOnly={readOnly}
                                    onSelect={setExpandedDayId} onDragEnd={handleDaysDragEnd} />
                                <div style={{ marginTop: 14 }}>
                                    {activeDay ? (
                                        <DayPlan
                                            key={activeDay.id}
                                            tripId={tripId}
                                            day={activeDay}
                                            allDays={days}
                                            locations={locations}
                                            currency={trip?.currency}
                                            onChanged={reloadStops}
                                            onSelectStop={setSelectedStop}
                                            onDayRenamed={renameDayLocally}
                                            readOnly={readOnly}
                                            visitedPlaceIds={visitedPlaceIds}
                                        />
                                    ) : (
                                        <DaysOverview days={days} onSelect={setExpandedDayId} />
                                    )}
                                </div>
                            </>
                        ) : daysFor === tripId && (
                            <>
                                {/* без дат дней нет: старт поездки и подсказка задать даты */}
                                {!readOnly && <StartPoint tripId={tripId} initialAddress={trip?.start_address ?? undefined} initialTime={trip?.start_time}/>}
                                {!readOnly && <div style={{ marginTop: 14 }}><PlaceSearch tripId={tripId} dayId={targetDayId} onPlaceAdded={reloadStops}/></div>}
                                <p style={{ fontSize: 14.5, color: 'var(--ink-2)', marginTop: 16 }}>
                                    {/* QA: зрителю чужой поездки подсказка про настройки бессмысленна */}
                                    {readOnly ? t('preview.noDays') : t('trip.setDatesHint')}
                                </p>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* S11: полоса ресайза (на мобилке скрыта через CSS) */}
            <div className={`panel-resize-handle${resizing ? ' dragging' : ''}`}
                onPointerDown={startResize} title={t('trip.resizePanel')} />
        </div>
        </SearchAreaContext.Provider>
    )
}

// Режим «Все дни»: оглавление поездки — он же легенда цветов маршрутов на карте.
function DaysOverview({ days, onSelect }: { days: TripDay[], onSelect: (id: string) => void }) {
    const { t, i18n } = useTranslation()
    const fmt = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'long' })
    return (
        <div>
            <p style={{ fontSize: 14.5, color: 'var(--ink-2)', marginBottom: 8 }}>{t('planner.overviewHint')}</p>
            {days.map((d, i) => (
                <button key={d.id} type="button" onClick={() => onSelect(d.id)} className="overview-row">
                    <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: '50%', background: DAY_HEX[i % DAY_HEX.length] }} />
                    <span style={{ minWidth: 0 }}>
                        <b style={{ display: 'block', fontSize: 16, fontWeight: 650 }}>{dayLabel(d, t)}</b>
                        <span style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>
                            {fmt.format(new Date(d.date + 'T00:00:00'))} · {t('profile.meta.stops', { count: d.stops.length })}
                        </span>
                    </span>
                    <ChevronRight size={18} style={{ color: 'var(--ink-3)' }} />
                </button>
            ))}
        </div>
    )
}
