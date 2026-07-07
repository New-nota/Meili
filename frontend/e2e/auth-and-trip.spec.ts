import { test, expect } from '@playwright/test'

// E2E-смоук (S7): регистрация (API) → логин (UI) → создание поездки →
// планировщик. Требует запущенный бэкенд на :8000 (docker compose up).
const API = 'http://localhost:8000'
// уникальный юзер на каждый прогон — тесты не зависят от состояния БД
const EMAIL = `e2e_${Date.now()}@wanderown.dev`
const PASSWORD = 'e2e-secret-123'

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/health`).catch(() => null)
  test.skip(!health || !health.ok(), 'Бэкенд не запущен — пропускаем e2e')
  const res = await request.post(`${API}/auth/register`, {
    data: { email: EMAIL, password: PASSWORD, name: 'E2E' },
  })
  expect(res.ok()).toBeTruthy()
})

test('логин через UI ведёт на /discover', async ({ page }) => {
  await page.goto('/auth')
  await page.getByPlaceholder('Email').fill(EMAIL)
  await page.getByPlaceholder('Пароль').fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page).toHaveURL(/\/discover/)
  await expect(page.getByRole('heading', { name: 'Мои поездки' })).toBeVisible()
})

test('неверный пароль показывает ошибку', async ({ page }) => {
  await page.goto('/auth')
  await page.getByPlaceholder('Email').fill(EMAIL)
  await page.getByPlaceholder('Пароль').fill('wrong-password')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByText('Неверный email или пароль')).toBeVisible()
})

test('незалогиненного редиректит на /auth', async ({ page }) => {
  await page.goto('/discover')
  await expect(page).toHaveURL(/\/auth/)
})

test('создание поездки открывает планировщик', async ({ page }) => {
  // логин
  await page.goto('/auth')
  await page.getByPlaceholder('Email').fill(EMAIL)
  await page.getByPlaceholder('Пароль').fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page).toHaveURL(/\/discover/)

  // создать поездку
  await page.getByRole('button', { name: 'Запланировать поездку' }).click()
  await page.getByPlaceholder('Название поездки').fill('E2E-поездка')
  await page.getByPlaceholder('Город (Опционально)').fill('Калининград')
  await page.getByRole('button', { name: 'Создать' }).click()

  // планировщик открылся: заголовок панели и кнопка оптимизации на месте
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+/)
  await expect(page.getByRole('heading', { name: 'Маршрут' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Оптимизировать/ })).toBeVisible()
})

test('кнопка Google присутствует на странице логина', async ({ page }) => {
  await page.goto('/auth')
  await expect(page.getByRole('button', { name: /Войти через Google/ })).toBeVisible()
})
