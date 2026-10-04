import { useTranslation } from 'react-i18next'
import {
    DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TripDay } from '../../api/days'
import { dayLabel } from '../../utils/dayLabel'

// Редизайн «Лес»: дни — образцы (как карта цветов ткани) вместо аккордеона
// и мобильной пилюли. Активный — зелёный. Последний образец — «Все дни»
// (обзор всех маршрутов на карте). S12/S16 §1.5: реордер дней перетаскиванием
// образца; клик выбирает — drag стартует только после сдвига (мышь) или
// долгого нажатия (тач), чтобы листать ряд пальцем.

interface Props {
    days: TripDay[]
    activeDayId: string | null
    readOnly?: boolean
    onSelect: (dayId: string | null) => void
    onDragEnd: (e: DragEndEvent) => void
}

function Swatch({ day, active, readOnly, onSelect }: {
    day: TripDay; active: boolean; readOnly?: boolean; onSelect: () => void
}) {
    const { t, i18n } = useTranslation()
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: day.id, disabled: readOnly })
    const d = new Date(day.date + 'T00:00:00')
    const wd = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(d)
    return (
        <button ref={setNodeRef} type="button" className="swatch"
            {...attributes} {...listeners} aria-pressed={active}
            title={`${dayLabel(day, t)}${readOnly ? '' : ` — ${t('day.dragDay')}`}`}
            onClick={onSelect}
            style={{
                transform: CSS.Transform.toString(transform), transition,
                opacity: isDragging ? 0.7 : 1, boxShadow: isDragging ? 'var(--shadow-2)' : undefined,
            }}>
            <small>{wd.charAt(0).toUpperCase() + wd.slice(1)}</small>
            <b>{d.getDate()}</b>
        </button>
    )
}

export default function DaySwatches({ days, activeDayId, readOnly, onSelect, onDragEnd }: Props) {
    const { t } = useTranslation()
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 8 } }),
    )
    if (days.length === 0) return null
    return (
        <div className="swatches" role="group" aria-label={t('planner.daysLabel')}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={days.map(d => d.id)} strategy={horizontalListSortingStrategy}>
                    {days.map(d => (
                        <Swatch key={d.id} day={d} active={d.id === activeDayId} readOnly={readOnly}
                            onSelect={() => onSelect(d.id)} />
                    ))}
                </SortableContext>
            </DndContext>
            {days.length > 1 && (
                <button type="button" className="swatch" aria-pressed={activeDayId === null}
                    aria-label={t('day.allDays')} title={t('day.allDays')} onClick={() => onSelect(null)}>
                    <small>{t('profile.meta.days', { count: days.length })}</small>
                    <b>{t('planner.allShort')}</b>
                </button>
            )}
        </div>
    )
}
