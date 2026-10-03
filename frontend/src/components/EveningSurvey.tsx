import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Stop } from '../types/index'
import { getDays } from '../api/days'
import { getVisitedPlaces, markVisited } from '../api/visited'
import RatingStars from './RatingStars'

// S15: вечерний опрос «как вам день» — in-app вариант (Q21-C: настоящий
// Web Push — отдельная поздняя фаза, нужен деплой/HTTPS).
//
// Триггер (Q23): загрузка/возврат фокуса + локальное время ≥ 20:00 + у последней
// открытой поездки (lastOpenedTripId) есть день с датой «сегодня», в котором
// остались стопы без оценки и не пропущенные сегодня.
// Свайп влево / «Пропустить» = пропуск на сегодня, строка НЕ создаётся (Q22).

const EVENING_HOUR = 20  // хардкод по Q23
const LAST_TRIP_KEY = 'hermod:lastOpenedTripId'

function todayLocal(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const skippedKey = () => `hermod:surveySkipped:${todayLocal()}`

function getSkipped(): Set<string> {
    try {
        return new Set(JSON.parse(localStorage.getItem(skippedKey()) ?? '[]'))
    } catch {
        return new Set()
    }
}

function addSkipped(...stopIds: string[]) {
    const s = getSkipped()
    stopIds.forEach(id => s.add(id))
    // приватный режим Safari бросает на setItem — опрос не должен падать
    try { localStorage.setItem(skippedKey(), JSON.stringify([...s])) } catch { /* без памяти */ }
}

export default function EveningSurvey() {
    const { t } = useTranslation()
    const [queue, setQueue] = useState<Stop[]>([])
    const [rating, setRating] = useState(0)
    const [comment, setComment] = useState('')
    // свайп-жест карточки
    const [dragX, setDragX] = useState(0)
    const [dragging, setDragging] = useState(false)
    const [saveError, setSaveError] = useState(false)
    const dragStart = useRef<number | null>(null)
    const checking = useRef(false)

    const check = useCallback(async () => {
        if (checking.current) return
        if (new Date().getHours() < EVENING_HOUR) return
        const tripId = localStorage.getItem(LAST_TRIP_KEY)
        if (!tripId) return
        checking.current = true
        try {
            const [days, visited] = await Promise.all([getDays(tripId), getVisitedPlaces()])
            const today = days.find(d => d.date === todayLocal())
            if (!today) return
            const visitedIds = new Set(visited.map(v => v.place_id))
            const skipped = getSkipped()
            // QA: «не влезло в день» — места, где юзер не был; их не спрашиваем
            const pending = today.stops.filter(
                s => s.included_in_route !== false
                    && !visitedIds.has(s.place_id) && !skipped.has(s.id),
            )
            setQueue(prev => (prev.length > 0 ? prev : pending))
        } catch {
            // поездка могла быть удалена / сессия истекла — молча не показываем
        } finally {
            checking.current = false
        }
    }, [])

    useEffect(() => {
        // первый опрос — колбэком таймера, как и по focus: это подписка на
        // внешнее состояние (часы, сервер), а не синхронный setState в эффекте
        const first = window.setTimeout(check, 0)
        window.addEventListener('focus', check)
        return () => { window.clearTimeout(first); window.removeEventListener('focus', check) }
    }, [check])

    const current = queue[0] ?? null

    const advance = () => {
        setSaveError(false)
        setQueue(prev => prev.slice(1))
        setRating(0)
        setComment('')
        setDragX(0)
    }

    const skip = () => {
        if (!current) return
        addSkipped(current.id)   // пропуск = только на сегодня, строку не создаём
        advance()
    }

    // QA: опрос — модалка поверх всего приложения, а выйти можно было только
    // пролистав каждое место по одному. «Не сегодня» закрывает всю очередь.
    const dismissAll = () => {
        addSkipped(...queue.map(s => s.id))
        setQueue([])
    }

    useEffect(() => {
        if (!current) return
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismissAll() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    })

    const save = async () => {
        if (!current || rating === 0) return
        setSaveError(false)
        try {
            await markVisited(current.place_id, {
                rating,
                comment: comment.trim() || null,
            })
            advance()
        } catch {
            setSaveError(true)
        }
    }

    // Свайп влево = пропустить. БЕЗ setPointerCapture: захват на карточке
    // перенаправлял бы на неё все последующие pointer-события, и клики по
    // звёздам/кнопкам внутри карточки просто не доходили бы до них.
    const onPointerDown = (e: React.PointerEvent) => {
        // тянем только за «пустое место» карточки, не за контролы
        if ((e.target as HTMLElement).closest('button, textarea, input, select')) return
        const startX = e.clientX
        dragStart.current = startX
        setDragging(true)
        const onMove = (ev: PointerEvent) => setDragX(Math.min(0, ev.clientX - startX))
        const onUp = (ev: PointerEvent) => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            dragStart.current = null
            setDragging(false)
            if (ev.clientX - startX < -80) skip()
            else setDragX(0)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
    }

    if (!current) return null

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            background: 'color-mix(in srgb, var(--text-primary) 45%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
            <div
                onPointerDown={onPointerDown}
                style={{
                    background: 'var(--surface-raised)', borderRadius: 14, padding: 20,
                    maxWidth: 360, width: '100%', touchAction: 'pan-y',
                    transform: `translateX(${dragX}px) rotate(${dragX / 40}deg)`,
                    transition: dragging ? 'none' : 'transform .15s',
                    opacity: 1 + dragX / 300,
                    boxShadow: '0 8px 32px color-mix(in srgb, var(--text-primary) 25%, transparent)',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <strong style={{ fontSize: 15 }}>{t('visited.surveyTitle')}</strong>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {t('visited.surveyLeft', { count: queue.length })}
                        </span>
                        <button onClick={dismissAll} title={t('visited.notToday')} aria-label={t('visited.notToday')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: 0 }}>✕</button>
                    </span>
                </div>
                <p style={{ margin: '0 0 10px', fontSize: 14 }}>
                    {current.place_name || t('common.untitled')}
                </p>

                <RatingStars value={rating} onChange={setRating} size={28} />
                <textarea placeholder={t('visited.commentPlaceholder')} value={comment}
                    onChange={e => setComment(e.target.value)} rows={2} maxLength={2000}
                    style={{
                        width: '100%', boxSizing: 'border-box', marginTop: 8, padding: 6,
                        border: '1px solid var(--border)', borderRadius: 6, fontSize: 13,
                        background: 'var(--surface)', resize: 'vertical', fontFamily: 'inherit',
                    }} />

                <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'space-between' }}>
                    <button onClick={skip} style={{
                        padding: '6px 14px', background: 'none', color: 'var(--text-muted)',
                        border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                    }}>
                        ← {t('visited.skip')}
                    </button>
                    <button onClick={save} disabled={rating === 0} style={{
                        padding: '6px 14px', border: 'none', borderRadius: 6, fontSize: 13,
                        background: 'var(--accent)', color: 'var(--surface)',
                        cursor: rating === 0 ? 'not-allowed' : 'pointer',
                        opacity: rating === 0 ? 0.5 : 1,
                    }}>
                        {t('common.save')}
                    </button>
                </div>
                {saveError && (
                    <p role="alert" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--accent)' }}>{t('common.error')}</p>
                )}
                <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                    {t('visited.swipeHint')}
                </p>
            </div>
        </div>
    )
}
