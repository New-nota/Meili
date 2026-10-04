import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Общее для e2e-спеков (раньше копипастой в каждом файле). E2E идут против
// живого docker-стека: бэкенд :8000, фронт Playwright поднимает сам.
export const API = process.env.E2E_API ?? 'http://localhost:8000'
export const PASSWORD = 'e2e-secret-123'

// Папка, где поднят docker compose (оттуда дёргаем redis/backend). По
// умолчанию — корень этого репо; из git-воркдерева стек живёт в основной
// копии, тогда E2E_STACK_DIR=/путь/к/основной/копии.
export const STACK_DIR = process.env.E2E_STACK_DIR
    ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export function compose(args: string, input?: string): string {
    return execSync(`docker compose ${args}`, { cwd: STACK_DIR, input, encoding: 'utf-8' }).trim()
}

// S14: код подтверждения — из Redis (SMTP в dev нет, письмо уходит в лог)
export function readPendingCode(email: string): string {
    const raw = compose(`exec -T redis redis-cli GET "pending_reg:${email.toLowerCase()}"`)
    return JSON.parse(raw).code
}

/** Уникальный подтверждённый юзер на прогон — тесты не зависят от БД. */
export async function registerUser(request: APIRequestContext, email: string, name = 'E2E') {
    const res = await request.post(`${API}/auth/register`, { data: { email, password: PASSWORD, name } })
    expect(res.ok(), await res.text()).toBeTruthy()
    const verify = await request.post(`${API}/auth/verify`, {
        data: { email, code: readPendingCode(email) },
    })
    expect(verify.ok(), await verify.text()).toBeTruthy()
    return (await verify.json()).access_token as string
}

export async function backendUp(request: APIRequestContext): Promise<boolean> {
    const health = await request.get(`${API}/health`).catch(() => null)
    return !!health && health.ok()
}

export function futureDate(daysFromNow: number): string {
    const d = new Date(Date.now() + daysFromNow * 86_400_000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function login(page: Page, email: string) {
    await page.goto('/auth')
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Пароль').fill(PASSWORD)
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await expect(page).toHaveURL(/\/discover/)
}

// кнопка «Добавить» именно в строке нужного результата поиска (редизайн «Лес»:
// строка = иконка | название + адрес | кнопка)
export async function addFromSearch(page: Page, name: string) {
    await page.locator('div').filter({ has: page.getByText(name, { exact: true }) })
        .filter({ has: page.getByRole('button', { name: 'Добавить', exact: true }) })
        .last().getByRole('button', { name: 'Добавить', exact: true }).click()
}
