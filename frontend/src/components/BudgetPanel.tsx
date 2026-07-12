import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
    addExpense, deleteExpense, getBudget, getExpenses, updateTripBudget,
    type Expense,
} from '../api/budget'
import type { TripDay } from '../api/days'

// Вкладка «Бюджет» (S9 WP-A): лимит + прогресс, разбивки, статьи расходов.
// Живое обновление: мутации инвалидируют ['budget', tripId] (TanStack Query).
interface Props {
    tripId: string
    days: TripDay[]
}

const CATEGORIES = ['lodging', 'transport', 'food', 'other'] as const

export default function BudgetPanel({ tripId, days }: Props) {
    const { t, i18n } = useTranslation()
    const queryClient = useQueryClient()
    const [limitInput, setLimitInput] = useState<string | null>(null)
    const [form, setForm] = useState({
        category: 'lodging' as Expense['category'],
        title: '', amount: '', day_id: '',
    })

    const { data: budget } = useQuery({
        queryKey: ['budget', tripId], queryFn: () => getBudget(tripId),
    })
    const { data: expenses } = useQuery({
        queryKey: ['expenses', tripId], queryFn: () => getExpenses(tripId),
    })

    if (!budget) return <div style={{ padding: 16 }}>{t('common.loading')}</div>

    const fmt = (v: string | null) =>
        v === null ? '—' : new Intl.NumberFormat(i18n.language, {
            style: 'currency', currency: budget.currency,
        }).format(parseFloat(v))

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['budget', tripId] })
        queryClient.invalidateQueries({ queryKey: ['expenses', tripId] })
    }

    const saveLimit = async () => {
        await updateTripBudget(tripId, { budget_total: limitInput || null })
        setLimitInput(null)
        invalidate()
    }

    const submitExpense = async () => {
        if (!form.title || !form.amount) return
        await addExpense(tripId, {
            category: form.category, title: form.title,
            amount: form.amount, day_id: form.day_id || null,
        })
        setForm({ category: form.category, title: '', amount: '', day_id: form.day_id })
        invalidate()
    }

    // прогресс-бар в тёплой гамме (S10): сиена, при превышении — глубже.
    // Никакого красно-зелёного светофора.
    const limit = budget.budget_total ? parseFloat(budget.budget_total) : null
    const planned = parseFloat(budget.planned_total)
    const ratio = limit ? Math.min(planned / limit, 1) : 0
    const barColor = budget.over_budget ? 'var(--accent-hover)' : 'var(--accent)'

    const dayLabel = (dayId: string) => {
        const d = days.find(x => x.id === dayId)
        return d ? t('day.dayShort', { num: d.day_index + 1 }) : t('budget.wholeTrip')
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
                            onKeyDown={e => e.key === 'Enter' && saveLimit()}
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
                    <button onClick={async () => { await deleteExpense(tripId, e.id); invalidate() }}
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
                            <option key={d.id} value={d.id}>{t('day.dayShort', { num: d.day_index + 1 })}</option>
                        ))}
                    </select>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <input placeholder={t('budget.expenseTitle')} value={form.title}
                        onChange={e => setForm({ ...form, title: e.target.value })}
                        style={{ flex: 2, padding: 6, border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
                    <input placeholder={t('budget.amount')} value={form.amount} inputMode="decimal"
                        onChange={e => setForm({ ...form, amount: e.target.value })}
                        style={{ flex: 1, padding: 6, border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, minWidth: 60 }} />
                    <button onClick={submitExpense} style={{
                        padding: '6px 12px', background: 'var(--accent)', color: 'var(--surface)',
                        border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                        +
                    </button>
                </div>
            </div>
        </div>
    )
}
