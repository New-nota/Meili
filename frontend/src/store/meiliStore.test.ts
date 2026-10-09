import { beforeEach, describe, expect, it } from 'vitest'
import { useMeiliStore } from './meiliStore'

// стор чата Meili: токены дописываются в последнее сообщение ассистента,
// диалог привязан к поездке (utечка диалога между поездками — регрессия ревью)
const store = () => useMeiliStore.getState()

describe('meiliStore', () => {
    beforeEach(() => store().reset())

    it('setConversation привязывает диалог к поездке', () => {
        store().setConversation('conv-1', [], 'trip-A')
        expect(store().conversationId).toBe('conv-1')
        expect(store().tripId).toBe('trip-A')
    })

    it('startTurn добавляет реплику юзера и пустой ответ ассистента', () => {
        store().startTurn('привет')
        const msgs = store().messages
        expect(msgs).toHaveLength(2)
        expect(msgs[0]).toMatchObject({ role: 'user', content: 'привет' })
        expect(msgs[1]).toMatchObject({ role: 'assistant', content: '' })
        expect(store().streaming).toBe(true)
    })

    it('appendToken дописывает в последнее сообщение ассистента', () => {
        store().startTurn('q')
        store().appendToken('При')
        store().appendToken('вет')
        expect(store().messages.at(-1)?.content).toBe('Привет')
    })

    it('failTurn заменяет пустой ответ на сообщение об ошибке', () => {
        store().startTurn('q')
        store().failTurn('всё сломалось')
        const msgs = store().messages
        expect(msgs.at(-1)?.content).toBe('всё сломалось')
        expect(msgs.at(-1)?.error).toBe(true)
        expect(msgs.filter(m => m.role === 'assistant')).toHaveLength(1)
        expect(store().streaming).toBe(false)
    })

    it('failTurn убирает недодиктованный ответ, а не только пустой', () => {
        // ход упал посреди стрима: огрызок не должен остаться рядом с ошибкой
        store().startTurn('q')
        store().appendToken('**Зе')
        store().failTurn('всё сломалось')
        const msgs = store().messages
        expect(msgs.map(m => m.content)).toEqual(['q', 'всё сломалось'])
    })

    it('failTurn не трогает историю, пришедшую с сервера', () => {
        store().setConversation('conv-1', [
            { id: 'srv-1', role: 'assistant', content: 'старый ответ', created_at: '' },
        ], null)
        store().startTurn('q')
        store().failTurn('сбой')
        expect(store().messages.map(m => m.content))
            .toEqual(['старый ответ', 'q', 'сбой'])
    })

    it('reset очищает привязку к поездке и план', () => {
        store().setConversation('conv-1', [], 'trip-A')
        store().setPlan({ plan_id: 'p1', plan_json: { actions: [], summary: 's' } })
        store().reset()
        expect(store().conversationId).toBeNull()
        expect(store().tripId).toBeNull()
        expect(store().plan).toBeNull()
    })

    it('addPlaces цепляет карточки к ответу хода и не дублирует места', () => {
        store().startTurn('найди отель')
        store().addPlaces([{ place_id: 'p1', name: 'Отель', category: 'hotel' }])
        store().addPlaces([
            { place_id: 'p1', name: 'Отель', category: 'hotel' },
            { place_id: 'p2', name: 'Хостел', category: 'hotel' },
        ])
        const last = store().messages[store().messages.length - 1]
        expect(last.places?.map(p => p.place_id)).toEqual(['p1', 'p2'])
        expect(store().messages[0].places).toBeUndefined()  // реплика юзера не трогается
    })
})
