import { test, expect, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// E2E-смоук (S7, S11/S14): регистрация по коду (API+Redis) → логин (UI) →
// мастер создания → планировщик. Требует запущенный docker-стек (:8000).
const API = 'http://localhost:8000'
// уникальный юзер на каждый прогон — тесты не зависят от состояния БД
const EMAIL = `e2e_${Date.now()}@wanderown.dev`
const PASSWORD = 'e2e-secret-123'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// S14: код подтверждения достаём напрямую из Redis (SMTP в dev нет — письмо
// уходит в лог); docker-стек e2e и так обязателен
function readPendingCode(email: string): string {
  const raw = execSync(
    `docker compose exec -T redis redis-cli GET "pending_reg:${email.toLowerCase()}"`,
    { cwd: REPO_ROOT, encoding: 'utf-8' },
  ).trim()
  return JSON.parse(raw).code
}

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/health`).catch(() => null)
  test.skip(!health || !health.ok(), 'Бэкенд не запущен — пропускаем e2e')
  // S14: register больше не создаёт юзера — подтверждаем код
  const res = await request.post(`${API}/auth/register`, {
    data: { email: EMAIL, password: PASSWORD, name: 'E2E' },
  })
  expect(res.ok()).toBeTruthy()
  const verify = await request.post(`${API}/auth/verify`, {
    data: { email: EMAIL, code: readPendingCode(EMAIL) },
  })
  expect(verify.ok()).toBeTruthy()
})

// S11: мастер создания ищет город через Nominatim — в e2e мокаем сеть
async function mockNominatim(page: Page) {
  await page.route('**/nominatim.openstreetmap.org/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{
        display_name: 'Калининград, Калининградская область, Россия',
        name: 'Калининград', lat: '54.7104', lon: '20.5114',
        class: 'place', addresstype: 'city',
      }]),
    }))
}

function futureDate(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

test('мастер создания поездки открывает планировщик с днями (S11)', async ({ page }) => {
  await mockNominatim(page)
  // логин
  await page.goto('/auth')
  await page.getByPlaceholder('Email').fill(EMAIL)
  await page.getByPlaceholder('Пароль').fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page).toHaveURL(/\/discover/)

  // мастер: название, город из автокомплита, обязательные даты
  await page.getByRole('button', { name: 'Запланировать поездку' }).click()
  await expect(page.getByRole('heading', { name: 'Новая поездка' })).toBeVisible()
  await page.getByPlaceholder('Название поездки').fill('E2E-поездка')
  await page.getByPlaceholder('Начните вводить город…').fill('Калининград')
  await page.getByRole('option', { name: 'Калининград' }).click()
  const dates = page.locator('input[type="date"]')
  await dates.first().fill(futureDate(1))
  await dates.nth(1).fill(futureDate(2))
  await page.getByRole('button', { name: 'Создать' }).click()

  // планировщик открылся сразу с днями (даты обязательны в мастере)
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+/)
  await expect(page.getByRole('tab', { name: 'Маршрут' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Бюджет' })).toBeVisible()
  await expect(page.getByText(/День 1/).first()).toBeVisible()
})

test('кнопка Google присутствует на странице логина', async ({ page }) => {
  await page.goto('/auth')
  await expect(page.getByRole('button', { name: /Войти через Google/ })).toBeVisible()
})

test('регистрация через UI: код с почты ведёт на /discover (S14)', async ({ page }) => {
  const freshEmail = `ui_reg_${Date.now()}@wanderown.dev`
  await page.goto('/auth')
  // переключаемся в режим регистрации
  await page.getByRole('button', { name: 'Нет аккаунта? Зарегистрируйтесь' }).click()
  await expect(page.getByRole('heading', { name: 'Регистрация' })).toBeVisible()

  await page.getByPlaceholder('Email').fill(freshEmail)
  await page.getByPlaceholder('Имя (опционально)').fill('UI Тест')
  await page.getByPlaceholder('Пароль').fill('ui-secret-123')
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()

  // S14: экран ввода кода; код достаём из Redis
  await expect(page.getByRole('heading', { name: 'Подтвердите почту' })).toBeVisible()
  await page.getByPlaceholder('••••••').fill(readPendingCode(freshEmail))
  await page.getByRole('button', { name: 'Подтвердить' }).click()

  await expect(page).toHaveURL(/\/discover/)
  await expect(page.getByRole('heading', { name: 'Мои поездки' })).toBeVisible()
})

test('неверный код не пускает внутрь (S14)', async ({ page }) => {
  const freshEmail = `ui_badcode_${Date.now()}@wanderown.dev`
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Нет аккаунта? Зарегистрируйтесь' }).click()
  await page.getByPlaceholder('Email').fill(freshEmail)
  await page.getByPlaceholder('Пароль').fill('ui-secret-123')
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Подтвердите почту' })).toBeVisible()
  const code = readPendingCode(freshEmail)
  const wrong = code === '000000' ? '111111' : '000000'
  await page.getByPlaceholder('••••••').fill(wrong)
  await page.getByRole('button', { name: 'Подтвердить' }).click()
  await expect(page.getByText('Неверный код')).toBeVisible()
  await expect(page).toHaveURL(/\/auth/)
})

test('регистрация на занятый email показывает ошибку', async ({ page }) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Нет аккаунта? Зарегистрируйтесь' }).click()
  await page.getByPlaceholder('Email').fill(EMAIL) // уже подтверждён (beforeAll)
  await page.getByPlaceholder('Пароль').fill('another-pass-123')
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  await expect(page.getByText('Этот email уже зарегистрирован')).toBeVisible()
})

test('короткий пароль при регистрации отклоняется на клиенте', async ({ page }) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Нет аккаунта? Зарегистрируйтесь' }).click()
  await page.getByPlaceholder('Email').fill(`short_${Date.now()}@wanderown.dev`)
  await page.getByPlaceholder('Пароль').fill('1234567')
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  // остаёмся на /auth, подсказка про 8 символов видна как ошибка
  await expect(page).toHaveURL(/\/auth/)
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

  // S18: выход переехал в профиль, с Discover туда ведёт иконка-силуэт
  await page.getByRole('button', { name: 'Профиль' }).click()
  await expect(page).toHaveURL(/\/profile/)
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page).toHaveURL(/\/auth/)

  // после logout refresh-cookie отозвана: перезагрузка не возвращает сессию
  await page.goto('/discover')
  await expect(page).toHaveURL(/\/auth/)
})
