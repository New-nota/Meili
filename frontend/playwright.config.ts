import { defineConfig } from '@playwright/test'

// E2E против живого стека: бэкенд должен быть поднят (docker compose up),
// фронтенд Playwright поднимет сам (webServer ниже).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
