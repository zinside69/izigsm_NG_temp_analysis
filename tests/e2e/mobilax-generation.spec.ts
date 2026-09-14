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
    const nomsSeries = page.locator('#mobilax-series-liste .mobilax-serie-nom')
    for (const nom of await nomsSeries.allInnerTexts()) expect(nom.trim()).toMatch(/^iPhone 17( |$)/i)
    await expect(page.locator('#mobilax-series-liste input.mobilax-serie:not(:checked)')).toHaveCount(0)
    // La série de base elle-même est proposée
    await expect(nomsSeries.filter({ hasText: /^\s*iPhone 17\s*$/i })).toHaveCount(1)
    // La zone du mode « Par article » est masquée
    await expect(page.locator('#mobilax-zone-articles')).toBeHidden()

    // Ticket 02 : aperçu chiffré, lu chez Mobilax (1 recherche par série, aucun import). En
    // préproduction, les articles de l'iPhone 17 sont des accessoires (mesuré le 2026-09-12).
    await expect(page.locator('#mobilax-apercu')).toContainText(/\d+ articles? fournisseur/, { timeout: 30_000 })
    await expect(page.locator('#mobilax-apercu')).toContainText(/à importer/)
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

  // ── Ticket 02 : aperçu chiffré, réponses d'iziGSM simulées ──────────────────────

  const SERIES_17 = [{ id: 2358, nom: 'iPhone 17' }, { id: 2360, nom: 'iPhone 17 Pro' }]

  /** Séries et aperçu simulés ; `apercu` = corps de réponse de `/api/mobilax/apercu`, `statut` son code. */
  async function simulerGeneration(page: Page, apercu: unknown, statut = 200) {
    await page.route('**/api/mobilax/series?*', route => route.fulfill({ json: { success: true, data: { series: SERIES_17 } } }))
    await page.route('**/api/mobilax/apercu?*', route => route.fulfill({ status: statut, json: apercu }))
  }

  /** `n` articles de la série 2358, aucun déjà en stock. */
  const articlesSerie = (n: number) => Array.from({ length: n }, (_, i) =>
    ({ mobilax_id: 10_000 + i, reference: `R${i}`, nom: `Article ${i}`, series: [2358], deja_en_stock: false }))

  test('aperçu chiffré, puis décocher une série le recalcule (article commun gardé)', async ({ page, request }) => {
    await simulerGeneration(page, { success: true, data: {
      series: [{ id: 2358, nb_articles: 2 }, { id: 2360, nb_articles: 2 }],
      articles: [
        { mobilax_id: 1, reference: 'R1', nom: 'Coque 17', series: [2358], deja_en_stock: false },
        { mobilax_id: 2, reference: 'R2', nom: 'Verre 17/17 Pro', series: [2358, 2360], deja_en_stock: true },
        { mobilax_id: 3, reference: 'R3', nom: 'Coque 17 Pro', series: [2360], deja_en_stock: false },
      ],
    } })
    await modeGenerationSimule(page, request)
    await page.fill('#mobilax-terme', 'iPhone 17')
    await page.click('#btn-mobilax-chercher')

    const apercu = page.locator('#mobilax-apercu')
    await expect(apercu).toContainText('3 articles fournisseur')
    await expect(apercu).toContainText('1 déjà dans votre stock')
    await expect(apercu).toContainText('2 à importer')
    await expect(apercu).toContainText('moins d\'une minute')
    await expect(page.locator('#mobilax-series-liste label', { hasText: 'iPhone 17 Pro' })).toContainText('2 articles')

    // « pas le 17 Pro » : l'article commun reste, celui propre au 17 Pro sort
    await page.locator('#mobilax-series-liste input.mobilax-serie[value="2360"]').uncheck()
    await expect(apercu).toContainText('2 articles fournisseur')
    await expect(apercu).toContainText('1 déjà dans votre stock')
    await expect(apercu).toContainText('1 à importer')

    // Plus aucune série cochée : rien à importer, bouton inactif
    await page.locator('#mobilax-series-liste input.mobilax-serie[value="2358"]').uncheck()
    await expect(apercu).toContainText('0 à importer')
    await expect(page.locator('#btn-generation-importer')).toBeDisabled()
  })

  test('au-delà de 200 articles : confirmation renforcée avec la durée ; 200 ou moins : aucune', async ({ page, request }) => {
    await simulerGeneration(page, { success: true, data: { series: [{ id: 2358, nb_articles: 220 }, { id: 2360, nb_articles: 0 }], articles: articlesSerie(220) } })
    await modeGenerationSimule(page, request)
    await page.fill('#mobilax-terme', 'iPhone 17')
    await page.click('#btn-mobilax-chercher')
    // 220 × 3 s = 11 min
    await expect(page.locator('#mobilax-apercu')).toContainText('environ 11 min')
    await expect(page.locator('#mobilax-confirmation')).toBeHidden()
    await page.click('#btn-generation-importer')
    // Fenêtre Mobilax (`.modal-overlay`) toujours ouverte — opacité, jamais toBeVisible (CLAUDE.md)
    await expect(page.locator('#modal-mobilax')).toHaveCSS('opacity', '1')
    await expect(page.locator('#mobilax-confirmation')).toBeVisible()
    await expect(page.locator('#mobilax-confirmation')).toContainText('220 articles')
    await expect(page.locator('#mobilax-confirmation')).toContainText('environ 11 min')
    await expect(page.locator('#mobilax-confirmation')).toContainText('gardez cet onglet ouvert')

    // Décocher jusqu'à 200 ou moins referme la confirmation renforcée
    await page.locator('#mobilax-series-liste input.mobilax-serie[value="2358"]').uncheck()
    await expect(page.locator('#mobilax-confirmation')).toBeHidden()
  })

  test('200 articles pile : pas de confirmation renforcée', async ({ page, request }) => {
    await simulerGeneration(page, { success: true, data: { series: [{ id: 2358, nb_articles: 200 }, { id: 2360, nb_articles: 0 }], articles: articlesSerie(200) } })
    await modeGenerationSimule(page, request)
    await page.fill('#mobilax-terme', 'iPhone 17')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-apercu')).toContainText('200 à importer')
    await page.click('#btn-generation-importer')
    await expect(page.locator('#mobilax-confirmation')).toBeHidden()
  })

  test('quota atteint pendant l\'aperçu : message avec le délai', async ({ page, request }) => {
    await simulerGeneration(page, { success: false, code: 'quota', reessayer_dans_s: 42,
      error: 'Limite d\'appels Mobilax atteinte. Réessayez dans 42 s.' }, 429)
    await modeGenerationSimule(page, request)
    await page.fill('#mobilax-terme', 'iPhone 17')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-message')).toContainText('42 s')
    await expect(page.locator('#btn-generation-importer')).toBeDisabled()
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
