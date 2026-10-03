import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Stop, TransportMode } from '../types'
import {
    optimizeDay, updateDay, type TripDay, type TripLocation,
} from '../api/days'
import { updateStop, reorderStops, getDayRoute, type RouteLeg } from '../api/trips'
import { apiErrorMessage } from '../utils/apiError'
import IntInput from './IntInput'
import { stopCostLabel } from '../utils/costLabel'
import { formatDuration, formatDistance } from '../utils/format'
import { getDaySummary } from '../utils/tripSummary'
import LocationPicker from './LocationPicker'
import DayHeader from './trip/DayHeader'
import LegRow from './trip/LegRow'
import StopDuration from './trip/StopDuration'
import {
    DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
    SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// Карточка дня (S8 WP-3): старт → стопы → финиш, оптимизация в пределах дня.
// S12: DnD стопов + сама карточка sortable. S16: имя дня, тайминги перегонов
// (Valhalla) и времени на точке, сводка дня.
interface Props {
    tripId: string
    day: TripDay
    allDays: TripDay[]
    locations: TripLocation[]
    currency?: string           // ТЗ-E: валюта поездки для примерных стоимостей
    expanded: boolean
    onToggle: () => void
    onChanged: () => void       // перезагрузить дни/локации
    onSelectStop: (stop: Stop) => void
    onDayRenamed?: (dayId: string, title: string | null) => void
    readOnly?: boolean          // S13: превью чужой поездки — интерактив погашен
    visitedPlaceIds?: Set<string>  // S15: бейдж ✓ у посещённых мест
}

// длина дня в минутах (дефолтный бюджет селективного режима, S8 WP-4)
function dayLengthMinutes(day: TripDay): number {
    const [sh, sm] = day.start_time.split(':').map(Number)
    const [eh, em] = day.end_time.split(':').map(Number)
    return Math.max(eh * 60 + em - sh * 60 - sm, 0)
}

const PRIORITY_LABELS = ['○', '★', '‼'] // обычный / важный / обязательно

// Одна строка стопа дня — sortable (грип слева) + время на месте снизу.
interface StopRowProps {
    stop: Stop
    index: number
    badge: string | null
    visited: boolean
    dayId: string
    allDays: TripDay[]
    readOnly?: boolean
    onSelect: (stop: Stop) => void
    onCyclePriority: (stop: Stop) => void
    onMoveToDay: (stopId: string, dayId: string) => void
    onDuration: (stopId: string, minutes: number) => void
}

function DayStopRow({
    stop, index, badge, visited, dayId, allDays, readOnly,
    onSelect, onCyclePriority, onMoveToDay, onDuration,
}: StopRowProps) {
    const { t } = useTranslation()
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: stop.id, disabled: readOnly })
    return (
        // QA: attributes dnd-kit (role="button", tabIndex) — на грипе, а не на
        // корне: иначе вся строка (и вся карточка дня) объявлялась кнопкой
        <div ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {!readOnly && (
                    <span {...attributes} {...listeners} aria-label={t('day.dragStop')}
                        style={{ cursor: 'grab', color: 'var(--text-muted)', fontSize: 15, userSelect: 'none', touchAction: 'none' }}>⠿</span>
                )}
                <div style={{
                    width: 20, height: 20, background: 'var(--accent)', borderRadius: '50%',
                    color: 'var(--surface)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 11, fontWeight: 'bold', flexShrink: 0,
                }}>{index + 1}</div>
                <span onClick={() => onSelect(stop)}
                    style={{ fontSize: 13, cursor: 'pointer', flex: 1, fontWeight: stop.priority === 2 ? 'bold' : 'normal' }}>
                    {stop.place_name || t('common.untitled')}
                    {stop.is_booked && <span title="🎟"> 🎟</span>}
                    {visited && <span title={t('visited.visited')} style={{ color: 'var(--accent)' }}> ✓</span>}
                    {badge && (
                        <span style={{ color: 'var(--text-muted)', fontSize: 11, fontVariantNumeric: 'tabular-nums', marginLeft: 4 }}>
                            {badge}
                        </span>
                    )}
                </span>
                {!readOnly && (
                    <>
                        {/* приоритет: обычный → важный → обязательно (S8 WP-4) */}
                        <button onClick={() => onCyclePriority(stop)} title={t('day.priorityHint')}
                            style={{
                                border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, padding: '0 2px',
                                color: stop.priority === 2 || stop.priority === 1 ? 'var(--accent)' : 'var(--text-muted)',
                            }}>
                            {PRIORITY_LABELS[stop.priority ?? 0]}
                        </button>
                        {/* перенос в другой день (S8 WP-3) */}
                        <select value={dayId} title={t('day.moveToDay')}
                            onChange={e => onMoveToDay(stop.id, e.target.value)}
                            style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface-raised)' }}>
                            {allDays.map(d => (
                                <option key={d.id} value={d.id}>{t('day.dayShort', { num: d.position })}</option>
                            ))}
                        </select>
                    </>
                )}
            </div>
            {/* S16 §4.2: время на точке */}
            <div style={{ marginLeft: readOnly ? 26 : 32 }}>
                <StopDuration stop={stop} readOnly={readOnly}
                    onSave={minutes => onDuration(stop.id, minutes)} />
            </div>
        </div>
    )
}

