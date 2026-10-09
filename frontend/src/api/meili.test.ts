import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamMessage, type StreamHandlers } from './meili'

// SSE-клиент чата: парс потока fetch+ReadableStream, буферизация
// событий, разрезанных границей чанка

function sseResponse(chunks: string[], status = 200): Response {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const c of chunks) controller.enqueue(encoder.encode(c))
            controller.close()
        },
    })
    return new Response(stream, { status })
}

function handlers() {
    return {
        tokens: [] as string[],
        steps: [] as string[],
        done: 0,
        errors: [] as string[],
        h: {} as StreamHandlers,
        init() {
            this.h = {
                onToken: t => this.tokens.push(t),
                onStep: l => this.steps.push(l),
                onPlan: () => {},
                onDone: () => { this.done += 1 },
                onError: d => this.errors.push(d),
            }
            return this
        },
    }.init()
}

afterEach(() => vi.unstubAllGlobals())

describe('streamMessage', () => {
    it('парсит токены, step и done из SSE-потока', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
            'event: token\ndata: {"text":"Прив"}\n\n',
            'event: step\ndata: {"label":"ищу места"}\n\n',
            'event: token\ndata: {"text":"ет"}\n\nevent: done\ndata: {"message_id":"m1"}\n\n',
        ])))
        const ctx = handlers()
        await streamMessage('conv-1', 'привет', ctx.h)
        expect(ctx.tokens.join('')).toBe('Привет')
        expect(ctx.steps).toEqual(['ищу места'])
        expect(ctx.done).toBe(1)
        expect(ctx.errors).toEqual([])
    })

    it('places отдаёт карточки найденного (meili_upgrade)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
            'event: places\ndata: {"places":[{"place_id":"p1","name":"Метрополь","category":"hotel"}]}\n\n',
            'event: done\ndata: {}\n\n',
        ])))
        const ctx = handlers()
        const got: string[] = []
        await streamMessage('conv-1', 'q', { ...ctx.h, onPlaces: ps => got.push(...ps.map(p => p.name)) })
        expect(got).toEqual(['Метрополь'])
        expect(ctx.done).toBe(1)
    })

    it('событие, разрезанное границей чанка, склеивается буфером', async () => {
        const event = 'event: token\ndata: {"text":"целиком"}\n\n'
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
            event.slice(0, 17), event.slice(17),
            'event: done\ndata: {}\n\n',
        ])))
        const ctx = handlers()
        await streamMessage('conv-1', 'q', ctx.h)
        expect(ctx.tokens).toEqual(['целиком'])
        expect(ctx.done).toBe(1)
    })

    it('не-2xx ответ уходит в onError с кодом', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response('{"detail":"llm_not_configured"}', { status: 501 })))
        const ctx = handlers()
        await streamMessage('conv-1', 'q', ctx.h)
        expect(ctx.errors).toEqual(['http_501'])
        expect(ctx.done).toBe(0)
    })

    it('event: error транслируется в onError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
            'event: error\ndata: {"detail":"assistant_error"}\n\n',
        ])))
        const ctx = handlers()
        await streamMessage('conv-1', 'q', ctx.h)
        expect(ctx.errors).toEqual(['assistant_error'])
    })
})
