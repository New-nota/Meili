import { test, expect, type Page } from '@playwright/test'
import { addFromSearch, backendUp, compose, futureDate, login as loginAs, registerUser } from './helpers'

// QA-прогон: сценарии, которые ломались «на полпути» и были починены общим
// правилом. Требует запущенный docker-стек (:8000, Valhalla с тайлами области).
const EMAIL = `e2e_qa_${Date.now()}@e2e.example`

// геокодер: город для мастера и два места в Калининграде для поиска
const PLACES = [
  { place_id: 1, display_name: 'Кафедральный собор, остров Канта, Калининград',
    lat: '54.7064', lon: '20.5116', osm_type: 'way', osm_id: 990001 },
  { place_id: 2, display_name: 'Музей Мирового океана, набережная Петра Великого, Калининград',
    lat: '54.7069', lon: '20.4985', osm_type: 'way', osm_id: 990002 },
]
async function mockNominatim(page: Page) {
  await page.route('**/nominatim.openstreetmap.org/**', route => {
    const url = new URL(route.request().url())
    const isCity = url.searchParams.get('addressdetails') === '1' && url.pathname.includes('search')
      && url.searchParams.get('limit') === '6'
    const body = isCity
      ? [{ display_name: 'Калининград, Калининградская область, Россия', name: 'Калининград',
           lat: '54.7104', lon: '20.5114', class: 'place', addresstype: 'city' }]
      : PLACES
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
}

const login = (page: Page, email = EMAIL) => loginAs(page, email)

async function createTrip(page: Page, title: string) {
  await page.getByRole('button', { name: 'Запланировать поездку' }).click()
  await page.getByPlaceholder('Название поездки').fill(title)
  // город набран целиком, по подсказке НЕ кликаем — раньше это «выберите город»
  const geocoded = page.waitForResponse(r => r.url().includes('nominatim') && r.url().includes('limit=6'))
  await page.getByPlaceholder('Начните вводить город…').fill('калининград')
  await geocoded
  // подсказка в выпадашке мастера (на Discover «Калининград» есть и в карточках поездок)
  await expect(page.getByRole('option', { name: 'Калининград' })).toBeVisible()
  const dates = page.locator('input[type="date"]')
  await dates.nth(0).fill(futureDate(5))
  await dates.nth(1).fill(futureDate(7))
  await page.getByRole('button', { name: 'Создать' }).click()
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/)
}

test.beforeAll(async ({ request }) => {
  test.skip(!(await backendUp(request)), 'Бэкенд не запущен — пропускаем e2e')
  await registerUser(request, EMAIL, 'E2E QA')
})

test('email регистронезависим: логин другим регистром и с пробелами', async ({ page }) => {
  await login(page, `  ${EMAIL.toUpperCase()} `)
})

test('пустой логин — подсказка, а не «неверный пароль»', async ({ page }) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Введите email и пароль')
})

test('мастер: число детей упирается в потолок, а не вешает вкладку', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: 'Запланировать поездку' }).click()
  const children = page.locator('input[type="number"]').nth(1)
  await children.fill('99999')
  await expect(children).toHaveValue('50')
  await expect(page.locator('input[title^="Ребёнок"]')).toHaveCount(50)
  await page.keyboard.press('Escape')  // Escape закрывает мастер
  await expect(page.getByPlaceholder('Название поездки')).toHaveCount(0)
})

test('несуществующая поездка — экран «не найдена», а не пустой планировщик', async ({ page }) => {
  await login(page)
  await page.goto('/trips/00000000-0000-0000-0000-000000000000')
  await expect(page.getByText('Поездка не найдена')).toBeVisible()
  await page.goto('/trips/not-a-uuid/settings')
  await expect(page.getByText('Поездка не найдена')).toBeVisible()
})

