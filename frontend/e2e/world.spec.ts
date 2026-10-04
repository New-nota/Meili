import { test, expect, type Page } from '@playwright/test'
import { API, addFromSearch, backendUp, futureDate, login, registerUser } from './helpers'

// По миру без Калининграда: мастер находит любой город, Москва — в зоне
// карт (живая Valhalla строит маршрут), точка вне зоны отклоняется честно,
// язык интерфейса доходит до бэкенда (PDF/.ics/письма).
// Геокодер (Nominatim) мокаем, бэкенд и Valhalla — настоящие.
const EMAIL = `e2e_world_${Date.now()}@e2e.example`
let token = ''

const MOSCOW = { city: 'Москва', city_lat: 55.7505, city_lon: 37.6175 }
const KREMLIN = { place_id: 11, display_name: 'Московский Кремль, Москва, Россия',
  lat: '55.7520', lon: '37.6175', osm_type: 'way', osm_id: 990101 }
const TRETYAKOV = { place_id: 12, display_name: 'Третьяковская галерея, Лаврушинский переулок, Москва',
  lat: '55.7414', lon: '37.6208', osm_type: 'way', osm_id: 990102 }
const BERLIN = { place_id: 13, display_name: 'Брандербургские ворота, Берлин, Германия',
  lat: '52.5163', lon: '13.3777', osm_type: 'way', osm_id: 990103 }

async function mockGeocoder(page: Page, places: object[]) {
  await page.route('**/nominatim.openstreetmap.org/**', route => {
    const url = new URL(route.request().url())
    const body = url.searchParams.get('featureType') === 'settlement'
      ? [
          { place_id: 1, display_name: 'Париж, Иль-де-Франс, Франция', name: 'Париж',
            lat: '48.8566', lon: '2.3522', class: 'boundary', addresstype: 'city',
            address: { state: 'Иль-де-Франс', country: 'Франция' } },
          { place_id: 2, display_name: 'Париж, Техас, США', name: 'Париж',
            lat: '33.6609', lon: '-95.5555', class: 'place', addresstype: 'town',
            address: { state: 'Техас', country: 'США' } },
        ]
      : places
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function apiTrip(request: import('@playwright/test').APIRequestContext, extra: object) {
  const res = await request.post(`${API}/trips/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: `E2E ${Date.now()}`, start_date: futureDate(5), end_date: futureDate(5), ...extra },
  })
  expect(res.status(), await res.text()).toBe(201)
  return res.json()
}

test.beforeAll(async ({ request }) => {
  test.skip(!(await backendUp(request)), 'Бэкенд не запущен — пропускаем e2e')
  token = await registerUser(request, EMAIL, 'E2E World')
})

test('мастер: город где угодно в мире, тёзки различимы, таймзона и страна — от системы', async ({ page, request }) => {
  await mockGeocoder(page, [])
  await login(page, EMAIL)
  await page.getByRole('button', { name: 'Запланировать поездку' }).click()
  await page.getByPlaceholder('Название поездки').fill('Париж весной')
  // подсказка до ввода — без региона (раньше «Калининградская область»)
  await expect(page.getByText('Город, посёлок или деревня — где угодно в мире')).toBeVisible()
  await page.getByPlaceholder('Начните вводить город…').fill('Париж')
  const france = page.getByRole('option', { name: /Иль-де-Франс, Франция/ })
  await expect(france).toBeVisible()
  await expect(page.getByRole('option', { name: /Техас, США/ })).toBeVisible()
  await france.click()
  // выбранный город подписан регионом и страной
  await expect(page.locator('.field-hint', { hasText: 'Иль-де-Франс, Франция' })).toBeVisible()
  const dates = page.locator('input[type="date"]')
  await dates.nth(0).fill(futureDate(10))
  await dates.nth(1).fill(futureDate(12))
  await page.getByRole('button', { name: 'Создать' }).click()
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/)

  const tripId = page.url().split('/').pop()
  const trip = await (await request.get(`${API}/trips/${tripId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json()
  expect(trip.country).toBe('Франция')       // не «Россия» всем подряд
  expect(trip.timezone).toBe('Europe/Paris')  // по координатам города, не Калининград
})

test('Москва: места добавляются, живая Valhalla строит маршрут дня', async ({ page, request }) => {
  const trip = await apiTrip(request, MOSCOW)
  expect(trip.timezone).toBe('Europe/Moscow')
  await mockGeocoder(page, [KREMLIN, TRETYAKOV])
  await login(page, EMAIL)
  await page.goto(`/trips/${trip.id}`)
  const search = page.getByPlaceholder(/^Найти место/)
  await search.fill('кремль')
  await addFromSearch(page, 'Московский Кремль')
  await search.fill('третьяковская')
  await addFromSearch(page, 'Третьяковская галерея')
  await expect(page.locator('.stop-row')).toHaveCount(2)
  // перегон посчитан Valhalla (тайлы Москвы), а не «маршрут не строится»
  await expect(page.getByText('пешком').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Маршрут дня сейчас не строится')).toHaveCount(0)
})

test('точка вне зоны карт отклоняется понятным текстом, день не ломается', async ({ page, request }) => {
  const trip = await apiTrip(request, MOSCOW)
  await mockGeocoder(page, [BERLIN])
  await login(page, EMAIL)
  await page.goto(`/trips/${trip.id}`)
  await page.getByPlaceholder(/^Найти место/).fill('бранденбургские')
  await addFromSearch(page, 'Брандербургские ворота')
  await expect(page.getByText('Здесь пока не строятся маршруты — точка вне зоны наших карт')).toBeVisible()
  await expect(page.locator('.stop-row')).toHaveCount(0)
})

test('язык интерфейса: English → <html lang> и Accept-Language у экспорта PDF', async ({ page, request }) => {
  const trip = await apiTrip(request, MOSCOW)
  await login(page, EMAIL)
  await page.goto('/profile')
  await page.locator('select[aria-label="Language"]').selectOption('en')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.goto(`/trips/${trip.id}`)
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible()
  const pdfRequest = page.waitForRequest(r => r.url().endsWith(`/trips/${trip.id}/export/pdf`))
  const pdfResponse = page.waitForResponse(r => r.url().endsWith(`/trips/${trip.id}/export/pdf`))
  await page.getByRole('button', { name: 'Download PDF' }).click()
  expect((await pdfRequest).headers()['accept-language']).toBe('en')
  const res = await pdfResponse
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('application/pdf')
  // язык живёт в localStorage — вернём русский, чтобы не влиять на другие спеки
  await page.evaluate(() => localStorage.setItem('wanderown_lng', 'ru'))
})
