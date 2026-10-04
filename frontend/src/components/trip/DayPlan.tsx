import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
    BadgeCheck, CalendarArrowUp, CircleAlert, CircleCheck, Circle, EllipsisVertical,
    GripVertical, Info, Route as RouteIcon, Star, Undo2,
} from 'lucide-react'
import {
    DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Stop, TransportMode } from '../../types'
import { optimizeDay, updateDay, renameDay, type TripDay, type TripLocation } from '../../api/days'
import { updateStop, reorderStops, dayRouteQuery, type RouteLeg } from '../../api/trips'
import { apiErrorMessage } from '../../utils/apiError'
import { stopCostLabel } from '../../utils/costLabel'
import { formatDistance } from '../../utils/format'
import { formatMoneyCompact } from '../../utils/money'
import { dayLabel } from '../../utils/dayLabel'
import { dayCost, daySchedule } from '../../utils/daySchedule'
import { useTripStore } from '../../store/tripStore'
import IntInput from '../IntInput'
import LocationPicker from '../LocationPicker'
import PlaceSearch from '../PlaceSearch'
import Menu, { type MenuEntry } from '../ui/Menu'
import LegRow from './LegRow'
import StopDuration from './StopDuration'

// Редизайн «Лес» (было DayCard, S8 WP-3 → S16): один открытый день целиком.
// Сверху блок дня цветом интерфейса (с–по, км, деньги), ниже поиск в этот
// день, старт → места с перегонами → финиш, «не влезло», оптимизация.
// Дни переключаются образцами (DaySwatches), аккордеона больше нет.

interface Props {
    tripId: string
    day: TripDay
    allDays: TripDay[]
    locations: TripLocation[]
    currency?: string           // ТЗ-E: валюта поездки для примерных стоимостей
    onChanged: () => void       // перезагрузить дни/локации/стопы
    onSelectStop: (stop: Stop) => void
    onDayRenamed?: (dayId: string, title: string | null) => void
    readOnly?: boolean          // S13: превью чужой поездки — интерактив погашен
    visitedPlaceIds?: Set<string>  // S15: отметка у посещённых мест
}

// сетка строки: [грип][номер][место][время][меню]; в превью без грипа и меню
const COLS_EDIT = '20px 32px minmax(0, 1fr) auto 32px'
const COLS_READ = '32px minmax(0, 1fr) auto'

// длина дня в минутах (дефолтный бюджет селективного режима, S8 WP-4)
function dayLengthMinutes(day: TripDay): number {
    const [sh, sm] = day.start_time.split(':').map(Number)
    const [eh, em] = day.end_time.split(':').map(Number)
    return Math.max(eh * 60 + em - sh * 60 - sm, 0)
}

const PRIORITY_ICON = [Circle, Star, CircleAlert]

interface StopRowProps {
    stop: Stop
    index: number
    arrive: string | null
    cost: string | null
    visited: boolean
    day: TripDay
    allDays: TripDay[]
    readOnly?: boolean
    onSelect: (stop: Stop) => void
    onPriority: (stop: Stop, priority: number) => void
    onMoveToDay: (stopId: string, dayId: string) => void
    onDuration: (stopId: string, minutes: number) => void
}

