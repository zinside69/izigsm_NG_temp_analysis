/**
 * @file playwright.config.ts
 * @description Gate de non-régression E2E — invoqué par la loop-engineering (npm run
 * test:e2e) et utilisable manuellement. Cible le serveur `wrangler pages dev` local
 * (dist/ + D1 local), jamais la prod.
 */
import { defineConfig, devices } from '@playwright/test'

const PORT = process.env.PW_PORT || '3000'
const BASE_URL = process.env.PW_BASE_URL || `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // D1 local partagé entre tests — pas de parallélisation par défaut
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Pas de executablePath par défaut : Playwright résout lui-même le
        // Chromium qu'il a installé (`npx playwright install`), quel que soit
        // l'OS (`%LOCALAPPDATA%\ms-playwright` sous Windows, `~/.cache/ms-playwright`
        // sous Linux/Mac). PLAYWRIGHT_CHROMIUM_PATH reste disponible pour cibler
        // un binaire précis (ex. CI avec un chemin pinné).
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {},
      },
    },
  ],

  // Ne démarre pas le serveur automatiquement : la loop (SKILL.md étape 5) et le
  // développeur local le lancent explicitement, car il dépend des migrations D1
  // locales déjà appliquées (npx wrangler d1 migrations apply --local + seed.sql).
  // webServer volontairement absent ici.
})
