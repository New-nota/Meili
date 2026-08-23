import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TripDay } from '../../api/days'
import { renameDay } from '../../api/days'
import { dayLabel } from '../../utils/dayLabel'
import { useTripStore } from '../../store/tripStore'

// S16 §3: шапка дня — подпись «День N» (из position) либо имя, заданное юзером.
// Клик по заголовку открывает inline-редактор и НЕ сворачивает аккордеон:
// раскрытием управляют шеврон и область строки вне заголовка.

interface Props {
    tripId: string
    day: TripDay
    expanded: boolean
    onToggle: () => void
    onRenamed: (title: string | null) => void   // оптимистичное обновление
    onError: (message: string) => void
    readOnly?: boolean
    subtitle?: React.ReactNode
    grip?: React.ReactNode
}

export default function DayHeader({
    tripId, day, expanded, onToggle, onRenamed, onError, readOnly, subtitle, grip,
}: Props) {
    const { t } = useTranslation()
    const { renamingDayId, startRenaming, stopRenaming } = useTripStore()
    const editing = renamingDayId === day.id
    // непереименованный день стартует с ПУСТОГО поля: подставленный текст
    // пришлось бы стирать вручную
    const [value, setValue] = useState(day.title ?? '')
    const inputRef = useRef<HTMLInputElement>(null)
    const savedRef = useRef(false)

    useEffect(() => {
        if (editing) {
            setValue(day.title ?? '')
            savedRef.current = false
            // автофокус с выделением текста: focus() обязателен — select()
            // сам по себе фокус не переносит
            requestAnimationFrame(() => {
                inputRef.current?.focus()
                inputRef.current?.select()
            })
        }
    }, [editing, day.title])

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
            onRenamed(prev)                 // откат к предыдущему значению
            onError(t('planner.error.rename'))
        }
    }

    const cancel = () => {
        savedRef.current = true
        stopRenaming()
    }

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
            background: expanded ? 'var(--surface)' : 'var(--surface-raised)', borderRadius: 8,
        }}>
            {grip}
            <div style={{ flex: 1, minWidth: 0 }}>
                {editing ? (
                    <input
                        ref={inputRef}
                        aria-label={t('planner.day.nameLabel')}
                        value={value}
                        maxLength={120}
                        placeholder={t('planner.day.default', { position: day.position })}
                        onChange={e => setValue(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        onBlur={commit}
                        onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); commit() }
                            if (e.key === 'Escape') { e.preventDefault(); cancel() }
                        }}
                        style={{
                            width: '100%', fontSize: 13, fontWeight: 'bold', padding: '2px 4px',
                            border: '1px solid var(--accent)', borderRadius: 4,
                            background: 'var(--surface-raised)', color: 'inherit',
                        }} />
                ) : (
                    <button
                        onClick={e => { e.stopPropagation(); if (!readOnly) startRenaming(day.id) }}
                        aria-label={readOnly ? undefined : t('planner.day.rename')}
                        title={readOnly ? undefined : t('planner.day.rename')}
                        style={{
                            background: 'none', border: 'none', padding: 0, font: 'inherit',
                            color: 'inherit', fontSize: 13, fontWeight: 'bold',
                            cursor: readOnly ? 'default' : 'text', textAlign: 'left',
                            maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap', display: 'block',
                        }}>
                        {dayLabel(day, t)}
                    </button>
                )}
                {subtitle}
            </div>
            {/* раскрытие — шеврон (и область строки вне заголовка) */}
            <button onClick={onToggle} aria-expanded={expanded}
                style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', fontSize: 12, padding: '2px 4px',
                    display: 'flex', alignItems: 'center', gap: 4,
                }}>
                {t('day.stopsCount', { count: day.stops.length })} {expanded ? '▲' : '▼'}
            </button>
        </div>
    )
}
