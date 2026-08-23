import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
            onChange={e => patchAction(idx, { [field]: e.target.value || null })}
            style={{
                width: 70, padding: 2, border: '1px solid var(--border)',
                borderRadius: 4, fontSize: 12,
            }} />
    )

    return (
        <div style={{
            border: '1px dashed var(--accent)', borderRadius: 10, padding: 10,
            margin: '8px 0', background: 'var(--surface)',
        }}>
            <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 6 }}>
                ✎ {t('meili.editorTitle')}
            </div>
            {actions.map((a, i) => (
                <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 0',
                }}>
                    <span style={{ flex: 1 }}>{t(`meili.actionType_${a.type}`)}</span>

                    {/* сменить день у add_stop */}
                    {a.type === 'add_stop' && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            {t('meili.dayLabel')}
                            <input
                                type="number" min={1}
                                value={a.day_index != null ? (a.day_index as number) + 1 : ''}
                                onChange={e => patchAction(i, {
                                    day_index: e.target.value ? parseInt(e.target.value) - 1 : null,
                                })}
                                style={{
                                    width: 44, padding: 2, border: '1px solid var(--border)',
                                    borderRadius: 4, fontSize: 12,
                                }} />
                        </label>
                    )}

                    {/* изменить число: бюджет / стоимость */}
                    {a.type === 'set_budget' && numberInput(a, i, 'amount')}
                    {a.type === 'set_stop_cost' && numberInput(a, i, 'amount')}
                    {a.type === 'add_stop' && a.cost_amount != null && numberInput(a, i, 'cost_amount')}

                    <button onClick={() => removeAction(i)} title={t('common.delete')} style={{
                        border: 'none', background: 'none', color: 'var(--text-muted)',
                        cursor: 'pointer', fontSize: 13,
                    }}>✕</button>
                </div>
            ))}
            {actions.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('meili.editorEmpty')}</p>
            )}
            {error && <p style={{ color: 'var(--accent)', fontSize: 12 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onClick={onCancel} disabled={busy} style={{
                    padding: '6px 10px', background: 'none', color: 'var(--text-muted)',
                    border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                }}>
                    {t('common.cancel')}
                </button>
                <button onClick={save} disabled={busy || actions.length === 0} style={{
                    flex: 1, padding: '6px 10px', background: 'var(--accent)', color: 'var(--surface)',
                    border: 'none', borderRadius: 6, fontSize: 12, cursor: busy ? 'wait' : 'pointer',
                }}>
                    {t('common.save')}
                </button>
            </div>
        </div>
    )
}
