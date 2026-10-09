import { apiFetch, API_URL, getAccessToken, tryRefresh } from './client'

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
    error?: boolean     // локальное сообщение об ошибке хода (рисуется брусникой со значком)
    places?: PlaceCard[] // meili_upgrade: найденное в этом ходе (живёт до перезагрузки истории)
}

// meili_upgrade: карточка места из event: places — факты системы из
// результата search_places, модель их не пишет
export interface PlaceCard {
    place_id: string
    name: string
    category: string | null
    address?: string | null
    city?: string | null
    tags?: string[]
    lat?: number
    lon?: number
    is_open_now?: boolean | null
    price?: string | null
    price_is_estimate?: boolean
    distance_m?: number
    outside_requested_city?: boolean
    // этап B (2ГИС): рейтинг — только с числом отзывов; lodging_price_from —
    // «номер от», ориентир для показа, не цена проживания
    rating?: string
    rating_count?: number
    avg_check?: string
    lodging_price_from?: string
    price_currency?: string
    price_source?: 'osm' | '2gis' | 'manual'
    // суммы от системы: на всю группу / за всё проживание (от)
    group_size?: number
    cost_for_group?: string
    lodging_total_from?: string
    nights?: number
    dgis_id?: string
}

// План появляется в M3; тип объявлен здесь, чтобы SSE-клиент был полным
export interface PlanAction {
    type: 'create_trip' | 'add_stop' | 'remove_stop' | 'set_budget' | 'set_stop_cost' | 'optimize'
        | 'set_lodging' | 'add_expense'
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

// S17: черновик мастера создания. Уходит на сервер структурно — раньше эти
// поля пересказывались модели текстом первого сообщения, и она их теряла
// (созданные ассистентом поездки выходили без города и с чужой валютой).
export interface TripDraft {
    title?: string
    city?: string
    country?: string
    city_lat?: number
    city_lon?: number
    start_date?: string
    end_date?: string
    adults_count?: number
    children_count?: number
    children_ages?: number[]
    budget_total?: string
    currency?: string
}

export const createConversation = (tripId?: string | null, draft?: TripDraft | null) =>
    apiFetch<Conversation>(
        `/api/meili/conversations${tripId ? `?trip_id=${tripId}` : ''}`,
        { method: 'POST', ...(draft ? { body: JSON.stringify(draft) } : {}) },
    )

export const getMeiliMessages = (conversationId: string) =>
    apiFetch<MeiliMessage[]>(`/api/meili/conversations/${conversationId}/messages`)

export interface StreamHandlers {
    onToken: (text: string) => void
    onStep?: (label: string) => void
    onPlan?: (plan: PlanEvent) => void
    onPlaces?: (places: PlaceCard[]) => void
    onDone: () => void
    onError: (detail: string) => void
}

// SSE через fetch + ReadableStream: токены дописываются в реальном времени
export async function streamMessage(
    conversationId: string, content: string, handlers: StreamHandlers,
): Promise<void> {
    const body = JSON.stringify({
        content,
        client_tz: Intl.DateTimeFormat().resolvedOptions().timeZone, // M2.2
    })
    const send = () => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const token = getAccessToken()
        if (token) headers['Authorization'] = `Bearer ${token}`
        return fetch(`${API_URL}/api/meili/conversations/${conversationId}/messages`, {
            method: 'POST', headers, credentials: 'include', body,
        })
    }

    let res = await send()
    // Ревью: SSE идёт сырым fetch'ем мимо apiFetch, поэтому молчаливого
    // рефреша тут не было — через 15 минут (жизнь access-токена) чат отвечал
    // «http_401» на каждое сообщение, пока страницу не дёрнут другой ручкой.
    // Повторяем ту же одну попытку рефреша, что и apiFetch.
    if (res.status === 401 && await tryRefresh()) {
        res = await send()
    }
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
        else if (event === 'places') handlers.onPlaces?.(data.places as PlaceCard[])
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
