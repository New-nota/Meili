/**
 * Тест работает с DOM (попап строится узлами), поэтому нужен jsdom —
 * остальные юнит-тесты проекта чистые и живут в дефолтном node-окружении.
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { markerPopupContent } from './mapPopup'

// Регрессия на stored XSS: имя места приходит из общего каталога `places`,
// куда пишет любой залогиненный юзер. Раньше попап собирался строкой и уезжал
// в setHTML — «<img onerror>» в имени выполнялся у того, кто кликнул маркер.

describe('markerPopupContent', () => {
    it('кладёт заголовок текстом, а не разметкой', () => {
        const node = markerPopupContent('<img src=x onerror=alert(1)>')
        expect(node.querySelector('img')).toBeNull()
        expect(node.querySelector('strong')?.textContent)
            .toBe('<img src=x onerror=alert(1)>')
    })

    it('так же экранирует подпись', () => {
        const node = markerPopupContent('Музей', '<script>alert(1)</script>')
        expect(node.querySelector('script')).toBeNull()
        expect(node.querySelector('p')?.textContent).toBe('<script>alert(1)</script>')
    })

    it('без подписи рисует только заголовок', () => {
        const node = markerPopupContent('Музей', null)
        expect(node.querySelector('p')).toBeNull()
        expect(node.textContent).toBe('Музей')
    })

    it('применяет переданный css к подписи', () => {
        const node = markerPopupContent('Музей', '60 мин', 'margin: 4px 0 0')
        expect(node.querySelector('p')?.style.marginTop).toBe('4px')
    })
})
