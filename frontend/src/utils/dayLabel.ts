import type { TripDay } from '../api/days'

// S16 §3.1: подпись дня. «День N» НЕ хранится в базе — её собирают здесь
// из position, и это единственное место с форматом по умолчанию.
type Translate = (key: string, opts?: Record<string, unknown>) => string

export function dayLabel(day: Pick<TripDay, 'title' | 'position'>, t: Translate): string {
    return day.title || t('planner.day.default', { position: day.position })
}

/** Короткая подпись для списков и селектов: имя дня или «Д3». */
export function dayLabelShort(day: Pick<TripDay, 'title' | 'position'>, t: Translate): string {
    return day.title || t('day.dayShort', { num: day.position })
}
