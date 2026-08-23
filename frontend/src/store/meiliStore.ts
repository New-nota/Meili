import { create } from 'zustand'
import type { MeiliMessage, PlanEvent } from '../api/meili'

// Zustand-стор чата Meili (ТЗ-Meili M1.6).
// Токены дописываются в последнее сообщение ассистента по мере стрима.

interface MeiliState {
    conversationId: string | null
    tripId: string | null             // поездка, к которой привязан диалог:
                                      // сменилась — чат обязан пересоздаться
    messages: MeiliMessage[]
    streaming: boolean
    stepLabel: string | null          // M2: «ищу места…» во время tool-вызова
    plan: PlanEvent | null            // M3: активная карточка плана
    setConversation: (id: string, history: MeiliMessage[], tripId: string | null) => void
    startTurn: (userText: string) => void
    appendToken: (text: string) => void
    setStep: (label: string | null) => void
    setPlan: (plan: PlanEvent | null) => void
    finishTurn: () => void
    failTurn: (detail: string) => void
    reset: () => void
}

const localMessage = (role: MeiliMessage['role'], content: string): MeiliMessage => ({
    // локальный id до перезагрузки истории с сервера
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role, content, created_at: new Date().toISOString(),
})

export const useMeiliStore = create<MeiliState>((set) => ({
    conversationId: null,
    tripId: null,
    messages: [],
    streaming: false,
    stepLabel: null,
    plan: null,

    setConversation: (id, history, tripId) =>
        set({ conversationId: id, messages: history, tripId }),

    startTurn: (userText) => set(s => ({
        streaming: true, stepLabel: null,
        messages: [...s.messages, localMessage('user', userText), localMessage('assistant', '')],
    })),

    appendToken: (text) => set(s => {
        const messages = [...s.messages]
        const last = messages[messages.length - 1]
        if (last?.role === 'assistant') {
            messages[messages.length - 1] = { ...last, content: last.content + text }
        }
        return { messages, stepLabel: null }
    }),

    setStep: (label) => set({ stepLabel: label }),
    setPlan: (plan) => set({ plan }),
    finishTurn: () => set({ streaming: false, stepLabel: null }),

    failTurn: (detail) => set(s => ({
        streaming: false, stepLabel: null,
        messages: [...s.messages.filter(m => m.role !== 'assistant' || m.content !== ''),
            localMessage('assistant', `⚠ ${detail}`)],
    })),

    reset: () => set({
        conversationId: null, tripId: null, messages: [],
        streaming: false, stepLabel: null, plan: null,
    }),
}))
