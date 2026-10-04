import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createConversation, getMeiliMessages, streamMessage, type TripDraft } from '../../api/meili'
import { useMeiliStore } from '../../store/meiliStore'
import { renderChatText } from '../../utils/chatText'
import { CircleAlert, LoaderCircle, SendHorizontal } from 'lucide-react'
import Logo from '../Logo'
import PlanPreview from './PlanPreview'
import PlanEditor from './PlanEditor'

// Чат с ассистентом Meili (ТЗ-Meili M1.6): список сообщений + ввод,
// токены дописываются в реальном времени через SSE.
interface Props {
    tripId?: string | null
    // M4: план применён; S17: id созданной поездки — чтобы открыть её сразу
    onApplied?: (appliedTripId: string | null) => void
    initialInput?: string   // S17: заготовка первого сообщения (не отправляется)
    // S17: черновик мастера — уходит в диалог фактами, а не пересказом
    draft?: TripDraft | null
}

export default function MeiliChat({ tripId, onApplied, initialInput, draft }: Props) {
    const { t } = useTranslation()
    const {
        conversationId, tripId: boundTripId, messages, streaming, stepLabel, plan,
        setConversation, startTurn, appendToken, setStep, setPlan, finishTurn, failTurn, reset,
    } = useMeiliStore()
    const [input, setInput] = useState(initialInput ?? '')
    const [editing, setEditing] = useState(false)
    const bottomRef = useRef<HTMLDivElement>(null)
    // создание в полёте: ключ цели + сам промис. Ключ строкой, потому что
    // null — валидная цель («поездки ещё нет»), и «пустой» ref её не путает
    const pending = useRef<{ key: string; promise: Promise<string | null> } | null>(null)

    // диалог создаётся лениво; стор глобальный, поэтому при смене поездки
    // чат обязан пересоздаться — иначе план уедет в прошлую поездку
    const ensureConversation = (): Promise<string | null> => {
        const target = tripId ?? null
        const key = target ?? 'no-trip'
        const state = useMeiliStore.getState()
        if (state.conversationId && state.tripId === target) {
            return Promise.resolve(state.conversationId)
        }
        if (pending.current?.key === key) return pending.current.promise  // уже создаём
        if (state.conversationId) reset()
        const promise = createConversation(target, draft)
            .then(async c => {
                setConversation(c.id, await getMeiliMessages(c.id), target)
                return c.id
            })
            .catch(() => { failTurn(t('meili.connectError')); return null })
            .finally(() => { if (pending.current?.key === key) pending.current = null })
        pending.current = { key, promise }
        return promise
    }

    useEffect(() => {
        void ensureConversation()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversationId, boundTripId, tripId])

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, stepLabel])

    const send = async () => {
        const text = input.trim()
        if (!text || streaming) return
        // диалога может ещё не быть (или он в полёте) — дожидаемся, а не молчим
        const cid = await ensureConversation()
        if (!cid) return  // ошибку уже показал failTurn
        setInput('')
        startTurn(text)
        try {
            await streamMessage(cid, text, {
                onToken: appendToken,
                onStep: label => setStep(label),
                onPlan: plan => setPlan(plan),
                onDone: finishTurn,
                // ревью: сбои провайдера отличимы — «подождите минуту»
                // полезнее, чем безликое «ассистент недоступен»
                onError: detail => failTurn(t(({
                    http_501: 'meili.notConfigured',
                    rate_limited: 'meili.rateLimited',
                    provider_error: 'meili.providerError',
                    provider_auth: 'meili.providerAuth',
                    // QA: новые отказы ручки — понятным текстом
                    http_409: 'meili.turnInProgress',
                    http_429: 'meili.rateLimited',
                    http_422: 'meili.messageInvalid',
                    timeout: 'meili.timeout',
                } as Record<string, string>)[detail] ?? 'meili.error')),
            })
        } catch {
            failTurn(t('meili.error'))
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px 20px 18px' }}>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 6 }}>
                {messages.length === 0 && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '4px 0' }}>
                        <span style={{ flexShrink: 0, display: 'flex', marginTop: 2 }}><Logo size={22} /></span>
                        <div>
                            <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.5 }}>{t('meili.intro')}</p>
                            {/* в открытой поездке — готовые вопросы: заполняют поле, но не отправляют */}
                            {tripId && !input && (
                                <div style={{ marginTop: 14 }}>
                                    <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 8 }}>{t('meili.startersLabel')}</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                        {(['starter1', 'starter2', 'starter3'] as const).map(k => (
                                            <button key={k} type="button" className="chip" onClick={() => setInput(t(`meili.${k}`))}
                                                style={{ height: 'auto', minHeight: 34, padding: '7px 14px', textAlign: 'left', fontWeight: 500 }}>
                                                {t(`meili.${k}`)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                {messages.map(m => (
                    <div key={m.id} style={{
                        alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '88%',
                        display: 'flex', alignItems: 'flex-end', gap: 8,
                    }}>
                        {/* знак-M — аватар ассистента Meili (ТЗ-rename, шаг 4) */}
                        {m.role === 'assistant' && (
                            <span style={{ flexShrink: 0, display: 'flex', marginBottom: 4 }} title="Meili">
                                <Logo size={20} />
                            </span>
                        )}
                        <div role={m.error ? 'alert' : undefined} style={{
                            display: m.error ? 'flex' : undefined, gap: 8, alignItems: 'flex-start',
                            background: m.role === 'user' ? 'var(--moss)' : m.error ? 'var(--danger-wash)' : 'var(--surface)',
                            color: m.role === 'user' ? 'var(--raised)' : m.error ? 'var(--danger)' : 'var(--ink)',
                            borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                            padding: '9px 13px', fontSize: 14.5, lineHeight: 1.45,
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                            {/* ревью: модель отвечает markdown'ом — разбираем
                                ** и заголовки узлами, не печатаем звёздочками */}
                            {m.error && <CircleAlert size={17} style={{ flexShrink: 0, marginTop: 2 }} />}
                            {m.content
                                ? (m.role === 'assistant' && !m.error ? renderChatText(m.content) : m.content)
                                : (streaming ? '…' : '')}
                        </div>
                    </div>
                ))}
                {stepLabel && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: 'var(--ink-3)', marginLeft: 28 }}>
                        <LoaderCircle size={15} className="spin" />{stepLabel}
                    </div>
                )}

                {/* карточка плана (M3.4) / виртуальный редактор (M3.5) */}
                {plan && !editing && (
                    <PlanPreview
                        plan={plan}
                        onDiscarded={() => setPlan(null)}
                        onEdit={() => setEditing(true)}
                        onApplied={appliedTripId => {
                            setPlan(null)
                            onApplied?.(appliedTripId)
                        }}
                    />
                )}
                {plan && editing && (
                    <PlanEditor
                        plan={plan}
                        onSaved={fresh => { setPlan(fresh); setEditing(false) }}
                        onCancel={() => setEditing(false)}
                    />
                )}
                <div ref={bottomRef} />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input
                    className="input"
                    value={input}
                    maxLength={4000}
                    placeholder={t('meili.placeholder')}
                    aria-label={t('meili.placeholder')}
                    disabled={streaming}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && send()} />
                <button type="button" onClick={send} disabled={streaming || !input.trim()}
                    className="btn btn-accent" aria-label={t('meili.send')} title={t('meili.send')}
                    style={{ width: 48, padding: 0, flexShrink: 0, cursor: streaming ? 'wait' : undefined }}>
                    {streaming ? <LoaderCircle className="spin" /> : <SendHorizontal />}
                </button>
            </div>
        </div>
    )
}