export default function DayCard({
    tripId, day, allDays, locations, currency, expanded, onToggle, onChanged, onSelectStop,
    onDayRenamed, readOnly = false, visitedPlaceIds,
}: Props) {
    const { t, i18n } = useTranslation()
    const queryClient = useQueryClient()
    const [busy, setBusy] = useState(false)
    // «Оптимизация…» на кнопке — только для оптимизации, не для любого клика
    const [optimizing, setOptimizing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // S8 WP-4: режим оптимизации и бюджет времени (S12: часы + минуты)
    const [mode, setMode] = useState<'full' | 'selective'>('full')
    const [budgetH, setBudgetH] = useState<number>(Math.floor(dayLengthMinutes(day) / 60))
    const [budgetM, setBudgetM] = useState<number>(dayLengthMinutes(day) % 60)

    // S12: карточка дня — sortable-элемент (реордер дней в TripPlanner)
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: day.id, disabled: readOnly })
    const stopSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

    const includedStops = day.stops.filter(s => s.included_in_route)
    const droppedStops = day.stops.filter(s => !s.included_in_route)

    // S16 §4: маршрут дня грузим, когда день раскрыт — иначе на 19-дневной
    // поездке это 19 обращений к Valhalla разом
    const routeQueryKey = ['dayRoute', tripId, day.id]
    const { data: route, isFetching: routeLoading, error: routeError } = useQuery({
        queryKey: routeQueryKey,
        queryFn: () => getDayRoute(tripId, day.id),
        enabled: expanded && includedStops.length > 0,
        retry: false,
    })
    const invalidateRoute = () =>
        queryClient.invalidateQueries({ queryKey: routeQueryKey })

    /** Перегон ПОСЛЕ стопа: from_stop_id === id стопа. */
    const legAfter = (stopId: string): RouteLeg | null =>
        route?.legs.find(l => l.from_stop_id === stopId) ?? null

    // QA: действия дня раньше были голыми await — любая ошибка сети/API
    // становилась необработанным промисом, а юзер видел, что клик «не сработал».
    // Общая обёртка: ошибка -> текст под днём, защита от двойного клика.
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
        // машинные коды (day_out_of_coverage, must_visit_over_budget,
        // day_locations_missing…) локализует apiErrorMessage — раньше любая
        // 422, включая валидацию, выдавалась за «вне покрытия карт»
        setOptimizing(true)
        return safely(async () => {
            await optimizeDay(tripId, day.id, mode, mode === 'selective' ? budget : undefined)
            onChanged()
            invalidateRoute()
        }, t('day.optimizeError')).finally(() => setOptimizing(false))
    }

    const cyclePriority = (stop: Stop) => safely(async () => {
        await updateStop(tripId, stop.id, { priority: ((stop.priority ?? 0) + 1) % 3 })
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
            // маршрут дня-получателя тоже поменялся
            queryClient.invalidateQueries({ queryKey: ['dayRoute', tripId, targetDayId] })
        })
    }

    // S16 §4.1: транспорт перегона -> пересчёт маршрута дня
    const changeTransport = (stopId: string, mode: TransportMode) => safely(async () => {
        await updateStop(tripId, stopId, { transport_to_next: mode })
        onChanged()
        invalidateRoute()
    }, t('planner.error.transport'))

    // S16 §4.2: время на точке -> меняет сводку дня и результат оптимизации
    const changeDuration = (stopId: string, minutes: number) => safely(async () => {
        await updateStop(tripId, stopId, { duration_minutes: minutes })
        onChanged()
        invalidateRoute()
    }, t('planner.error.duration'))

    // S12: перестановка стопов внутри дня -> позиции 0..n этого дня
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

    const dateLabel = new Intl.DateTimeFormat(i18n.language, {
        weekday: 'short', day: 'numeric', month: 'short',
    }).format(new Date(day.date + 'T00:00:00'))

    // ТЗ-E/ТЗ-Meili: стоимость в строке стопа — общие правила в utils/costLabel
    const costBadge = (stop: Stop): string | null =>
        stopCostLabel(stop, currency, i18n.language, t('budget.free'))?.text ?? null

    // S16 §4.3: сводка дня — остановки · километры · время (дорога + точки)
    const summary = getDaySummary(day, route)
    const summaryLine = [
        t('profile.meta.stops', { count: summary.stopsCount }),
        summary.distanceMeters > 0
            ? formatDistance(summary.distanceMeters, i18n.language, t('common.km')) : null,
        summary.durationSeconds > 0 ? formatDuration(summary.durationSeconds, t) : null,
    ].filter(Boolean).join(' · ')

    return (
        <div ref={setNodeRef}
            style={{
                border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8,
                transform: CSS.Transform.toString(transform), transition,
                opacity: isDragging ? 0.5 : 1, background: 'var(--surface-raised)',
            }}>
            <DayHeader
                tripId={tripId}
                day={day}
                expanded={expanded}
                onToggle={onToggle}
                onRenamed={title => onDayRenamed?.(day.id, title)}
                onError={setError}
                readOnly={readOnly}
                grip={!readOnly && (
                    <span {...attributes} {...listeners} onClick={e => e.stopPropagation()} title={t('day.dragDay')}
                        aria-label={t('day.dragDay')}
                        style={{ cursor: 'grab', color: 'var(--text-muted)', fontSize: 16, userSelect: 'none', touchAction: 'none' }}>⠿</span>
                )}
                subtitle={
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {dateLabel}{expanded && summaryLine ? ` · ${summaryLine}` : ''}
                    </div>
                } />

            {expanded && (
                <div style={{ padding: '8px 12px' }}>
                    {/* S13: в превью старт/финиш владельца не показываем */}
                    {!readOnly && (
                        <>
                            <LocationPicker
                                tripId={tripId} label={t('day.start')} value={day.start_location}
                                locations={locations}
                                onSelect={id => setLocation('start_location_id', id)}
                                onLocationAdded={onChanged}
                            />
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 6px 4px' }}>
                                {t('day.at', { time: day.start_time.slice(0, 5) })}
                            </div>
                        </>
                    )}

                    {/* стопы дня + перегоны между ними */}
                    <DndContext sensors={stopSensors} collisionDetection={closestCenter} onDragEnd={handleStopsDragEnd}>
                        <SortableContext items={includedStops.map(s => s.id)} strategy={verticalListSortingStrategy}>
                            {includedStops.map((stop, i) => (
                                <div key={stop.id}>
                                    <DayStopRow
                                        stop={stop}
                                        index={i}
                                        badge={costBadge(stop)}
                                        visited={visitedPlaceIds?.has(stop.place_id) ?? false}
                                        dayId={day.id}
                                        allDays={allDays}
                                        readOnly={readOnly}
                                        onSelect={onSelectStop}
                                        onCyclePriority={cyclePriority}
                                        onMoveToDay={moveStopToDay}
                                        onDuration={changeDuration}
                                    />
                                    {/* перегон до следующей точки (у последней — до финиша дня) */}
                                    {(i < includedStops.length - 1 || day.end_location) && (
                                        <LegRow
                                            leg={legAfter(stop.id)}
                                            loading={(routeLoading && !route) || (!route && !routeError && includedStops.length > 0)}
                                            readOnly={readOnly}
                                            onChangeTransport={mode => changeTransport(stop.id, mode)}
                                        />
                                    )}
                                </div>
                            ))}
                        </SortableContext>
                    </DndContext>
                    {/* QA: маршрут дня не строится — говорим почему, а не молчим */}
                    {routeError && includedStops.length > 0 && (
                        <p style={{ fontSize: 12, color: 'var(--accent)', margin: '4px 0' }}>
                            {apiErrorMessage(routeError, t, t('planner.leg.unavailable'))}
                        </p>
                    )}
                    {day.stops.length === 0 && (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0' }}>
                            {t('day.empty')}
                        </p>
                    )}

                    {/* «не влезло в день» (S8 WP-4) — в превью не показываем */}
                    {!readOnly && droppedStops.length > 0 && (
                        <div style={{
                            background: 'var(--surface)', border: '1px dashed var(--border)',
                            borderRadius: 6, padding: 8, margin: '6px 0',
                        }}>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                                {t('day.notFit')}
                            </div>
                            {droppedStops.map(stop => (
                                <div key={stop.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    fontSize: 12, color: 'var(--text-muted)', marginBottom: 2,
                                }}>
                                    <span style={{ flex: 1, textDecoration: 'line-through' }}>
                                        {stop.place_name || t('common.untitled')}
                                    </span>
                                    <button onClick={() => returnStop(stop)}
                                        title={t('day.returnHint')}
                                        style={{
                                            border: '1px solid var(--border)', background: 'var(--surface-raised)',
                                            borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '1px 6px',
                                        }}>
                                        {t('common.return')}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* S13: финиш и оптимизация — только в режиме редактирования */}
                    {!readOnly && (
                        <>
                            <LocationPicker
                                tripId={tripId} label={t('day.finish')} value={day.end_location}
                                locations={locations}
                                onSelect={id => setLocation('end_location_id', id)}
                                onLocationAdded={onChanged}
                            />

                            {/* режим оптимизации (S8 WP-4) */}
                            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                {(['full', 'selective'] as const).map(m => (
                                    <label key={m} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                                        <input type="radio" checked={mode === m} onChange={() => setMode(m)} />
                                        {m === 'full' ? t('day.modeFull') : t('day.modeSelective')}
                                    </label>
                                ))}
                                {/* S12: бюджет времени — часы + минуты, а не сырые минуты */}
                                {mode === 'selective' && (
                                    <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 3 }}>
                                        <IntInput value={budgetH} min={0} max={24} onChange={setBudgetH}
                                            style={{ width: 46, padding: 2, border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }} />
                                        {t('common.hoursShort')}
                                        <IntInput value={budgetM} min={0} max={59} onChange={setBudgetM}
                                            style={{ width: 46, padding: 2, border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }} />
                                        {t('common.min')}
                                    </span>
                                )}
                            </div>

                            {error && <p style={{ color: 'var(--accent)', fontSize: 12, marginTop: 6 }}>{error}</p>}

                            <button onClick={handleOptimize} disabled={busy || day.stops.length === 0}
                                style={{
                                    marginTop: 8, padding: '6px 12px', width: '100%',
                                    background: busy ? 'var(--text-muted)' : 'var(--accent)', color: 'var(--surface)',
                                    border: 'none', borderRadius: 6,
                                    cursor: busy ? 'not-allowed' : 'pointer', fontSize: 13,
                                }}>
                                {optimizing ? t('day.optimizing') : t('day.optimize')}
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
