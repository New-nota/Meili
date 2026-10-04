import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check, CircleAlert, Pencil, Plus, RefreshCw, X } from 'lucide-react'
import {
    addExpense, deleteExpense, getBudget, getExpenses, recomputeEstimates,
    updateTripBudget, type Expense,
} from '../api/budget'
import type { TripDay } from '../api/days'
import { formatMoney } from '../utils/money'
import { dayCost } from '../utils/daySchedule'
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
        <div style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
            <p className="error-text" role="alert">{apiErrorMessage(budgetError, t, t('trip.loadError'))}</p>
            <button type="button" onClick={() => refetch()} className="btn btn-sm"><RefreshCw />{t('common.retry')}</button>
        </div>
    )
    if (!budget) return <p style={{ color: 'var(--ink-3)' }}>{t('common.loading')}</p>

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

    // прогресс: мох; перерасход — брусника (одно состояние «плохо», без светофора)
    const limit = budget.budget_total ? parseFloat(budget.budget_total) : null
    const planned = parseFloat(budget.planned_total)
    const ratio = limit ? Math.min(planned / limit, 1) : 0
    const barColor = budget.over_budget ? 'var(--danger)' : 'var(--moss)'
    // null-цена — «нет данных», не 0: пока ничего не оценено, «0,00 ₽
    // запланировано» и «остаток = весь лимит» врут
    const stopsCost = dayCost(days.flatMap(d => d.stops))
    const expensesSum = (expenses ?? []).reduce((acc, e) => acc + parseFloat(e.amount), 0)
    const unknown = planned === 0 && stopsCost.priced === 0 && expensesSum === 0

    const dayLabel = (dayId: string) => {
        const d = days.find(x => x.id === dayId)
        return d ? dayLabelShort(d, t) : t('budget.wholeTrip')
    }

    const row: React.CSSProperties = {
        display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14.5, padding: '6px 0',
    }
    const section: React.CSSProperties = { marginTop: 22 }
    const h: React.CSSProperties = { fontSize: 16, fontWeight: 700, marginBottom: 6 }

    return (
        <div>
            {/* Шапка: запланировано из лимита + прогресс */}
            <div style={{ fontSize: 14, color: 'var(--ink-2)' }}>{t('budget.planned')}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                <b style={{ fontSize: 30, fontWeight: 750, letterSpacing: '-0.02em', color: budget.over_budget ? 'var(--danger)' : 'var(--ink)' }}>
                    {unknown ? '—' : fmt(budget.planned_total)}
                </b>
                {limitInput === null ? (
                    <button type="button" className="inline-edit" style={{ fontSize: 15, color: 'var(--ink-2)' }}
                        onClick={() => setLimitInput(budget.budget_total ?? '')} title={t('budget.limit')}>
                        {budget.budget_total ? `${t('budget.of')} ${fmt(budget.budget_total)}` : t('budget.noLimit')}
                        <Pencil size={14} style={{ marginLeft: 6, verticalAlign: '-2px', color: 'var(--ink-3)' }} />
                    </button>
                ) : (
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input value={limitInput} inputMode="decimal" autoFocus className="input input-sm"
                            aria-label={t('budget.limit')} placeholder={t('budget.limit')}
                            onChange={e => setLimitInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') saveLimit()
                                if (e.key === 'Escape') { setLimitInput(null); setError(null) }
                            }}
                            style={{ width: 120 }} />
                        <button type="button" onClick={saveLimit} className="icon-btn sm filled" aria-label={t('common.save')}><Check /></button>
                    </span>
                )}
            </div>
            {(unknown || stopsCost.missing > 0) && (
                <p style={{ fontSize: 14, color: 'var(--ink-3)', marginTop: 2 }}>
                    {unknown ? t('planner.noPrices') : t('planner.withoutPrice', { count: stopsCost.missing })}
                </p>
            )}
            {limit !== null && !unknown && (
                <div style={{ background: 'var(--birch)', borderRadius: 999, height: 10, margin: '12px 0 4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: barColor, transform: `scaleX(${ratio})`, transformOrigin: 'left', transition: 'transform .3s ease-out' }} />
                </div>
            )}
            {budget.over_budget && (
                <p role="alert" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--danger)', fontSize: 14, fontWeight: 650, marginTop: 6 }}>
                    <CircleAlert size={16} />{t('budget.overBudget')}
                </p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
                {[[t('budget.booked'), fmt(budget.booked_total), false], [t('budget.remaining'), unknown ? '—' : fmt(budget.remaining), budget.over_budget]].map(([k, v, bad]) => (
                    <div key={String(k)} style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', padding: '10px 14px' }}>
                        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{k}</div>
                        <div style={{ fontSize: 17, fontWeight: 700, color: bad ? 'var(--danger)' : 'var(--ink)' }}>{v}</div>
                    </div>
                ))}
            </div>

            {error && <p role="alert" className="error-text" style={{ marginTop: 10 }}>{error}</p>}

            {/* ТЗ-E: пересчитать авто-оценки из актуальных цен мест */}
            <button type="button" onClick={refreshEstimates} disabled={recomputing} title={t('budget.approxHint')}
                className="btn btn-sm btn-ghost" style={{ marginTop: 8, marginLeft: -12 }}>
                <RefreshCw className={recomputing ? 'spin' : undefined} />{t('budget.refreshEstimates')}
            </button>

            {/* Разбивка по категориям */}
            <div style={section}>
                <h3 style={h}>{t('budget.byCategory')}</h3>
                {Object.entries(budget.per_category).filter(([, v]) => parseFloat(v) > 0).map(([cat, v]) => (
                    <div key={cat} style={{ ...row, borderBottom: '1px solid var(--line)' }}>
                        <span>{t(`budget.category_${cat}`)}</span><span style={{ fontWeight: 600 }}>{fmt(v)}</span>
                    </div>
                ))}
                {!Object.values(budget.per_category).some(v => parseFloat(v) > 0) && (
                    <p style={{ fontSize: 14, color: 'var(--ink-3)' }}>{t('budget.nothingYet')}</p>
                )}
            </div>

            {/* Разбивка по дням */}
            {Object.keys(budget.per_day).length > 0 && (
                <div style={section}>
                    <h3 style={h}>{t('budget.byDay')}</h3>
                    {Object.entries(budget.per_day).map(([dayId, v]) => (
                        <div key={dayId} style={{ ...row, borderBottom: '1px solid var(--line)' }}>
                            <span>{dayId === 'unassigned' ? t('budget.wholeTrip') : dayLabel(dayId)}</span>
                            <span style={{ fontWeight: 600 }}>{fmt(v)}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Статьи расходов */}
            <div style={section}>
                <h3 style={h}>{t('budget.expenses')}</h3>
                {(expenses ?? []).map(e => (
                    <div key={e.id} style={{ ...row, alignItems: 'center', borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                            <span>{t(`budget.category_${e.category}`)} · {e.title}</span>
                            {e.day_id && <span style={{ color: 'var(--ink-3)' }}> · {dayLabel(e.day_id)}</span>}
                        </span>
                        <span style={{ fontWeight: 600 }}>{fmt(e.amount)}</span>
                        <button type="button" onClick={() => safely(async () => { await deleteExpense(tripId, e.id); invalidate() })}
                            disabled={busy} title={t('common.delete')} aria-label={t('common.delete')} className="icon-btn sm">
                            <X />
                        </button>
                    </div>
                ))}

                {/* Добавление статьи */}
                <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <select value={form.category} className="select input-sm" aria-label={t('budget.category')}
                            onChange={e => setForm({ ...form, category: e.target.value as Expense['category'] })}>
                            {CATEGORIES.map(c => <option key={c} value={c}>{t(`budget.category_${c}`)}</option>)}
                        </select>
                        <select value={form.day_id} className="select input-sm" aria-label={t('budget.day')}
                            onChange={e => setForm({ ...form, day_id: e.target.value })}>
                            <option value="">{t('budget.wholeTrip')}</option>
                            {days.map(d => (
                                <option key={d.id} value={d.id}>{dayLabelShort(d, t)}</option>
                            ))}
                        </select>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input placeholder={t('budget.expenseTitle')} value={form.title} maxLength={200} className="input input-sm"
                            aria-label={t('budget.expenseTitle')}
                            onChange={e => setForm({ ...form, title: e.target.value })}
                            onKeyDown={e => e.key === 'Enter' && submitExpense()}
                            style={{ flex: 2 }} />
                        <input placeholder={t('budget.amount')} value={form.amount} inputMode="decimal" className="input input-sm"
                            aria-label={t('budget.amount')}
                            onChange={e => setForm({ ...form, amount: e.target.value })}
                            onKeyDown={e => e.key === 'Enter' && submitExpense()}
                            style={{ flex: 1, minWidth: 70 }} />
                        <button type="button" onClick={submitExpense} disabled={busy} className="btn btn-sm btn-accent" aria-label={t('budget.addExpense')} title={t('budget.addExpense')}>
                            <Plus />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
