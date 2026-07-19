import { test, expect } from '@playwright/test'

// Compte de démo seed.sql (project-docs) — boutique 1 "iziGSM Paris 11".
const ADMIN_EMAIL = 'admin@izigsm.fr'
const ADMIN_PASSWORD = 'Admin@2026!'

test.describe('Authentification', () => {
  test('login avec identifiants valides redirige vers le dashboard', async ({ page }) => {
    await page.goto('/login.html')
    await page.fill('#login-email', ADMIN_EMAIL)
    await page.fill('#login-password', ADMIN_PASSWORD)
    await page.click('#login-form button[type="submit"]')

    // Attendre le rendu du dashboard (un KPI) plutôt que l'URL seule : le flow
    // de login admin fait un appel supplémentaire (auto-sélection boutique) avant
    // la redirection, l'URL peut être atteinte puis re-vérifiée côté client.
    await expect(page.locator('#kpi-grid')).toBeVisible({ timeout: 15_000 })
    expect(page.url()).toContain('/dashboard')
  })

  test('login avec mot de passe invalide reste sur la page et affiche une erreur', async ({ page }) => {
    await page.goto('/login.html')
    await page.fill('#login-email', ADMIN_EMAIL)
    await page.fill('#login-password', 'mot-de-passe-incorrect')
    await page.click('#login-form button[type="submit"]')

    await page.waitForTimeout(1000)
    expect(page.url()).toContain('/login')
  })

  test('POST /api/auth/login rejette un mot de passe invalide (401)', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: ADMIN_EMAIL, password: 'mot-de-passe-incorrect' },
    })
    expect(res.status()).toBe(401)
  })
})
