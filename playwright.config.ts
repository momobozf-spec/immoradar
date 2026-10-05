import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests tegen een draaiende ImmoRadar met de demo-seed.
 *
 *   npm run db:seed
 *   npm run build && npm start        # in een tweede terminal
 *   npm run test:e2e
 *
 * De tests maken eigen gebruikers en kantoren aan met unieke adressen, zodat ze
 * herhaald kunnen draaien zonder opnieuw te seeden. Ze lopen na elkaar: ze delen
 * een database, en een vergrendelingstest naast een inlogtest is geen test meer.
 *
 * `PLAYWRIGHT_CHROMIUM_PATH` laat een vooraf geïnstalleerde Chromium gebruiken
 * (CI-images, sandboxes); anders: `npx playwright install chromium`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    locale: 'nl-BE',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
