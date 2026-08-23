import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Stop, TransportMode } from '../types'
import {
    optimizeDay, updateDay, type TripDay, type TripLocation,
} from '../api/days'
import { updateStop, reorderStops, getDayRoute, type RouteLeg } from '../api/trips'
import { ApiError } from '../api/client'
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
        <div ref={setNodeRef} {...attributes}
            style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {!readOnly && (
                    <span {...listeners} style={{ cursor: 'grab', color: 'var(--text-muted)', fontSize: 15, userSelect: 'none', touchAction: 'none' }}>⠿</span>
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
    const { data: route, isFetching: routeLoading } = useQuery({
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

    const handleOptimize = async () => {
        setBusy(true)
        setError(null)
        try {
            const budget = budgetH * 60 + budgetM
            await optimizeDay(tripId, day.id, mode, mode === 'selective' ? budget : undefined)
            onChanged()
            invalidateRoute()
        } catch (e) {
            if (e instanceof ApiError && e.status === 422) {
                setError(t('day.outOfCoverage'))
            } else if (e instanceof ApiError && e.status === 409) {
                setError(t('day.mustVisitOverBudget'))
            } else if (e instanceof ApiError && e.status === 400) {
                setError(t(`errors.${(e.body as { detail?: string })?.detail}`, t('day.optimizeError')))
            } else {
                setError(t('day.optimizeError'))
            }
        } finally {
            setBusy(false)
        }
    }

    const cyclePriority = async (stop: Stop) => {
        await updateStop(tripId, stop.id, { priority: ((stop.priority ?? 0) + 1) % 3 })
        onChanged()
    }

    const returnStop = async (stop: Stop) => {
        // «вернуть»: помечаем обязательным — следующий прогон его включит
        await updateStop(tripId, stop.id, { priority: 2 })
        onChanged()
    }

    const moveStopToDay = async (stopId: string, targetDayId: string) => {
        if (targetDayId === day.id) return
        await updateStop(tripId, stopId, { day_id: targetDayId })
        onChanged()
        invalidateRoute()
    }

    // S16 §4.1: транспорт перегона -> пересчёт маршрута дня
    const changeTransport = async (stopId: string, mode: TransportMode) => {
        try {
            await updateStop(tripId, stopId, { transport_to_next: mode })
            onChanged()
            invalidateRoute()
        } catch {
            setError(t('planner.error.transport'))
        }
    }

    // S16 §4.2: время на точке -> меняет сводку дня и результат оптимизации
    const changeDuration = async (stopId: string, minutes: number) => {
        try {
            await updateStop(tripId, stopId, { duration_minutes: minutes })
            onChanged()
            invalidateRoute()
        } catch {
            setError(t('planner.error.duration'))
        }
    }

    // S12: перестановка стопов внутри дня -> позиции 0..n этого дня
    const handleStopsDragEnd = async (e: DragEndEvent) => {
        const { active, over } = e
        if (!over || active.id === over.id) return
        const oldI = includedStops.findIndex(s => s.id === active.id)
        const newI = includedStops.findIndex(s => s.id === over.id)
        if (oldI < 0 || newI < 0) return
        const newIncluded = arrayMove(includedStops, oldI, newI)
        await reorderStops(tripId, [...newIncluded, ...droppedStops].map(s => s.id))
        onChanged()
        invalidateRoute()
    }

    const setLocation = async (field: 'start_location_id' | 'end_location_id', locId: string) => {
        await updateDay(tripId, day.id, { [field]: locId })
        onChanged()
        invalidateRoute()
    }

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
            }}
            {...attributes}>
            <DayHeader
                tripId={tripId}
                day={day}
                expanded={expanded}
                onToggle={onToggle}
                onRenamed={title => onDayRenamed?.(day.id, title)}
                onError={setError}
                readOnly={readOnly}
                grip={!readOnly && (
                    <span {...listeners} onClick={e => e.stopPropagation()} title={t('day.dragDay')}
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
                                            loading={routeLoading && !route}
                                            readOnly={readOnly}
                                            onChangeTransport={mode => changeTransport(stop.id, mode)}
                                        />
                                    )}
                                </div>
                            ))}
                        </SortableContext>
                    </DndContext>
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
                                        <input type="number" min={0} value={budgetH}
                                            onChange={e => setBudgetH(Math.max(0, parseInt(e.target.value) || 0))}
                                            style={{ width: 46, padding: 2, border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }} />
                                        {t('common.hoursShort')}
                                        <input type="number" min={0} max={59} value={budgetM}
                                            onChange={e => setBudgetM(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
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
                                {busy ? t('day.optimizing') : t('day.optimize')}
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
