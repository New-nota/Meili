import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, X } from 'lucide-react'
import { refreezePlan, type PlanAction, type PlanEvent } from '../../api/meili'

// Виртуальный редактор плана (ТЗ-Meili M3.5): правки НЕ трогают БД поездки —
// они формируют новый замороженный план (refreeze -> новый plan_id, старый
// discarded). Финал всё равно «Применить» из карточки превью.
interface Props {
    plan: PlanEvent
    onSaved: (plan: PlanEvent) => void
    onCancel: () => void
}

export default function PlanEditor({ plan, onSaved, onCancel }: Props) {
    const { t } = useTranslation()
    const [actions, setActions] = useState<PlanAction[]>(plan.plan_json.actions)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const removeAction = (idx: number) =>
        setActions(prev => prev.filter((_, i) => i !== idx))

    const patchAction = (idx: number, patch: Record<string, unknown>) =>
        setActions(prev => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)))

    const save = async () => {
        if (actions.length === 0) return
        setBusy(true)
        setError(null)
        try {
            const fresh = await refreezePlan(plan.plan_id, {
                actions, summary: plan.plan_json.summary,
            })
            onSaved({ plan_id: fresh.id, plan_json: fresh.plan_json })
        } catch {
            setError(t('meili.editError'))
        } finally {
            setBusy(false)
        }
    }

    const numberInput = (a: PlanAction, idx: number, field: string) => (
        <input
            value={(a[field] as string) ?? ''}
            inputMode="decimal"
            aria-label={t('budget.amount')}
            className="input input-sm"
            onChange={e => patchAction(idx, { [field]: e.target.value || null })}
            style={{ width: 96, height: 32 }} />
    )

    return (
        <div style={{
            border: '1.5px dashed var(--birch-2)', borderRadius: 'var(--radius-lg)', padding: 14,
            margin: '6px 0', background: 'var(--raised)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
                <Pencil size={16} style={{ color: 'var(--moss)' }} />{t('meili.editorTitle')}
            </div>
            {actions.map((a, i) => (
                <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, padding: '4px 0',
                }}>
                    <span style={{ flex: 1 }}>{t(`meili.actionType_${a.type}`)}</span>

                    {/* сменить день у add_stop */}
                    {a.type === 'add_stop' && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-2)' }}>
                            {t('meili.dayLabel')}
                            <input
                                type="number" min={1} className="input input-sm"
                                value={a.day_index != null ? (a.day_index as number) + 1 : ''}
                                onChange={e => patchAction(i, {
                                    day_index: e.target.value ? parseInt(e.target.value) - 1 : null,
                                })}
                                style={{ width: 64, height: 32 }} />
                        </label>
                    )}

                    {/* изменить число: бюджет / стоимость */}
                    {a.type === 'set_budget' && numberInput(a, i, 'amount')}
                    {a.type === 'set_stop_cost' && numberInput(a, i, 'amount')}
                    {a.type === 'add_stop' && a.cost_amount != null && numberInput(a, i, 'cost_amount')}

                    <button type="button" onClick={() => removeAction(i)} title={t('common.delete')}
                        aria-label={t('common.delete')} className="icon-btn sm">
                        <X />
                    </button>
                </div>
            ))}
            {actions.length === 0 && (
                <p style={{ fontSize: 14, color: 'var(--ink-3)' }}>{t('meili.editorEmpty')}</p>
            )}
            {error && <p className="error-text" role="alert">{error}</p>}
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button type="button" onClick={onCancel} disabled={busy} className="btn btn-sm btn-ghost">
                    {t('common.cancel')}
                </button>
                <button type="button" onClick={save} disabled={busy || actions.length === 0} className="btn btn-sm btn-primary"
                    style={{ flex: 1, cursor: busy ? 'wait' : undefined }}>
                    {t('common.save')}
                </button>
            </div>
        </div>
    )
}
