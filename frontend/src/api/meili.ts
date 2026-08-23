import { apiFetch, API_URL, getAccessToken } from './client'

// AI-ассистент Meili (ТЗ-Meili M1.6): диалоги + SSE-стриминг

export interface Conversation {
    id: string
    trip_id: string | null
    title: string | null
    created_at: string
    updated_at: string
}

export interface MeiliMessage {
    id: string
    role: 'user' | 'assistant'
    content: string
    created_at: string
}

// План появляется в M3; тип объявлен здесь, чтобы SSE-клиент был полным
export interface PlanAction {
    type: 'create_trip' | 'add_stop' | 'remove_stop' | 'set_budget' | 'set_stop_cost' | 'optimize'
    [key: string]: unknown
}

export interface ProposedPlan {
    actions: PlanAction[]
    summary: string
}

export interface PlanEvent {
    plan_id: string
    plan_json: ProposedPlan
}

export interface PlanRead {
    id: string
    conversation_id: string
    plan_json: ProposedPlan
    status: 'proposed' | 'applied' | 'discarded'
    created_at: string
    applied_at: string | null
}

// M4: результат «Применить»
export interface ApplyResult {
    plan_id: string
    status: string
    trip_id: string | null
}

export const discardPlan = (planId: string) =>
    apiFetch<PlanRead>(`/api/meili/plans/${planId}/discard`, { method: 'POST' })

// M3.5: правки формируют новый замороженный план, старый — discarded
export const refreezePlan = (planId: string, plan: ProposedPlan) =>
    apiFetch<PlanRead>(`/api/meili/plans/${planId}/refreeze`, {
        method: 'POST', body: JSON.stringify(plan),
    })

// M4: единственная точка записи в поездку
export const applyPlan = (planId: string) =>
    apiFetch<ApplyResult>(`/api/meili/plans/${planId}/apply`, { method: 'POST' })

export const createConversation = (tripId?: string | null) =>
    apiFetch<Conversation>(
        `/api/meili/conversations${tripId ? `?trip_id=${tripId}` : ''}`,
        { method: 'POST' },
    )

export const getMeiliMessages = (conversationId: string) =>
    apiFetch<MeiliMessage[]>(`/api/meili/conversations/${conversationId}/messages`)

export interface StreamHandlers {
    onToken: (text: string) => void
    onStep?: (label: string) => void
    onPlan?: (plan: PlanEvent) => void
    onDone: () => void
    onError: (detail: string) => void
}

// SSE через fetch + ReadableStream: токены дописываются в реальном времени
export async function streamMessage(
    conversationId: string, content: string, handlers: StreamHandlers,
): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = getAccessToken()
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${API_URL}/api/meili/conversations/${conversationId}/messages`, {
        method: 'POST', headers, credentials: 'include',
        body: JSON.stringify({
            content,
            client_tz: Intl.DateTimeFormat().resolvedOptions().timeZone, // M2.2
        }),
    })
    if (!res.ok || !res.body) {
        handlers.onError(`http_${res.status}`)
        return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let currentEvent: string | null = null

    const handle = (event: string, dataRaw: string) => {
        const data = JSON.parse(dataRaw)
        if (event === 'token') handlers.onToken(data.text)
        else if (event === 'step') handlers.onStep?.(data.label)
        else if (event === 'plan') handlers.onPlan?.(data as PlanEvent)
        else if (event === 'done') handlers.onDone()
        else if (event === 'error') handlers.onError(data.detail)
    }

    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // события разделены пустой строкой; хвост держим в буфере
        let idx
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            for (const line of block.split('\n')) {
                if (line.startsWith('event: ')) currentEvent = line.slice(7)
                else if (line.startsWith('data: ') && currentEvent) {
                    handle(currentEvent, line.slice(6))
                    currentEvent = null
                }
            }
        }
    }
}
