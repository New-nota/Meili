// Содержимое попапа маркера на карте — строится ДОМом, не строкой.
//
// Ревью (stored XSS): попапы собирались шаблонной строкой и уезжали в
// maplibregl.Popup.setHTML, то есть в innerHTML. Название места приходит из
// ОБЩЕГО каталога `places` (POST /places/ доступен любому юзеру), поэтому
// «<img src=x onerror=…>» в имени выполнялся в сессии любого, кто добавил это
// место в маршрут и кликнул по маркеру. Имя локации и адрес «дома» — тоже
// пользовательский ввод. textContent экранирует всё это по построению.
//
// setHTML в проекте больше быть не должно: попапы делаются через setDOMContent.

/** Подписи попапа: жирный заголовок + необязательная строка под ним. */
export function markerPopupContent(
    title: string,
    subtitle?: string | null,
    subtitleCss = '',
): HTMLElement {
    const wrap = document.createElement('div')
    wrap.style.padding = '8px'

    const heading = document.createElement('strong')
    heading.textContent = title
    wrap.appendChild(heading)

    if (subtitle) {
        const line = document.createElement('p')
        line.style.cssText = subtitleCss
        line.textContent = subtitle
        wrap.appendChild(line)
    }
    return wrap
}