test('планировщик: поиск → добавить → оптимизировать без старта/финиша → удалить место', async ({ page }) => {
  await mockNominatim(page)
  await login(page)
  await createTrip(page, 'E2E планировщик')
  // название поездки видно в собственной шапке
  await expect(page.getByText('E2E планировщик')).toBeVisible()

  const search = page.getByPlaceholder(/^Найти место/)
  for (const name of ['Кафедральный собор', 'Музей Мирового океана']) {
    await search.fill('калининград ' + name.split(' ')[0])
    await addFromSearch(page, name)
    await expect(page.locator('.stop-row').getByText(name, { exact: true })).toBeVisible()
  }

  // раньше без старта/финиша дня — отказ day_locations_missing
  const optimize = page.getByRole('button', { name: 'Оптимизировать день' })
  const optimized = page.waitForResponse(r => r.url().includes('/optimize'))
  await optimize.click()
  expect((await optimized).status()).toBe(200)
  await expect(page.getByText('У дня не заданы точки старта/финиша')).toHaveCount(0)

  // удалить место из маршрута — кнопки раньше не было вовсе
  await page.locator('.stop-row').getByText('Музей Мирового океана', { exact: true }).click()
  await page.getByRole('button', { name: 'Удалить из маршрута' }).click()
  await page.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByText('Музей Мирового океана', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Кафедральный собор', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/qa-planner.png' })
})

test('бюджет: сумма с запятой принимается, мусор — понятная ошибка', async ({ page }) => {
  await mockNominatim(page)
  await login(page)
  await createTrip(page, 'E2E бюджет')
  await page.getByRole('tab', { name: 'Бюджет' }).click()
  await page.getByPlaceholder('Название').fill('Отель')
  const amount = page.getByPlaceholder('Сумма')
  await amount.fill('abc')
  await amount.press('Enter')
  await expect(page.getByRole('alert')).toContainText('Сумма — число')
  await amount.fill('4500,75')
  await amount.press('Enter')
  await expect(page.getByText('Жильё · Отель')).toBeVisible()
  await expect(page.getByText(/4\s?500,75/).first()).toBeVisible()
})

test('настройки: перенос поездки на другие даты едет вместе со стопами', async ({ page }) => {
  await mockNominatim(page)
  await login(page)
  await createTrip(page, 'E2E перенос')
  await page.getByPlaceholder(/^Найти место/).fill('калининград собор')
  await addFromSearch(page, 'Кафедральный собор')
  await expect(page.locator('.stop-row').getByText('Кафедральный собор', { exact: true })).toBeVisible()

  const url = page.url()
  await page.goto(url + '/settings')
  const dates = page.locator('input[type="date"]')
  await dates.nth(0).fill(futureDate(20))
  await dates.nth(1).fill(futureDate(22))
  await page.getByRole('button', { name: 'Сохранить' }).click()
  // раньше — 409 «Сначала перенеси стопы из удаляемого дня»
  await expect(page).toHaveURL(url)
  await expect(page.getByText('Кафедральный собор', { exact: true })).toBeVisible()
})


// Meili без живого LLM: план замораживается в БД тем же кодом, что и в
// agent loop (ProposedPlan → MeiliPlan), а SSE-ответ ассистента подменяем.
// «Применить» идёт в настоящий executor.
function freezePlan(tripId: string): string {
  const py = [
    'import asyncio, json, uuid',
    'from sqlalchemy import select',
    'from app.core.database import AsyncSessionLocal',
    'from app.models.trip import Trip',
    'from app.models.place import Place',
    'from app.models.conversation import Conversation',
    'from app.models.meili_plan import MeiliPlan',
    'from app.schemas.plan import ProposedPlan',
    'async def main():',
    '    async with AsyncSessionLocal() as db:',
    `        trip = await db.get(Trip, uuid.UUID("${tripId}"))`,
    '        place = (await db.execute(select(Place).where(Place.city == "Калининград", Place.location.is_not(None)).limit(1))).scalar_one()',
    '        conv = Conversation(user_id=trip.user_id, trip_id=trip.id)',
    '        db.add(conv); await db.flush()',
    '        plan = ProposedPlan(summary="E2E план Meili", actions=[',
    '            {"type": "add_stop", "place_id": str(place.id), "day_index": 0},',
    '            {"type": "set_budget", "amount": "20000", "currency": "RUB"}])',
    '        frozen = MeiliPlan(conversation_id=conv.id, plan_json=plan.model_dump(mode="json"))',
    '        db.add(frozen); await db.commit()',
    '        print(json.dumps({"plan_id": str(frozen.id), "plan_json": frozen.plan_json, "place": place.name}))',
    'asyncio.run(main())',
  ].join('\n')
  return compose('exec -T backend python -', py)
}

