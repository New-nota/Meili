import { test, expect } from '@playwright/test'
import { API, backendUp, futureDate, login, registerUser } from './helpers'
const EMAIL = `e2e_daytime_${Date.now()}@e2e.example`
// живой прогон: день всегда начинался в 09:00 — поля для времени не было
test.beforeAll(async ({ request }) => {
  test.skip(!(await backendUp(request)), 'Бэкенд не запущен — пропускаем e2e')
})

test('день: время начала правится и двигает старт', async ({ page, request }) => {
  const token = await registerUser(request, EMAIL, 'E2E')
  const h = { Authorization: `Bearer ${token}` }
  const trip = await (await request.post(`${API}/trips/`, { headers: h, data: {
    title: 'Время', city: 'Москва', city_lat: 55.7505, city_lon: 37.6175, start_date: futureDate(5), end_date: futureDate(6), currency: 'RUB' } })).json()
  await login(page, EMAIL)
  await page.goto(`/trips/${trip.id}`)
  const time = page.getByLabel('Время начала дня')
  await expect(time).toHaveValue('09:00')
  const saved = page.waitForResponse(r => r.url().includes('/days/') && r.request().method() === 'PATCH')
  await time.fill('11:30')
  await time.blur()
  expect((await saved).status()).toBe(200)
  await expect(page.getByText('Старт в 11:30')).toBeVisible()
})