function StopRow({
    stop, index, arrive, cost, visited, day, allDays, readOnly,
    onSelect, onPriority, onMoveToDay, onDuration,
}: StopRowProps) {
    const { t, i18n } = useTranslation()
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: stop.id, disabled: readOnly })
    const priority = stop.priority ?? 0
    const shortDate = (d: TripDay) => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric' })
        .format(new Date(d.date + 'T00:00:00'))

    const menu: MenuEntry[] = [
        { type: 'label', label: t('planner.stop.priority') },
        ...[0, 1, 2].map(p => {
            const PIcon = PRIORITY_ICON[p]
            return { label: t(`planner.priority.p${p}`), icon: <PIcon />, checked: priority === p,
                onSelect: () => { if (p !== priority) onPriority(stop, p) } }
        }),
    ]
    const others = allDays.filter(d => d.id !== day.id)
    if (others.length) {
        menu.push({ type: 'sep' }, { type: 'label', label: t('day.moveToDay') })
        others.forEach(d => menu.push({
            label: `${dayLabel(d, t)} · ${shortDate(d)}`, icon: <CalendarArrowUp />,
            onSelect: () => onMoveToDay(stop.id, d.id),
        }))
    }
    menu.push({ type: 'sep' }, { label: t('planner.stop.details'), icon: <Info />, onSelect: () => onSelect(stop) })

    return (
        // QA: attributes dnd-kit (role="button", tabIndex) — на грипе, а не на
        // корне: иначе вся строка объявлялась кнопкой
        <div ref={setNodeRef} className="stop-row"
            style={{
                display: 'grid', gridTemplateColumns: readOnly ? COLS_READ : COLS_EDIT, columnGap: 10,
                alignItems: 'start', padding: '10px 8px', borderRadius: 'var(--radius-lg)',
                transform: CSS.Transform.toString(transform), transition,
                opacity: isDragging ? 0.6 : 1, position: 'relative', zIndex: isDragging ? 2 : undefined,
                background: isDragging ? 'var(--raised)' : undefined,
                boxShadow: isDragging ? 'var(--shadow-2)' : undefined,
            }}>
            {!readOnly && (
                <button type="button" className="grip" {...attributes} {...listeners} aria-label={t('day.dragStop')}>
                    <GripVertical size={16} />
                </button>
            )}
            <span aria-hidden="true" style={{
                width: 32, height: 32, borderRadius: '50%', background: 'var(--moss)', color: 'var(--raised)',
                display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14,
                outline: priority === 2 ? '2.5px solid var(--moss)' : undefined, outlineOffset: 2.5,
            }}>{index + 1}</span>
            <div style={{ minWidth: 0, paddingTop: 4 }}>
                <button type="button" onClick={() => onSelect(stop)} className="stop-name">
                    {stop.place_name || t('common.untitled')}
                </button>
                {priority > 0 && (
                    <span style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--moss)', marginLeft: 8, whiteSpace: 'nowrap' }}>
                        {t(`planner.priority.tag${priority}`)}
                    </span>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', marginTop: 3, fontSize: 14, color: 'var(--ink-2)' }}>
                    <StopDuration stop={stop} readOnly={readOnly} onSave={minutes => onDuration(stop.id, minutes)} />
                    {stop.is_booked ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ok)', fontWeight: 600 }}>
                            {cost}<BadgeCheck size={15} aria-label={t('booking.confirmed')} />
                        </span>
                    ) : cost === t('budget.free') ? (
                        <span style={{ color: 'var(--ok)', fontWeight: 600 }}>{cost}</span>
                    ) : (
                        <span style={{ color: cost ? undefined : 'var(--ink-3)' }}>{cost ?? t('budget.noPrice')}</span>
                    )}
                    {visited && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ok)' }}>
                            <CircleCheck size={15} />{t('visited.visited')}
                        </span>
                    )}
                </div>
            </div>
            <span style={{ fontWeight: 650, fontSize: 15, paddingTop: 6, color: 'var(--ink)' }}>{arrive ?? ''}</span>
            {!readOnly && (
                <Menu items={menu} label={t('planner.stop.more')}
                    trigger={props => (
                        <button {...props} type="button" className="icon-btn sm" title={t('planner.stop.more')}
                            aria-label={t('planner.stop.more')} style={{ marginTop: 2 }}>
                            <EllipsisVertical />
                        </button>
                    )} />
            )}
        </div>
    )
}

