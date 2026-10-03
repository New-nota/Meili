import type { ReactNode } from 'react'

// Разметка ответов Meili (ревью).
//
// Модель отвечает markdown'ом — «**Даты:** 26 августа», «### Что важно» — а
// пузырь чата печатал это как есть, звёздочками и решётками. Читалось как
// «поехавший шрифт», особенно когда ответ длинный.
//
// Полноценный markdown тут не нужен и опасен: подключать рендерер ради двух
// конструкций — лишняя зависимость, а собирать HTML строкой в чат, куда
// приходит внешний текст, нельзя в принципе (см. utils/mapPopup). Поэтому
// разбираем ровно то, что модель реально пишет, и отдаём React-узлами —
// текст остаётся текстом, экранирование делает сам React.

const BOLD = /\*\*(.+?)\*\*/g
// строка-заголовок: «## Что важно» / «### День 1»
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/

/** Инлайн-жирный внутри одной строки. */
function inline(line: string, keyPrefix: string): ReactNode[] {
    const parts: ReactNode[] = []
    let last = 0
    for (const match of line.matchAll(BOLD)) {
        const start = match.index ?? 0
        if (start > last) parts.push(line.slice(last, start))
        parts.push(<strong key={`${keyPrefix}-b${start}`}>{match[1]}</strong>)
        last = start + match[0].length
    }
    if (last < line.length) parts.push(line.slice(last))
    return parts.length ? parts : [line]
}

/** Текст сообщения ассистента с разобранными ** и заголовками. */
export function renderChatText(text: string): ReactNode[] {
    const lines = text.split('\n')
    return lines.map((line, i) => {
        const heading = line.match(HEADING)
        const key = `l${i}`
        const content = heading
            ? [<strong key={`${key}-h`}>{inline(heading[1], key)}</strong>]
            : inline(line, key)
        // перевод строки — обычным текстом: у пузыря white-space: pre-wrap,
        // так разрывы остаются на месте и без <br>
        return <span key={key}>{content}{i < lines.length - 1 ? '\n' : ''}</span>
    })
}
