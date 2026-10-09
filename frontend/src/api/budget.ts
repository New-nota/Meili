import { apiFetch } from "./client"

// Бюджет (S9 WP-A)
export interface BudgetSummary {
    budget_total: string | null
    currency: string
    activities_total: string
    expenses_total: string
    planned_total: string
    booked_total: string
    remaining: string | null
    over_budget: boolean
    per_day: Record<string, string>
    per_category: Record<string, string>
}

export interface Expense {
    id: string
    day_id: string | null
    category: 'lodging' | 'transport' | 'food' | 'other'
    title: string
    amount: string
    currency: string
    is_estimate?: boolean   // оценка (проживание «от» по 2ГИС) — рисуем «≈»
    created_at: string
}

export const getBudget = (tripId: string) =>
    apiFetch<BudgetSummary>(`/trips/${tripId}/budget`)

export const getExpenses = (tripId: string) =>
    apiFetch<Expense[]>(`/trips/${tripId}/expenses`)

export const addExpense = (tripId: string, data: {
    category: Expense['category']; title: string; amount: string; day_id?: string | null
}) => apiFetch<Expense>(`/trips/${tripId}/expenses`, {
    method: 'POST', body: JSON.stringify(data),
})

export const deleteExpense = (tripId: string, expenseId: string) =>
    apiFetch<void>(`/trips/${tripId}/expenses/${expenseId}`, { method: 'DELETE' })

export const updateTripBudget = (tripId: string, data: {
    budget_total?: string | null; currency?: string
}) => apiFetch(`/trips/${tripId}`, { method: 'PATCH', body: JSON.stringify(data) })

// ТЗ-E: ручной пересчёт авто-оценок стопов (после ре-сида цен мест)
export const recomputeEstimates = (tripId: string) =>
    apiFetch<{ updated: number }>(`/trips/${tripId}/recompute-estimates`, { method: 'POST' })
