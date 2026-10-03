import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
    addExpense, deleteExpense, getBudget, getExpenses, recomputeEstimates,
    updateTripBudget, type Expense,
} from '../api/budget'
import type { TripDay } from '../api/days'
import { formatMoney } from '../utils/money'
import { dayLabelShort } from '../utils/dayLabel'
import { apiErrorMessage } from '../utils/apiError'
import { MAX_MONEY, MONEY_RE } from '../utils/limits'

// Вкладка «Бюджет» (S9 WP-A): лимит + прогресс, разбивки, статьи расходов.
// Живое обновление: мутации инвалидируют ['budget', tripId] (TanStack Query).
interface Props {
    tripId: string
    days: TripDay[]
    onStopsChanged?: () => void // ТЗ-E: recompute менял суммы стопов — перезагрузить их
}

const CATEGORIES = ['lodging', 'transport', 'food', 'other'] as const

export default function BudgetPanel({ tripId, days, onStopsChanged }: Props) {
    const { t, i18n } = useTranslation()
    const queryClient = useQueryClient()
    const [limitInput, setLimitInput] = useState<string | null>(null)
    const [recomputing, setRecomputing] = useState(false)
    // QA: ошибки мутаций раньше были необработанными промисами — «+» с «12,5»
    // или «abc» в сумме молча ничего не делал
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [form, setForm] = useState({
        category: 'lodging' as Expense['category'],
        title: '', amount: '', day_id: '',
    })

    const { data: budget, error: budgetError, refetch } = useQuery({
        queryKey: ['budget', tripId], queryFn: () => getBudget(tripId),
    })
    const { data: expenses } = useQuery({
        queryKey: ['expenses', tripId], queryFn: () => getExpenses(tripId),
    })

    // QA: упавшая загрузка раньше висела вечным «Загрузка...»
    if (budgetError && !budget) return (
        <div style={{ padding: 16, fontSize: 13 }}>
            <p style={{ color: 'var(--accent)' }}>{apiErrorMessage(budgetError, t, t('trip.loadError'))}</p>
            <button onClick={() => refetch()} style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-raised)' }}>
                ↻ {t('common.retry')}
            </button>
        </div>
    )
    if (!budget) return <div style={{ padding: 16 }}>{t('common.loading')}</div>

    const fmt = (v: string | null) =>
        v === null ? '—' : formatMoney(v, budget.currency, i18n.language)

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['budget', tripId] })
        queryClient.invalidateQueries({ queryKey: ['expenses', tripId] })
    }

    const safely = async (fn: () => Promise<unknown>) => {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
            await fn()
        } catch (e) {
            setError(apiErrorMessage(e, t))
        } finally {
            setBusy(false)
        }
    }

    // «12,5» -> «12.5»; null = невалидно
    const normalizeMoney = (raw: string): string | null => {
        const v = raw.trim().replace(',', '.')
        return MONEY_RE.test(v) && Number(v) <= MAX_MONEY ? v : null
    }

    const saveLimit = () => {
        const raw = (limitInput ?? '').trim()
        const value = raw ? normalizeMoney(raw) : null
        if (raw && value === null) { setError(t('budget.invalidAmount')); return }
        return safely(async () => {
            await updateTripBudget(tripId, { budget_total: value })
            setLimitInput(null)
            invalidate()
        })
    }

    const refreshEstimates = async () => {
        // ТЗ-E: ручной пересчёт авто-оценок (после обновления цен мест)
        setRecomputing(true)
        try {
            await safely(async () => {
                await recomputeEstimates(tripId)
                invalidate()
                onStopsChanged?.()
            })
        } finally {
            setRecomputing(false)
        }
    }

    const submitExpense = () => {
        const title = form.title.trim()
        if (!title || !form.amount.trim()) { setError(t('budget.fillExpense')); return }
        const amount = normalizeMoney(form.amount)
        if (amount === null) { setError(t('budget.invalidAmount')); return }
        return safely(async () => {
            await addExpense(tripId, {
                category: form.category, title,
                amount, day_id: form.day_id || null,
            })
            setForm({ category: form.category, title: '', amount: '', day_id: form.day_id })
            invalidate()
        })
    }

    // прогресс-бар в тёплой гамме (S10): сиена, при превышении — глубже.
    // Никакого красно-зелёного светофора.
    const limit = budget.budget_total ? parseFloat(budget.budget_total) : null
    const planned = parseFloat(budget.planned_total)
    const ratio = limit ? Math.min(planned / limit, 1) : 0
    const barColor = budget.over_budget ? 'var(--accent-hover)' : 'var(--accent)'

    const dayLabel = (dayId: string) => {
        const d = days.find(x => x.id === dayId)
        return d ? dayLabelShort(d, t) : t('budget.wholeTrip')
    }

    const row: React.CSSProperties = {
        display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0',
    }

    return (
        <div style={{ padding: 16 }}>
            {/* Шапка: лимит / запланировано / остаток */}
            <div style={row}>
                <span>{t('budget.limit')}</span>
                {limitInput === null ? (
                    <span onClick={() => setLimitInput(budget.budget_total ?? '')}
                        style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}>
                        {budget.budget_total ? fmt(budget.budget_total) : t('budget.noLimit')}
                    </span>
                ) : (
                    <span style={{ display: 'flex', gap: 4 }}>
                        <input value={limitInput} inputMode="decimal" autoFocus
                            onChange={e => setLimitInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') saveLimit()
                                if (e.key === 'Escape') { setLimitInput(null); setError(null) }
                            }}
                            style={{ width: 90, padding: 2, border: '1px solid var(--border)', borderRadius: 4, fontSize: 13 }} />
                        <button onClick={saveLimit} style={{ border: 'none', background: 'var(--accent)', color: 'var(--surface)', borderRadius: 4, cursor: 'pointer', fontSize: 12, padding: '0 8px' }}>✓</button>
                    </span>
                )}
            </div>
            <div style={row}><span>{t('budget.planned')}</span><strong>{fmt(budget.planned_total)}</strong></div>
            <div style={row}><span>{t('budget.booked')}</span><span>{fmt(budget.booked_total)}</span></div>
            <div style={row}>
                <span>{t('budget.remaining')}</span>
                <strong style={{ color: budget.over_budget ? 'var(--accent-hover)' : 'var(--text-primary)' }}>
                    {fmt(budget.remaining)}
                </strong>
            </div>
            {limit !== null && (
                <div style={{ background: 'var(--surface)', borderRadius: 6, height: 8, margin: '6px 0' }}>
                    <div style={{
                        width: `${ratio * 100}%`, height: '100%',
                        background: barColor, borderRadius: 6, transition: 'width .3s',
                    }} />
                </div>
            )}
            {budget.over_budget && (
                <div style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 'bold' }}>
                    ⚠ {t('budget.overBudget')}
                </div>
            )}

            {error && <p role="alert" style={{ color: 'var(--accent)', fontSize: 12, margin: '6px 0' }}>{error}</p>}

            {/* ТЗ-E: пересчитать авто-оценки из актуальных цен мест */}
            <button onClick={refreshEstimates} disabled={recomputing}
                title={t('budget.approxHint')}
                style={{
                    marginTop: 6, padding: '4px 10px', fontSize: 12,
                    background: 'var(--surface-raised)', color: 'var(--text-primary)',
                    border: '1px solid var(--border)', borderRadius: 6,
                    cursor: recomputing ? 'wait' : 'pointer',
                }}>
                ↻ {t('budget.refreshEstimates')}
            </button>

            {/* Разбивка по категориям */}
            <h4 style={{ margin: '14px 0 6px', fontSize: 13 }}>{t('budget.byCategory')}</h4>
            {Object.entries(budget.per_category).filter(([, v]) => parseFloat(v) > 0).map(([cat, v]) => (
                <div key={cat} style={row}>
                    <span>{t(`budget.category_${cat}`)}</span><span>{fmt(v)}</span>
                </div>
            ))}

            {/* Разбивка по дням */}
            {Object.keys(budget.per_day).length > 0 && (
                <>
                    <h4 style={{ margin: '14px 0 6px', fontSize: 13 }}>{t('budget.byDay')}</h4>
                    {Object.entries(budget.per_day).map(([dayId, v]) => (
                        <div key={dayId} style={row}>
                            <span>{dayId === 'unassigned' ? t('budget.wholeTrip') : dayLabel(dayId)}</span>
                            <span>{fmt(v)}</span>
                        </div>
                    ))}
                </>
            )}

            {/* Статьи расходов */}
            <h4 style={{ margin: '14px 0 6px', fontSize: 13 }}>{t('budget.expenses')}</h4>
            {(expenses ?? []).map(e => (
                <div key={e.id} style={{ ...row, alignItems: 'center' }}>
                    <span style={{ flex: 1 }}>
                        {t(`budget.category_${e.category}`)} · {e.title}
                        {e.day_id && <span style={{ color: 'var(--text-muted)' }}> ({dayLabel(e.day_id)})</span>}
                    </span>
                    <span>{fmt(e.amount)}</span>
                    <button onClick={() => safely(async () => { await deleteExpense(tripId, e.id); invalidate() })}
                        disabled={busy} title={t('common.delete')}
                        style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 4 }}>✕</button>
                </div>
            ))}

            {/* Добавление статьи */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                    <select value={form.category}
                        onChange={e => setForm({ ...form, category: e.target.value as Expense['category'] })}
                        style={{ flex: 1, padding: 4, border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--surface-raised)' }}>
                        {CATEGORIES.map(c => <option key={c} value={c}>{t(`budget.category_${c}`)}</option>)}
                    </select>
                    <select value={form.day_id}
                        onChange={e => setForm({ ...form, day_id: e.target.value })}
                        style={{ flex: 1, padding: 4, border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--surface-raised)' }}>
                        <option value="">{t('budget.wholeTrip')}</option>
                        {days.map(d => (
                            <option key={d.id} value={d.id}>{dayLabelShort(d, t)}</option>
                        ))}
                    </select>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <input placeholder={t('budget.expenseTitle')} value={form.title} maxLength={200}
                        onChange={e => setForm({ ...form, title: e.target.value })}
                        onKeyDown={e => e.key === 'Enter' && submitExpense()}
                        style={{ flex: 2, padding: 6, border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
                    <input placeholder={t('budget.amount')} value={form.amount} inputMode="decimal"
                        onChange={e => setForm({ ...form, amount: e.target.value })}
                        onKeyDown={e => e.key === 'Enter' && submitExpense()}
                        style={{ flex: 1, padding: 6, border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, minWidth: 60 }} />
                    <button onClick={submitExpense} disabled={busy} style={{
                        padding: '6px 12px', background: 'var(--accent)', color: 'var(--surface)',
                        border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                        +
                    </button>
                </div>
            </div>
        </div>
    )
}