test('Meili: карточка плана → «Применить» пишет в поездку через executor', async ({ page }) => {
  await mockNominatim(page)
  await login(page)
  await createTrip(page, 'E2E Meili')
  const tripId = page.url().split('/trips/')[1]
  const planEvent = freezePlan(tripId)
  const { place } = JSON.parse(planEvent)

  await page.route('**/api/meili/conversations/*/messages', route => {
    if (route.request().method() !== 'POST') return route.fallback()
    return route.fulfill({
      contentType: 'text/event-stream',
      body: `event: token\ndata: {"text": "Вот план"}\n\n`
        + `event: plan\ndata: ${planEvent}\n\n`
        + `event: done\ndata: {"message_id": "${'0'.repeat(8)}-0000-0000-0000-000000000000"}\n\n`,
    })
  })
  await page.getByRole('tab', { name: 'Meili' }).click()
  await page.getByPlaceholder('Спросите Meili…').fill('Добавь что-нибудь в первый день')
  await page.getByPlaceholder('Спросите Meili…').press('Enter')
  await expect(page.getByText('E2E план Meili')).toBeVisible()
  await expect(page.getByText(`Добавить место: ${place}`)).toBeVisible()

  const applied = page.waitForResponse(r => r.url().includes('/apply'))
  await page.getByRole('button', { name: /Применить/ }).click()
  expect((await applied).status()).toBe(200)

  await page.getByRole('tab', { name: 'Маршрут' }).click()
  await expect(page.getByText(place, { exact: true }).first()).toBeVisible()
  await page.getByRole('tab', { name: 'Бюджет' }).click()
  await expect(page.getByText(/20\s?000,00/).first()).toBeVisible()
})


// meili_upgrade: карточки найденного под ответом. Место — настоящее из
// каталога (сид области), SSE подменяем; «В день» идёт в обычную ручку стопов
function catalogPlace(): { place_id: string; name: string; lat: number; lon: number } {
  const py = [
    'import asyncio, json',
    'from sqlalchemy import select, func',
    'from app.core.database import AsyncSessionLocal',
    'from app.models.place import Place',
    'async def main():',
    '    async with AsyncSessionLocal() as db:',
    '        p, lat, lon = (await db.execute(select(Place, func.ST_Y(Place.location), func.ST_X(Place.location))'
    + '.where(Place.city == "Калининград", Place.category == "museum", Place.location.is_not(None)).limit(1))).one()',
    '        print(json.dumps({"place_id": str(p.id), "name": p.name, "lat": lat, "lon": lon}))',
    'asyncio.run(main())',
  ].join('\n')
  return JSON.parse(compose('exec -T backend python -', py))
}

