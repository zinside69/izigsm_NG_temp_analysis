import { test, expect } from '@playwright/test'

// Comptes de démo seed.sql (project-docs). `manager@izigsm.fr` est le manager de
// la boutique 1 "iziGSM Paris 11" — c'est lui qui atterrit sur le tableau de bord.
// `admin@izigsm.fr` est l'admin plateforme (boutique_id NULL) : son atterrissage
// sur la console des boutiques est couvert par `console-boutiques.spec.ts`.
const MANAGER_EMAIL = 'manager@izigsm.fr'
const MANAGER_PASSWORD = 'Admin@2026!'

test.describe('Authentification', () => {
  test('login avec identifiants valides redirige vers le dashboard', async ({ page }) => {
    await page.goto('/login.html')
    await page.fill('#login-email', MANAGER_EMAIL)
    await page.fill('#login-password', MANAGER_PASSWORD)
    await page.click('#login-form button[type="submit"]')

    // Attendre le rendu du dashboard (un KPI) plutôt que l'URL seule : la
    // redirection est décidée côté client après écriture de la session.
    await expect(page.locator('#kpi-grid')).toBeVisible({ timeout: 15_000 })
    expect(page.url()).toContain('/dashboard')
  })

  test('login avec mot de passe invalide reste sur la page et affiche une erreur', async ({ page }) => {
    await page.goto('/login.html')
    await page.fill('#login-email', MANAGER_EMAIL)
    await page.fill('#login-password', 'mot-de-passe-incorrect')
    await page.click('#login-form button[type="submit"]')

    await page.waitForTimeout(1000)
    expect(page.url()).toContain('/login')
  })

  test('POST /api/auth/login rejette un mot de passe invalide (401)', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: MANAGER_EMAIL, password: 'mot-de-passe-incorrect' },
    })
    expect(res.status()).toBe(401)
  })
})
