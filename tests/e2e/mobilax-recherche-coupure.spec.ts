/**
 * @file tests/e2e/mobilax-recherche-coupure.spec.ts
 * @description Recherche Mobilax « Par article » sur coupure réseau (todo.md 🟡 P3, trouvé le
 * 2026-09-14) : `api()` laisse passer le rejet de `fetch`, et `chercherMobilax()` n'avait qu'un
 * `finally` — « Recherche en cours chez Mobilax… » restait affiché indéfiniment. Même défaut que
 * celui corrigé sur `chercherGeneration()` (mobilax-generation.spec.ts, même message attendu).
 *
 * Aucun appel à Mobilax : la requête de recherche est coupée par `page.route(…).abort()`.
 * Boutique neuve par test.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

test.describe('Mobilax — recherche par article, réseau coupé', () => {
  test('message d\'erreur, jamais « Recherche en cours » figé ; bouton rendu', async ({ page, request }) => {
    await page.route('**/api/mobilax/produits?*', route => route.abort('internetdisconnected'))
    const tenant = await createTenantAdmin(request)
    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/stock')
    await page.click('#btn-mobilax')

    await page.fill('#mobilax-terme', 'ecran iphone 12')
    await page.click('#btn-mobilax-chercher')

    await expect(page.locator('#mobilax-message')).toContainText('injoignable', { timeout: 10_000 })
    await expect(page.locator('#mobilax-message')).not.toContainText('en cours')
    await expect(page.locator('#btn-mobilax-chercher')).toBeEnabled()
  })
})
