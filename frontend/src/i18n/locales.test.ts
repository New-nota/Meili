import { describe, expect, it } from 'vitest'
import ru from './locales/ru/translation.json'
import en from './locales/en/translation.json'
import de from './locales/de/translation.json'
import fr from './locales/fr/translation.json'
import es from './locales/es/translation.json'

// QA: полнота локалей. de/fr/es были «заготовками» — немцу показывалась смесь
// немецкого и английского, а новые строки (ошибки, Meili) добавлялись только
// в ru/en. Тест падает, если ключ есть в эталоне, но отсутствует в языке,
// или если в переводе потерян плейсхолдер {{…}}.

type Tree = { [k: string]: string | Tree }
const flat = (tree: Tree, prefix = ''): Record<string, string> =>
    Object.entries(tree).reduce<Record<string, string>>((acc, [k, v]) => {
        if (typeof v === 'string') acc[prefix + k] = v
        else Object.assign(acc, flat(v, `${prefix}${k}.`))
        return acc
    }, {})

// формы множественного числа у языков разные (ru: few/many, en: other)
const PLURAL = /_(zero|one|two|few|many|other)$/
const base = (key: string) => key.replace(PLURAL, '')
const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map(m => m[1]).sort()

const reference = flat(en as Tree)
const locales: Record<string, Record<string, string>> = {
    ru: flat(ru as Tree), en: reference, de: flat(de as Tree), fr: flat(fr as Tree), es: flat(es as Tree),
}

describe('i18n', () => {
    for (const [lang, dict] of Object.entries(locales)) {
        it(`${lang}: есть все ключи эталона`, () => {
            const bases = new Set(Object.keys(dict).map(base))
            const missing = Object.keys(reference).filter(k => !(k in dict) && !bases.has(base(k)))
            expect(missing).toEqual([])
        })
        it(`${lang}: плейсхолдеры совпадают с эталоном`, () => {
            const broken = Object.keys(dict)
                .filter(k => k in reference && !PLURAL.test(k))
                .filter(k => placeholders(dict[k]).join() !== placeholders(reference[k]).join())
            expect(broken).toEqual([])
        })
    }
    it('ru и en синхронны в обе стороны', () => {
        const ruBases = new Set(Object.keys(locales.ru).map(base))
        const enOnly = Object.keys(reference).filter(k => !ruBases.has(base(k)))
        expect(enOnly).toEqual([])
    })
})
