/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderChatText } from './chatText'

const html = (text: string) => renderToStaticMarkup(<>{renderChatText(text)}</>)

describe('renderChatText', () => {
    it('делает ** жирным, а не печатает звёздочками', () => {
        const out = html('**Даты:** 26 августа')
        expect(out).toContain('<strong>Даты:</strong>')
        expect(out).not.toContain('**')
    })

    it('заголовок ### становится жирной строкой без решёток', () => {
        const out = html('### День 1')
        expect(out).toContain('<strong>')
        expect(out).toContain('День 1')
        expect(out).not.toContain('#')
    })

    it('сохраняет переводы строк и не добавляет лишних', () => {
        expect(html('раз\nдва')).toBe('<span>раз\n</span><span>два</span>')
    })

    it('экранирует разметку из текста — это данные, не HTML', () => {
        const out = html('<img src=x onerror=alert(1)>')
        expect(out).not.toContain('<img')
        expect(out).toContain('&lt;img')
    })

    it('обычный текст остаётся как есть', () => {
        expect(html('просто ответ')).toBe('<span>просто ответ</span>')
    })
})