export default function DayPlan({
    tripId, day, allDays, locations, currency, onChanged, onSelectStop,
    onDayRenamed, readOnly = false, visitedPlaceIds,
}: Props) {
    const { t, i18n } = useTranslation()
    const queryClient = useQueryClient()
    const [busy, setBusy] = useState(false)
    // «Оптимизируем…» на кнопке — только для оптимизации, не для любого клика
    const [optimizing, setOptimizing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // S8 WP-4: режим оптимизации и бюджет времени (S12: часы + минуты)
    const [mode, setMode] = useState<'full' | 'selective'>('full')
    const [budgetH, setBudgetH] = useState<number>(Math.floor(dayLengthMinutes(day) / 60))
    const [budgetM, setBudgetM] = useState<number>(dayLengthMinutes(day) % 60)
    const stopSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
    const columns = readOnly ? COLS_READ : COLS_EDIT

    const includedStops = day.stops.filter(s => s.included_in_route)
    const droppedStops = day.stops.filter(s => !s.included_in_route)

    // S16 §4: маршрут грузим только для открытого дня.
    // Ревью (e2e): ключ — от состава дня (был только (поездка, день): после
    // второго стопа панель держала «—» и 0,0 км). Ключ общий с картой
    // (api/trips.dayRouteKey) — один запрос на двоих
    const routeQuery = dayRouteQuery(tripId, day)
    const routeQueryKey = routeQuery.queryKey
    const { data: route, isFetching: routeLoading, error: routeError } = useQuery({
        ...routeQuery,
        enabled: includedStops.length > 0,
    })
    const invalidateRoute = () => queryClient.invalidateQueries({ queryKey: routeQueryKey })
    const legAfter = (stopId: string): RouteLeg | null => route?.legs.find(l => l.from_stop_id === stopId) ?? null
    const legFromStart = route?.legs.find(l => l.from_stop_id === null) ?? null
    const legsLoading = (routeLoading && !route) || (!route && !routeError && includedStops.length > 0)

    // QA: действия дня раньше были голыми await — любая ошибка сети/API
    // становилась необработанным промисом. Общая обёртка: ошибка -> текст под
    // днём, защита от двойного клика.
    const safely = async (fn: () => Promise<unknown>, fallback?: string) => {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
            await fn()
        } catch (e) {
            setError(apiErrorMessage(e, t, fallback))
        } finally {
            setBusy(false)
        }
    }

    const handleOptimize = () => {
        const budget = budgetH * 60 + budgetM
        if (mode === 'selective' && budget <= 0) {
            setError(t('day.budgetRequired'))
            return
        }
        // машинные коды (day_out_of_coverage, must_visit_over_budget…)
        // локализует apiErrorMessage
        setOptimizing(true)
        return safely(async () => {
            await optimizeDay(tripId, day.id, mode, mode === 'selective' ? budget : undefined)
            onChanged()
            invalidateRoute()
        }, t('day.optimizeError')).finally(() => setOptimizing(false))
    }

    const setPriority = (stop: Stop, priority: number) => safely(async () => {
        await updateStop(tripId, stop.id, { priority })
        onChanged()
    })

    const returnStop = (stop: Stop) => safely(async () => {
        // «вернуть»: сразу в хвост маршрута + обязательный, чтобы следующий
        // селективный прогон его не выкинул снова
        await updateStop(tripId, stop.id, { priority: 2, included_in_route: true })
        onChanged()
        invalidateRoute()
    })

    const moveStopToDay = (stopId: string, targetDayId: string) => {
        if (targetDayId === day.id) return
        return safely(async () => {
            await updateStop(tripId, stopId, { day_id: targetDayId })
            onChanged()
            invalidateRoute()
            queryClient.invalidateQueries({ queryKey: ['dayRoute', tripId, targetDayId] })
        })
    }

    // S16 §4.1: транспорт перегона -> пересчёт маршрута дня
    const changeTransport = (stopId: string, m: TransportMode) => safely(async () => {
        await updateStop(tripId, stopId, { transport_to_next: m })
        onChanged()
        invalidateRoute()
    }, t('planner.error.transport'))

    // S16 §4.2: время на точке -> меняет расписание и результат оптимизации
    const changeDuration = (stopId: string, minutes: number) => safely(async () => {
        await updateStop(tripId, stopId, { duration_minutes: minutes })
        onChanged()
        invalidateRoute()
    }, t('planner.error.duration'))

    // S12: перестановка стопов внутри дня
    const handleStopsDragEnd = async (e: DragEndEvent) => {
        const { active, over } = e
        if (!over || active.id === over.id) return
        const oldI = includedStops.findIndex(s => s.id === active.id)
        const newI = includedStops.findIndex(s => s.id === over.id)
        if (oldI < 0 || newI < 0) return
        const newIncluded = arrayMove(includedStops, oldI, newI)
        return safely(async () => {
            await reorderStops(tripId, [...newIncluded, ...droppedStops].map(s => s.id))
            onChanged()
            invalidateRoute()
        })
    }

    const setLocation = (field: 'start_location_id' | 'end_location_id', locId: string) => safely(async () => {
        await updateDay(tripId, day.id, { [field]: locId })
        onChanged()
        invalidateRoute()
    })

    const schedule = daySchedule(day.start_time, includedStops, route?.legs)
    const start = day.start_time.slice(0, 5)
    const costOf = (stop: Stop) => stopCostLabel(stop, currency, i18n.language, t('budget.free'))?.text ?? null

    return (
        <div>
            <DayBlock day={day} tripId={tripId} readOnly={readOnly} currency={currency}
                start={start} finish={schedule?.finish ?? null} route={route ?? null}
                onRenamed={title => onDayRenamed?.(day.id, title)} onError={setError} />

            {!readOnly && (
                <div style={{ marginTop: 14 }}>
                    <PlaceSearch tripId={tripId} dayId={day.id} onPlaceAdded={onChanged}
                        placeholder={t('planner.searchForDay', { num: day.position })} />
                </div>
            )}

            <div style={{ marginTop: 12 }}>
                {/* S13: в превью старт/финиш владельца не показываем */}
                {!readOnly && (
                    <LocationPicker tripId={tripId} kind="start" columns={columns}
                        label={t('planner.startAt', { time: start })}
                        value={day.start_location} locations={locations}
                        onSelect={id => setLocation('start_location_id', id)}
                        onLocationAdded={onChanged} />
                )}
                {!readOnly && day.start_location && includedStops.length > 0 && (
                    <LegRow leg={legFromStart} loading={legsLoading} columns={columns} railColumn={2}
                        onChangeTransport={() => {}} readOnly />
                )}

                <DndContext sensors={stopSensors} collisionDetection={closestCenter} onDragEnd={handleStopsDragEnd}>
                    <SortableContext items={includedStops.map(s => s.id)} strategy={verticalListSortingStrategy}>
                        {includedStops.map((stop, i) => (
                            <div key={stop.id}>
                                <StopRow stop={stop} index={i}
                                    arrive={schedule?.arrive[stop.id] ?? null}
                                    cost={costOf(stop)}
                                    visited={visitedPlaceIds?.has(stop.place_id) ?? false}
                                    day={day} allDays={allDays} readOnly={readOnly}
                                    onSelect={onSelectStop} onPriority={setPriority}
                                    onMoveToDay={moveStopToDay} onDuration={changeDuration} />
                                {/* перегон до следующей точки (у последней — до финиша дня) */}
                                {(i < includedStops.length - 1 || (!readOnly && day.end_location)) && (
                                    <LegRow leg={legAfter(stop.id)} loading={legsLoading} readOnly={readOnly}
                                        columns={columns} railColumn={readOnly ? 1 : 2}
                                        onChangeTransport={m => changeTransport(stop.id, m)} />
                                )}
                            </div>
                        ))}
                    </SortableContext>
                </DndContext>

                {/* QA: маршрут дня не строится — говорим почему, а не молчим */}
                {routeError && includedStops.length > 0 && (
                    <p className="error-text" style={{ margin: '6px 8px' }}>
                        {apiErrorMessage(routeError, t, t('planner.leg.unavailable'))}
                    </p>
                )}
                {day.stops.length === 0 && (
                    <p style={{ fontSize: 14.5, color: 'var(--ink-3)', padding: '14px 8px' }}>{t('day.empty')}</p>
                )}

                {!readOnly && (
                    <LocationPicker tripId={tripId} kind="finish" columns={columns}
                        label={schedule ? t('planner.finishAround', { time: schedule.finish }) : t('planner.finish')}
                        value={day.end_location} locations={locations}
                        onSelect={id => setLocation('end_location_id', id)}
                        onLocationAdded={onChanged} />
                )}
            </div>

            {/* «не влезло в день» (S8 WP-4) — в превью не показываем */}
            {!readOnly && droppedStops.length > 0 && (
                <div style={{ marginTop: 12, padding: '12px 14px', border: '2px dashed var(--birch-2)', borderRadius: 'var(--radius-lg)' }}>
                    <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--ink-2)', marginBottom: 6 }}>{t('day.notFit')}</div>
                    {droppedStops.map(stop => (
                        <div key={stop.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                            <span style={{ flex: 1, fontSize: 14.5, color: 'var(--ink-3)', textDecoration: 'line-through' }}>
                                {stop.place_name || t('common.untitled')}
                            </span>
                            <button type="button" className="btn btn-sm btn-pill" onClick={() => returnStop(stop)} title={t('day.returnHint')}>
                                <Undo2 />{t('common.return')}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* S13: оптимизация — только в режиме редактирования */}
            {!readOnly && (
                <div style={{ marginTop: 18, display: 'grid', gap: 10 }}>
                    <div className="seg" role="group" aria-label={t('planner.optimizeMode')}>
                        {(['full', 'selective'] as const).map(m => (
                            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
                                {m === 'full' ? t('day.modeFull') : t('day.modeSelective')}
                            </button>
                        ))}
                    </div>
                    {/* S12: бюджет времени — часы + минуты, а не сырые минуты */}
                    {mode === 'selective' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 14.5, color: 'var(--ink-2)' }}>
                            <span style={{ marginRight: 'auto' }}>{t('planner.timeBudget')}</span>
                            <IntInput value={budgetH} min={0} max={24} onChange={setBudgetH}
                                className="input input-sm" style={{ width: 64 }} aria-label={t('common.hoursShort')} />
                            {t('common.hoursShort')}
                            <IntInput value={budgetM} min={0} max={59} onChange={setBudgetM}
                                className="input input-sm" style={{ width: 64 }} aria-label={t('common.min')} />
                            {t('common.min')}
                        </div>
                    )}
                    {error && <p className="error-text" role="alert">{error}</p>}
                    <button type="button" onClick={handleOptimize} disabled={busy || day.stops.length === 0}
                        className="btn btn-primary btn-lg btn-block">
                        <RouteIcon />{optimizing ? t('day.optimizing') : t('day.optimize')}
                    </button>
                </div>
            )}
            {readOnly && error && <p className="error-text" role="alert" style={{ marginTop: 10 }}>{error}</p>}
        </div>
    )
}

// Блок дня — цветом интерфейса: имя (переименование по клику), дата, с–по,
// километры, деньги дня. S16 §3: «День N» в базе не хранится.
interface DayBlockProps {
    day: TripDay
    tripId: string
    readOnly: boolean
    currency?: string
    start: string
    finish: string | null
    route: { total_distance_meters: number; legs: RouteLeg[] } | null
    onRenamed: (title: string | null) => void
    onError: (message: string) => void
}

function DayBlock({ day, tripId, readOnly, currency, start, finish, route, onRenamed, onError }: DayBlockProps) {
    const { t, i18n } = useTranslation()
    const { renamingDayId, startRenaming, stopRenaming } = useTripStore()
    const editing = renamingDayId === day.id
    // непереименованный день стартует с ПУСТОГО поля: подставленный текст
    // пришлось бы стирать вручную
    const [value, setValue] = useState(day.title ?? '')
    const inputRef = useRef<HTMLInputElement>(null)
    const savedRef = useRef(false)

    useEffect(() => {
        if (editing) requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select() })
    }, [editing])

    const commit = async () => {
        if (savedRef.current) return       // blur после Enter не сохраняет дважды
        savedRef.current = true
        const next = value.trim() || null   // пусто/пробелы -> снова «День N»
        stopRenaming()
        if (next === (day.title ?? null)) return
        const prev = day.title ?? null
        onRenamed(next)                     // оптимистично
        try {
            await renameDay(tripId, day.id, next)
        } catch {
            onRenamed(prev)                 // откат
            onError(t('planner.error.rename'))
        }
    }

    const included = day.stops.filter(s => s.included_in_route)
    const legs = route?.legs ?? []
    const moveWord = legs.length && legs.every(l => l.costing === legs[0].costing)
        ? t(`planner.leg.${legs[0].costing}`) : t('planner.onTheWay')
    const cost = dayCost(day.stops)
    const money = (v: number) => formatMoneyCompact(v, currency, i18n.language)
    const costText = cost.priced === 0 ? '—'
        : cost.min === cost.max ? `${cost.approx ? '≈ ' : ''}${money(cost.min)}`
        : `≈ ${money(cost.min)}–${money(cost.max)}`
    const costNote = cost.priced === 0 ? t('planner.noPrices')
        : cost.missing ? t('planner.withoutPrice', { count: cost.missing }) : t('planner.allPriced')
    const date = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'long' })
        .format(new Date(day.date + 'T00:00:00'))

    const fact = (big: string, small: string) => (
        <div style={{ minWidth: 0 }}>
            <b style={{ display: 'block', fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{big}</b>
            <span style={{ fontSize: 13, opacity: 0.88 }}>{small}</span>
        </div>
    )

    return (
        <section style={{ background: 'var(--moss)', color: 'var(--raised)', borderRadius: 'var(--radius-xl)', padding: '16px 18px 18px' }}>
            <h2 style={{ fontSize: 21, fontWeight: 700, color: 'inherit', display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                {editing ? (
                    <input ref={inputRef} value={value} maxLength={120}
                        aria-label={t('planner.day.nameLabel')}
                        placeholder={t('planner.day.default', { position: day.position })}
                        onChange={e => setValue(e.target.value)}
                        onBlur={commit}
                        onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); commit() }
                            if (e.key === 'Escape') { e.preventDefault(); savedRef.current = true; stopRenaming() }
                        }}
                        className="dayname-input" />
                ) : (
                    <button type="button" disabled={readOnly} className="dayname"
                        title={readOnly ? undefined : t('planner.day.rename')}
                        aria-label={readOnly ? undefined : t('planner.day.rename')}
                        onClick={() => { setValue(day.title ?? ''); savedRef.current = false; startRenaming(day.id) }}>
                        {dayLabel(day, t)}
                    </button>
                )}
                {!editing && <span style={{ fontWeight: 500, opacity: 0.88, whiteSpace: 'nowrap' }}>· {date}</span>}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', justifyContent: 'start', gap: '4px 22px', marginTop: 10 }}>
                {fact(finish ? `${start}–${finish}` : start, t('profile.meta.stops', { count: included.length }))}
                {fact(route ? formatDistance(route.total_distance_meters, i18n.language, t('common.km')) : '—',
                    route ? moveWord : t('planner.noRoute'))}
                {fact(costText, costNote)}
            </div>
        </section>
    )
}