test('Meili: карточка найденного места → «В день» добавляет стоп', async ({ page }) => {
  await mockNominatim(page)
  await login(page)
  await createTrip(page, 'E2E Meili карточки')
  const place = catalogPlace()
  const card = { ...place, category: 'museum', address: null, is_open_now: null }

  await page.route('**/api/meili/conversations/*/messages', route => {
    if (route.request().method() !== 'POST') return route.fallback()
    return route.fulfill({
      contentType: 'text/event-stream',
      body: `event: step\ndata: {"label": "ищу места"}\n\n`
        + `event: places\ndata: ${JSON.stringify({ places: [card] })}\n\n`
        + `event: token\ndata: {"text": "Нашла музей"}\n\n`
        + `event: done\ndata: {"message_id": "${'0'.repeat(8)}-0000-0000-0000-000000000000"}\n\n`,
    })
  })
  await page.getByRole('tab', { name: 'Meili' }).click()
  await page.getByPlaceholder('Спросите Meili…').fill('Найди музей')
  await page.getByPlaceholder('Спросите Meili…').press('Enter')
  const cards = page.getByRole('list', { name: 'Найденные места' })
  await expect(cards.getByText(place.name, { exact: true })).toBeVisible()

  // клик по карточке в планировщике — место на нашей карте (карточка точки)
  await cards.getByText(place.name, { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Добавить в маршрут' })).toBeVisible()
  await page.keyboard.press('Escape')

  const added = page.waitForResponse(r => r.url().endsWith('/stops') && r.request().method() === 'POST')
  await cards.getByRole('button', { name: /В день/ }).click()
  await page.locator('.menu-item', { hasText: 'Д1' }).click()
  expect((await added).ok()).toBe(true)
  await expect(cards.getByText('Добавлено: Д1')).toBeVisible()

  await page.getByRole('tab', { name: 'Маршрут' }).click()
  await expect(page.getByText(place.name, { exact: true }).first()).toBeVisible()
})


test('мастер → «Посоветоваться с Meili»: чат с черновиком; отказ провайдера — честный текст', async ({ page }) => {
  await mockNominatim(page)
  await login(page)
  await page.route('**/api/meili/conversations/*/messages', route => {
    if (route.request().method() !== 'POST') return route.fallback()
    return route.fulfill({
      contentType: 'text/event-stream',
      body: 'event: error\ndata: {"detail": "provider_auth"}\n\n',
    })
  })
  await page.getByRole('button', { name: 'Запланировать поездку' }).click()
  await page.getByPlaceholder('Название поездки').fill('Черновик для Meili')
  await page.getByText('Посоветоваться с Meili').click()
  const created = page.waitForRequest(r => r.url().endsWith('/api/meili/conversations') && r.method() === 'POST')
  await page.getByRole('button', { name: 'Создать' }).click()
  // черновик уходит модели фактами, а поле ввода свободно для своего запроса
  expect((await created).postDataJSON()).toMatchObject({ title: 'Черновик для Meili' })
  const input = page.getByPlaceholder('Спросите Meili…')
  await expect(input).toHaveValue('')
  await input.fill('Что посмотреть?')
  await input.press('Enter')
  await expect(page.getByText(/провайдер ИИ отклонил доступ/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(input).toHaveCount(0)
})


test('день: переименование, сброс пробелами, транспорт перегона, сбой маршрута', async ({ page }) => {
  await mockNominatim(page)
  await login(page)
  await createTrip(page, 'E2E день')
  for (const name of ['Кафедральный собор', 'Музей Мирового океана']) {
    await page.getByPlaceholder(/^Найти место/).fill('калининград ' + name.split(' ')[0])
    await addFromSearch(page, name)
    await expect(page.locator('.stop-row').getByText(name, { exact: true })).toBeVisible()
  }
  // переименование дня переживает перезагрузку
  await page.getByRole('button', { name: 'Переименовать день' }).first().click()
  await page.getByLabel('Название дня').fill('Остров Канта')
  await page.getByLabel('Название дня').press('Enter')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Переименовать день' }).first()).toHaveText('Остров Канта')
  // пробелы = снова «День 1»
  await page.getByRole('button', { name: 'Переименовать день' }).first().click()
  await page.getByLabel('Название дня').fill('   ')
  await page.getByLabel('Название дня').press('Enter')
  await expect(page.getByRole('button', { name: 'Переименовать день' }).first()).toHaveText('День 1')

  // транспорт перегона: пешком -> на машине, маршрут пересчитывается
  const leg = page.getByRole('button', { name: /пешком/ }).first()
  await expect(leg).toBeVisible()
  const recalculated = page.waitForResponse(r => r.url().includes('/route?day_id=') && r.status() === 200)
  await leg.click()
  await page.getByText('на машине', { exact: true }).click()
  await recalculated
  await expect(page.getByRole('button', { name: /на машине/ }).first()).toBeVisible()

  // Valhalla «лежит»: вместо вечного скелетона — объяснение
  await page.route('**/route?day_id=*', route => route.fulfill({
    status: 502, contentType: 'application/json', body: '{"detail": "upstream_unavailable"}',
  }))
  await page.reload()
  await expect(page.getByText(/не отвечает — попробуйте позже/)).toBeVisible()
})


test('клик по карте: карточка точки → «Добавить в маршрут» при свёрнутых днях', async ({ page }) => {
  await mockNominatim(page)
  await page.route('**/nominatim.openstreetmap.org/reverse**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ display_name: 'Точка на карте, Калининград', name: 'Точка на карте',
      osm_type: 'node', osm_id: 990777, address: { road: 'Ленинский проспект', house_number: '1' } }),
  }))
  await login(page)
  await createTrip(page, 'E2E карта')
  // режим «Все дни» (ни один день не открыт): раньше уходил day_id: null → 422
  await page.getByRole('button', { name: 'Все дни' }).click()
  const map = page.locator('.planner-map canvas')
  await expect(map).toBeVisible()
  await page.waitForTimeout(1500)  // стиль карты догружается
  const box = (await map.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByRole('button', { name: 'Добавить в маршрут' })).toBeVisible()
  await page.getByRole('button', { name: 'Добавить в маршрут' }).click()
  // точка легла в первый день, и он открылся
  await expect(page.getByRole('button', { name: 'Переименовать день' })).toHaveText('День 1')
  await expect(page.locator('.stop-row')).toHaveCount(1)
})
