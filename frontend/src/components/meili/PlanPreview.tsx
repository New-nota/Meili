import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiErrorMessage } from '../../utils/apiError'
import {
    applyPlan, discardPlan, type PlanAction, type PlanEvent,
} from '../../api/meili'
import { apiFetch } from '../../api/client'
import { costText, planTotal } from '../../utils/planCost'
import { formatMoney } from '../../utils/money'

// Карточка превью плана Meili (ТЗ-Meili M3.4):
// [ ✕ закрыть | ✎ изменить руками | ✔ применить ]
// «Применить» — единственная кнопка, ведущая к записи в БД (M4).
interface Props {
    plan: PlanEvent
    onDiscarded: () => void
    onEdit: () => void
    onApplied: (tripId: string | null) => void
}

const ICONS: Record<string, string> = {
    create_trip: '🧳', add_stop: '📍', remove_stop: '✂️',
    set_budget: '💰', set_stop_cost: '💶', optimize: '🧭',
}

export default function PlanPreview({ plan, onDiscarded, onEdit, onApplied }: Props) {
    const { t, i18n } = useTranslation()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [placeNames, setPlaceNames] = useState<Record<string, string>>({})

    // имена мест для add_stop: в плане только place_id; грузим параллельно,
    // рендерим одним setState (не по перерисовке на каждый ответ)
    useEffect(() => {
        const ids = [...new Set(
            plan.plan_json.actions
                .filter(a => a.type === 'add_stop' && a.place_id)
                .map(a => a.place_id as string),
        )]
        if (ids.length === 0) return
        Promise.all(ids.map(id =>
            apiFetch<{ name: string }>(`/places/${id}`)
                .then(p => [id, p.name] as const)
                .catch(() => null),
        )).then(pairs => {
            setPlaceNames(Object.fromEntries(pairs.filter((x): x is readonly [string, string] => x !== null)))
        })
    }, [plan.plan_id]) // eslint-disable-line react-hooks/exhaustive-deps

    const actionLine = (a: PlanAction): string => {
        switch (a.type) {
            case 'create_trip':
                return t('meili.actionCreateTrip', { title: a.title as string })
            case 'add_stop': {
                const name = placeNames[a.place_id as string] ?? '…'
                const day = a.day_index != null
                    ? ` (${t('day.dayShort', { num: (a.day_index as number) + 1 })})` : ''
                return t('meili.actionAddStop', { name }) + day
            }
            // QA: после заморозки система кладёт в план название стопа
            case 'remove_stop': return a.stop_name
                ? `${t('meili.actionRemoveStop')}: ${a.stop_name as string}` : t('meili.actionRemoveStop')
            case 'set_budget':
                return t('meili.actionSetBudget',
                    { amount: a.amount as string, currency: a.currency as string })
            case 'set_stop_cost': return a.stop_name
                ? `${t('meili.actionSetStopCost')}: ${a.stop_name as string}` : t('meili.actionSetStopCost')
            case 'optimize': return t('meili.actionOptimize')
            default: return a.type
        }
    }

    const handleApply = async () => {
        // анти-дабл-клик (M4.5): кнопка гаснет на время запроса
        if (busy) return
        setBusy(true)
        setError(null)
        try {
            const result = await applyPlan(plan.plan_id)
            onApplied(result.trip_id)
        } catch (e) {
            // QA: машинный код executor'а (place_out_of_coverage, plan_discarded,
            // currency_mismatch…) раньше терялся за безликим «не удалось»
            setError(apiErrorMessage(e, t, t('meili.applyError')))
        } finally {
            setBusy(false)
        }
    }

    const handleDiscard = async () => {
        try { await discardPlan(plan.plan_id) } catch { /* уже неактуален */ }
        onDiscarded()
    }

    // строки и итог считаются один раз на план, не на каждый рендер/строку
    const rows = useMemo(
        () => plan.plan_json.actions.map(a => ({ a, cost: costText(a, i18n.language) })),
        [plan.plan_id, i18n.language], // eslint-disable-line react-hooks/exhaustive-deps
    )
    const total = useMemo(() => planTotal(rows), [rows])

    return (
        <div style={{
            border: '1px solid var(--accent)', borderRadius: 10, padding: 10,
            margin: '8px 0', background: 'var(--surface)',
        }}>
            <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 6 }}>
                {plan.plan_json.summary}
            </div>
            {rows.map(({ a, cost }, i) => (
                <div key={i} style={{ fontSize: 13, padding: '2px 0', display: 'flex', gap: 6 }}>
                    <span>{ICONS[a.type] ?? '•'}</span>
                    <span style={{ flex: 1 }}>{actionLine(a)}</span>
                    {cost && (
                        <span style={{
                            fontVariantNumeric: 'tabular-nums',
                            color: cost.estimate ? 'var(--text-muted)' : 'var(--text-primary)',
                        }}>
                            {cost.text}
                        </span>
                    )}
                </div>
            ))}
            {total && (
                <div style={{
                    fontSize: 12, marginTop: 6, paddingTop: 6,
                    borderTop: '1px dashed var(--border)',
                    color: total.hasEstimate ? 'var(--text-muted)' : 'var(--text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                }}>
                    {t('meili.planTotal')}: {total.hasEstimate ? '≈ ' : ''}
                    {total.min === total.max
                        ? formatMoney(total.min, total.currency, i18n.language)
                        : `${formatMoney(total.min, total.currency, i18n.language)}–${formatMoney(total.max, total.currency, i18n.language)}`}
                    {total.hasEstimate && ` · ${t('meili.containsEstimates')}`}
                </div>
            )}
            {error && <p style={{ color: 'var(--accent)', fontSize: 12, margin: '6px 0 0' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onClick={handleDiscard} disabled={busy} style={{
                    padding: '6px 10px', background: 'none', color: 'var(--text-muted)',
                    border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                }}>
                    ✕ {t('meili.closeBtn')}
                </button>
                <button onClick={onEdit} disabled={busy} style={{
                    padding: '6px 10px', background: 'var(--surface-raised)', color: 'var(--text-primary)',
                    border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                }}>
                    ✎ {t('meili.editBtn')}
                </button>
                <button onClick={handleApply} disabled={busy} style={{
                    flex: 1, padding: '6px 10px', background: 'var(--accent)', color: 'var(--surface)',
                    border: 'none', borderRadius: 6, fontSize: 12,
                    cursor: busy ? 'wait' : 'pointer', fontWeight: 'bold',
                }}>
                    ✔ {busy ? '…' : t('meili.applyBtn')}
                </button>
            </div>
        </div>
    )
}
