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

  // планировщик открылся; без дат — плоский режим с подсказкой (S8 WP-3)
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+/)
  await expect(page.getByRole('heading', { name: 'Маршрут' })).toBeVisible()
  await expect(page.getByText('Задай даты поездки')).toBeVisible()

  // задаём даты в настройках -> появляются дни с per-day оптимизацией
  const tripUrl = page.url()
  await page.goto(tripUrl + '/settings')
  await page.locator('input[type="date"]').first().fill('2026-08-01')
  await page.locator('input[type="date"]').nth(1).fill('2026-08-02')
  await page.getByRole('button', { name: /Сохранить/ }).click()
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/)
  await expect(page.getByText(/День 1/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Оптимизировать день/ })).toBeVisible()
})

test('кнопка Google присутствует на странице логина', async ({ page }) => {
  await page.goto('/auth')
  await expect(page.getByRole('button', { name: /Войти через Google/ })).toBeVisible()
})

test('сессия переживает перезагрузку страницы (S8 WP-1)', async ({ page }) => {
  await page.goto('/auth')
  await page.getByPlaceholder('Email').fill(EMAIL)
  await page.getByPlaceholder('Пароль').fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page).toHaveURL(/\/discover/)

  // перезагрузка: bootstrap-refresh по httpOnly cookie восстанавливает сессию
  await page.reload()
  await expect(page).toHaveURL(/\/discover/)
  await expect(page.getByRole('heading', { name: 'Мои поездки' })).toBeVisible()
})

test('выход инвалидирует сессию (S8 WP-1)', async ({ page }) => {
  await page.goto('/auth')
  await page.getByPlaceholder('Email').fill(EMAIL)
  await page.getByPlaceholder('Пароль').fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page).toHaveURL(/\/discover/)

  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page).toHaveURL(/\/auth/)

  // после logout refresh-cookie отозвана: перезагрузка не возвращает сессию
  await page.goto('/discover')
  await expect(page).toHaveURL(/\/auth/)
})
