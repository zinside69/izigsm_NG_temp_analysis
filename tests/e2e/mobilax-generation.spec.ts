/**
 * @file tests/e2e/mobilax-generation.spec.ts
 * @description Mode « Par génération » de la recherche Mobilax (ticket 01, chantier
 * `import-par-generation`) : « iPhone 17 » propose les séries de la génération, toutes cochées ;
 * « iPhone 1 » n'en propose aucune, avec un message qui dit quoi saisir.
 *
 * Appelle la VRAIE préproduction Mobilax — le catalogue des séries seul (sans quota) et une
 * connexion par test, aucune recherche de produits, aucun import. Clé lue dans `.dev.vars`
 * sans `import 'node:fs'` (tsconfig sans types Node). Sans clé, sauté plutôt que faussement
 * vert. Boutique neuve par test.
 */
import { test, expect, type Page } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

function cleMobilaxPreprod(): string | null {
  try {
    const proc = (globalThis as any).process
    const vars: string = proc.getBuiltinModule('node:fs').readFileSync(`${proc.cwd()}/.dev.vars`, 'utf8')
    return /^\s*MOBILAX_API_KEY\s*=\s*"?([^"\r\n]+)"?/m.exec(vars)?.[1] ?? null
  } catch { return null }
}

/** Boutique neuve, fiche fournisseur Mobilax par le vrai formulaire, fenêtre Mobilax en mode génération. */
async function modeGeneration(page: Page, request: any, cle: string) {
  const tenant = await createTenantAdmin(request)
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/fournisseurs')
  await page.click('#btn-new-fournisseur')
  await page.fill('#f-nom', 'MOBILAX')
  await page.fill('#f-api-key', cle)
  await page.check('#f-api-mobilax')
  await page.click('#btn-save-fournisseur')
  await expect(page.locator('#modal-fournisseur')).toBeHidden({ timeout: 15_000 })
  await page.goto('/stock')
  await page.click('#btn-mobilax')
  await page.check('#mobilax-mode-generation')
}

test.describe('Mobilax — mode « Par génération »', () => {
  test('« iPhone 17 » : séries de la génération, toutes cochées, rien d\'autre', async ({ page, request }) => {
    const cle = cleMobilaxPreprod()
    test.skip(!cle, 'MOBILAX_API_KEY absente de .dev.vars — catalogue réel inaccessible')
    await modeGeneration(page, request, cle!)

    await page.fill('#mobilax-terme', 'iPhone 17')
    await page.click('#btn-mobilax-chercher')
    const series = page.locator('#mobilax-series-liste label')
    await expect(series.first()).toBeVisible({ timeout: 20_000 })
    // Toutes de la génération 17 (jamais 17e, 16, 11…), et toutes cochées
    for (const nom of await series.allInnerTexts()) expect(nom.trim()).toMatch(/^iPhone 17( |$)/i)
    await expect(page.locator('#mobilax-series-liste input.mobilax-serie:not(:checked)')).toHaveCount(0)
    // La série de base elle-même est proposée
    await expect(series.filter({ hasText: /^\s*iPhone 17\s*$/i })).toHaveCount(1)
    // La zone du mode « Par article » est masquée
    await expect(page.locator('#mobilax-zone-articles')).toBeHidden()
  })

  // ── Réponses d'iziGSM simulées (`page.route()`, spec § couture 3) : l'écran se prouve sans
  // clé Mobilax ni fiche fournisseur. `serviceWorkers: 'block'` (playwright.config) est requis.

  /** Boutique neuve, fenêtre Mobilax en mode génération — sans fiche Mobilax. */
  async function modeGenerationSimule(page: Page, request: any) {
    const tenant = await createTenantAdmin(request)
    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/stock')
    await page.click('#btn-mobilax')
    await page.check('#mobilax-mode-generation')
  }

  test('réponse simulée : chaque série proposée est cochée, nom échappé', async ({ page, request }) => {
    await page.route('**/api/mobilax/series?*', route => route.fulfill({ json: { success: true, data: { series: [
      { id: 2358, nom: 'iPhone 17' }, { id: 2359, nom: 'iPhone 17 <b>Air</b>' },
    ] } } }))
    await modeGenerationSimule(page, request)
    await page.fill('#mobilax-terme', 'iPhone 17')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-series-liste input.mobilax-serie:checked')).toHaveCount(2)
    await expect(page.locator('#mobilax-series-liste b')).toHaveCount(0)
    await expect(page.locator('#mobilax-series-liste')).toContainText('iPhone 17 <b>Air</b>')
  })

  test('réseau coupé : message d\'erreur, jamais « recherche en cours » figé', async ({ page, request }) => {
    await page.route('**/api/mobilax/series?*', route => route.abort('internetdisconnected'))
    await modeGenerationSimule(page, request)
    await page.fill('#mobilax-terme', 'iPhone 17')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-message')).toContainText('Mobilax', { timeout: 10_000 })
    await expect(page.locator('#mobilax-message')).not.toContainText('en cours')
    await expect(page.locator('#mobilax-message')).not.toContainText('Recherche des séries')
    await expect(page.locator('#btn-mobilax-chercher')).toBeEnabled()
  })

  test('« iPhone 1 » : aucune série, message qui dit quoi saisir', async ({ page, request }) => {
    const cle = cleMobilaxPreprod()
    test.skip(!cle, 'MOBILAX_API_KEY absente de .dev.vars — catalogue réel inaccessible')
    await modeGeneration(page, request, cle!)

    await page.fill('#mobilax-terme', 'iPhone 1')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-message')).toContainText('Aucune série Mobilax', { timeout: 20_000 })
    await expect(page.locator('#mobilax-message')).toContainText('iPhone 17')
    await expect(page.locator('#mobilax-series-liste label')).toHaveCount(0)
  })
})
