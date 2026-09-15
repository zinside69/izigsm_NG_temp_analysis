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

  // ── Ticket 03 : boucle d'import, progression, bilan — horloge simulée (`page.clock`) ──

  /** Réponse simulée de `POST /api/mobilax/import`, par identifiant d'article. */
  const REPONSES_IMPORT: Record<number, { status: number; json: unknown }> = {
    1: { status: 201, json: { success: true, data: { produit_id: 101, famille: 'piece' } } },
    2: { status: 409, json: { success: false, code: 'deja_importe', error: 'Cette pièce est déjà dans votre stock.', data: { produit_id: 41 } } },
    3: { status: 404, json: { success: false, code: 'introuvable', error: 'Cette pièce n\'existe plus chez Mobilax.' } },
    4: { status: 201, json: { success: true, data: { produit_id: 104, famille: 'accessoire' } } },
  }

  /**
   * Génération simulée de 4 articles (série 2358), import simulé article par article ; horloge
   * installée AVANT toute navigation. Rend les corps reçus par la route d'import, dans l'ordre.
   */
  async function importSimule(page: Page, request: any) {
    await page.clock.install()
    await simulerGeneration(page, { success: true, data: {
      fournisseur_id: 3,
      series: [{ id: 2358, nb_articles: 5 }, { id: 2360, nb_articles: 0 }],
      articles: [
        ...[1, 2, 3, 4].map(id => ({ mobilax_id: id, reference: `R${id}`, nom: `Article ${id}`, series: [2358], deja_en_stock: false })),
        // Déjà dans le stock à l'aperçu : jamais importé, mais compté au bilan
        { mobilax_id: 5, reference: 'R5', nom: 'Article 5', series: [2358], deja_en_stock: true },
      ],
    } })
    const corps: unknown[] = []
    await page.route('**/api/mobilax/import*', async route => {
      const recu = route.request().postDataJSON()
      corps.push(recu)
      await route.fulfill(REPONSES_IMPORT[recu.mobilax_id])
    })
    await modeGenerationSimule(page, request)
    await page.fill('#mobilax-terme', 'iPhone 17')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-apercu')).toContainText('4 à importer')
    // Temps figé à partir d'ici : seul runFor() fait partir l'article suivant
    await page.clock.pauseAt(Date.now() + 60_000)
    return corps
  }

  test('import : un départ toutes les 3 s, sans quantité, échec isolé, déjà en stock compté, bilan', async ({ page, request }) => {
    const corps = await importSimule(page, request)
    await page.click('#btn-generation-importer')

    const progression = page.locator('#mobilax-import-progression')
    await expect(progression).toContainText('1 / 4')
    expect(corps).toHaveLength(1)
    // Pas de second départ avant 3 s (20 imports par minute au plus)
    await page.clock.runFor(2_900)
    expect(corps).toHaveLength(1)
    await page.clock.runFor(100)
    await expect(progression).toContainText('2 / 4')
    await page.clock.runFor(3_000)
    await expect(progression).toContainText('3 / 4')   // l'échec de l'article 3 n'arrête pas la boucle
    await page.clock.runFor(3_000)
    await expect(progression).toContainText('4 / 4')

    // Import unitaire existant, SANS quantité en rayon (→ stock initial par défaut de la boutique)
    expect(corps).toEqual([{ mobilax_id: 1 }, { mobilax_id: 2 }, { mobilax_id: 3 }, { mobilax_id: 4 }])

    const journal = page.locator('#mobilax-import-journal')
    await expect(journal).toContainText('Article 1')
    await expect(journal).toContainText('Cette pièce n\'existe plus chez Mobilax.')

    const bilan = page.locator('#mobilax-bilan')
    await expect(bilan).toContainText('2 importés')
    // 1 déjà en stock à l'aperçu (article 5, jamais envoyé) + 1 `deja_importe` pendant l'import
    await expect(bilan).toContainText('2 déjà dans votre stock')
    await expect(bilan).toContainText('1 échec')
    await expect(bilan).toContainText('Article 3')
    await expect(bilan).toContainText('Pièce : 1')
    await expect(bilan).toContainText('Accessoire : 1')
    await expect(bilan.locator('a[href="/stock?fournisseur_id=3"]')).toHaveCount(1)
  })

  test('import en cours : chercher une pièce par article reste possible, la progression est gardée (story 14)', async ({ page, request }) => {
    await page.route('**/api/mobilax/produits?*', route => route.fulfill({ json: { success: true, data: {
      total: 1, page: 1, pages: 1,
      produits: [{ mobilax_id: 900, nom: 'Batterie comptoir', ean13: null, prix_achat_ht: 9, stock: 2 }],
    } } }))
    await importSimule(page, request)
    await page.click('#btn-generation-importer')
    await expect(page.locator('#mobilax-import-progression')).toContainText('1 / 4')

    await page.check('#mobilax-mode-article')
    // Zone d'import commune aux deux modes (ticket 01 import-d-une-selection) : progression et
    // « Interrompre » restent sous les yeux pendant la recherche par article
    await expect(page.locator('#mobilax-import')).toBeVisible()
    await expect(page.locator('#btn-import-interrompre')).toBeVisible()
    await page.fill('#mobilax-terme', 'batterie')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-resultats')).toContainText('Batterie comptoir')

    await page.check('#mobilax-mode-generation')
    await expect(page.locator('#mobilax-import')).toBeVisible()
    await expect(page.locator('#mobilax-import-progression')).toContainText('1 / 4')
  })

  test('import en cours : fermer l\'onglet déclenche l\'avertissement du navigateur', async ({ page, request }) => {
    await importSimule(page, request)
    await page.click('#btn-generation-importer')
    await expect(page.locator('#mobilax-import-progression')).toContainText('1 / 4')

    const dialogue = page.waitForEvent('dialog')
    await page.close({ runBeforeUnload: true })
    const d = await dialogue
    expect(d.type()).toBe('beforeunload')
    await d.dismiss()
  })

  test('page Stock filtrée sur un fournisseur : ?fournisseur_id= transmis à la liste, bandeau « Tout afficher »', async ({ page, request }) => {
    const demandes: string[] = []
    await page.route('**/api/produits?*', route => {
      demandes.push(route.request().url())
      return route.fulfill({ json: { success: true, data: [], pagination: { page: 1, limit: 200, total: 0, pages: 0 } } })
    })
    const tenant = await createTenantAdmin(request)
    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/stock?fournisseur_id=3')
    await expect(page.locator('#filtre-fournisseur')).toBeVisible()
    await expect(page.locator('#filtre-fournisseur a[href="/stock"]')).toHaveCount(1)
    await expect.poll(() => demandes.some(u => new URL(u).searchParams.get('fournisseur_id') === '3')).toBe(true)
  })

  // ── Ticket 04 : quota, panne du fournisseur, reprise — horloge simulée ──────────

  /** Réponse simulée d'un import : corps HTTP, ou coupure réseau côté navigateur. */
  type ReponseImport = { status: number; json: unknown } | 'coupure'
  const IMPORT_OK = (id: number): ReponseImport => ({ status: 201, json: { success: true, data: { produit_id: 100 + id, famille: 'piece' } } })
  const QUOTA = (delai?: number): ReponseImport => ({ status: 429, json: {
    success: false, code: 'quota',
    error: delai ? `Limite d'appels Mobilax atteinte. Réessayez dans ${delai} s.` : 'Limite d\'appels Mobilax atteinte. Réessayez dans quelques instants.',
    ...(delai ? { reessayer_dans_s: delai } : {}),
  } })
  const PANNE: ReponseImport = { status: 502, json: { success: false, code: 'indisponible', error: 'Mobilax ne répond pas pour le moment. Réessayez plus tard.' } }

  /** Aperçu simulé des articles `ids` (série 2358), `deja` marqués déjà dans le stock. */
  const apercuDe = (ids: number[], deja: number[] = []) => ({ success: true, data: {
    fournisseur_id: 3,
    series: [{ id: 2358, nb_articles: ids.length }, { id: 2360, nb_articles: 0 }],
    articles: ids.map(id => ({ mobilax_id: id, reference: `R${id}`, nom: `Article ${id}`, series: [2358], deja_en_stock: deja.includes(id) })),
  } })

  /**
   * Scénario d'import : horloge installée avant toute navigation ; `apercu()` relu à chaque
   * demande d'aperçu (la relance voit l'état « après import ») ; `reponses[id]` = réponses
   * successives de l'import de cet article, la dernière se répétant. Rend les identifiants
   * envoyés à la route d'import, dans l'ordre — une nouvelle tentative y apparaît deux fois.
   */
  async function scenarioImport(page: Page, request: any, apercu: () => unknown, reponses: Record<number, ReponseImport[]>) {
    await page.clock.install()
    await page.route('**/api/mobilax/series?*', route => route.fulfill({ json: { success: true, data: { series: SERIES_17 } } }))
    await page.route('**/api/mobilax/apercu?*', route => route.fulfill({ json: apercu() }))
    const envois: number[] = []
    await page.route('**/api/mobilax/import*', async route => {
      const id = route.request().postDataJSON().mobilax_id as number
      envois.push(id)
      const file = reponses[id]
      const r = file.length > 1 ? file.shift()! : file[0]
      if (r === 'coupure') return route.abort('internetdisconnected')
      return route.fulfill(r)
    })
    await modeGenerationSimule(page, request)
    await page.fill('#mobilax-terme', 'iPhone 17')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-apercu')).toContainText('à importer')
    // Temps figé : seul runFor() fait avancer les départs et le compte à rebours
    await page.clock.pauseAt(Date.now() + 60_000)
    return envois
  }

  /** Avance l'horloge seconde par seconde (chaque seconde du compte à rebours est un minuteur). */
  async function avancer(page: Page, secondes: number) {
    for (let s = 0; s < secondes; s++) await page.clock.runFor(1_000)
  }

  test('quota atteint : pause, compte à rebours du délai annoncé, puis reprise du même article', async ({ page, request }) => {
    const envois = await scenarioImport(page, request, () => apercuDe([1, 2, 3]),
      { 1: [IMPORT_OK(1)], 2: [QUOTA(34), IMPORT_OK(2)], 3: [IMPORT_OK(3)] })
    await page.click('#btn-generation-importer')
    const progression = page.locator('#mobilax-import-progression')
    const pause = page.locator('#mobilax-import-pause')
    await expect(progression).toContainText('1 / 3')

    await page.clock.runFor(3_000)
    await expect(pause).toContainText('Quota fournisseur atteint — reprise dans 34 s')
    await avancer(page, 1)
    await expect(pause).toContainText('reprise dans 33 s')
    await avancer(page, 32)
    await expect(pause).toContainText('reprise dans 1 s')
    // Jamais de nouvelle tentative avant la fin du compte à rebours
    expect(envois).toEqual([1, 2])

    await avancer(page, 1)
    await expect(progression).toContainText('2 / 3')
    await expect(pause).toBeHidden()
    expect(envois).toEqual([1, 2, 2])
    await page.clock.runFor(3_000)
    await expect(page.locator('#mobilax-bilan')).toContainText('3 importés')
  })

  test('quota atteint sans délai annoncé : arrêt et bilan, aucune nouvelle tentative', async ({ page, request }) => {
    const envois = await scenarioImport(page, request, () => apercuDe([1, 2, 3]),
      { 1: [IMPORT_OK(1)], 2: [QUOTA()], 3: [IMPORT_OK(3)] })
    await page.click('#btn-generation-importer')
    await expect(page.locator('#mobilax-import-progression')).toContainText('1 / 3')
    await page.clock.runFor(3_000)

    const bilan = page.locator('#mobilax-bilan')
    await expect(bilan).toContainText('Import arrêté')
    await expect(bilan).toContainText('Réessayez dans quelques instants')
    await expect(bilan).toContainText('2 articles restants')
    await avancer(page, 60)
    expect(envois).toEqual([1, 2])
  })

  test('fournisseur indisponible : arrêt, bilan partiel ; relancer la génération n\'importe que le manquant', async ({ page, request }) => {
    let apercu = apercuDe([1, 2, 3])
    const envois = await scenarioImport(page, request, () => apercu,
      { 1: [IMPORT_OK(1)], 2: [PANNE, IMPORT_OK(2)], 3: [IMPORT_OK(3)] })
    await page.click('#btn-generation-importer')
    const progression = page.locator('#mobilax-import-progression')
    await expect(progression).toContainText('1 / 3')
    await page.clock.runFor(3_000)

    const bilan = page.locator('#mobilax-bilan')
    await expect(bilan).toContainText('Import arrêté')
    await expect(bilan).toContainText('Mobilax ne répond pas')
    await expect(bilan).toContainText('1 importé')
    await expect(bilan).toContainText('2 articles restants')
    await avancer(page, 10)
    expect(envois).toEqual([1, 2])   // rien ne part après l'arrêt

    // Relance : le serveur compte désormais l'article 1 « déjà dans le stock » (anti-doublon 0046)
    apercu = apercuDe([1, 2, 3], [1])
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-apercu')).toContainText('2 à importer')
    await expect(page.locator('#mobilax-apercu')).toContainText('1 déjà dans votre stock')
    await page.click('#btn-generation-importer')
    await expect(progression).toContainText('1 / 2')
    await page.clock.runFor(3_000)
    await expect(progression).toContainText('2 / 2')
    expect(envois).toEqual([1, 2, 2, 3])
  })

  test('connexion perdue côté navigateur : arrêt avec un motif distinct d\'une panne du fournisseur', async ({ page, request }) => {
    const envois = await scenarioImport(page, request, () => apercuDe([1, 2, 3]),
      { 1: [IMPORT_OK(1)], 2: ['coupure'], 3: [IMPORT_OK(3)] })
    await page.click('#btn-generation-importer')
    await expect(page.locator('#mobilax-import-progression')).toContainText('1 / 3')
    await page.clock.runFor(3_000)

    const bilan = page.locator('#mobilax-bilan')
    await expect(bilan).toContainText('Import arrêté')
    await expect(bilan).toContainText('Connexion perdue')
    await expect(bilan).not.toContainText('Mobilax ne répond pas')
    await expect(bilan).toContainText('2 articles restants')
    await avancer(page, 10)
    expect(envois).toEqual([1, 2])
  })

  // ── « Interrompre » (ticket 01, chantier import-d-une-selection) — horloge simulée ──

  test('interrompre pendant un article : il finit son import, puis arrêt « Import interrompu » avec les restants', async ({ page, request }) => {
    const envois = await scenarioImport(page, request, () => apercuDe([1, 2, 3, 4]),
      { 1: [IMPORT_OK(1)], 2: [IMPORT_OK(2)], 3: [IMPORT_OK(3)], 4: [IMPORT_OK(4)] })
    // Import de l'article 2 retenu jusqu'au clic : l'interruption tombe pendant qu'il est en vol.
    // Enregistrée après scenarioImport(), cette route passe en premier puis lui rend la main.
    // `envois` n'est rempli qu'au `fallback`, donc après la libération : le départ se lit ici.
    let relacher!: () => void
    const retenue = new Promise<void>(r => { relacher = r })
    let deuxEnVol = false
    await page.route('**/api/mobilax/import*', async route => {
      if (route.request().postDataJSON().mobilax_id === 2) { deuxEnVol = true; await retenue }
      return route.fallback()
    })
    await page.click('#btn-generation-importer')
    const progression = page.locator('#mobilax-import-progression')
    await expect(progression).toContainText('1 / 4')
    await page.clock.runFor(3_000)
    await expect.poll(() => deuxEnVol).toBe(true)

    await page.click('#btn-import-interrompre')
    relacher()
    // L'article en cours n'est pas coupé : il est importé et compté
    await expect(progression).toContainText('2 / 4')
    const bilan = page.locator('#mobilax-bilan')
    await expect(bilan).toContainText('Import interrompu')
    await expect(bilan).not.toContainText('Import arrêté')
    await expect(bilan).toContainText('2 importés')
    await expect(bilan).toContainText('2 articles restants')
    await expect(page.locator('#btn-import-interrompre')).toBeHidden()
    await avancer(page, 10)
    expect(envois).toEqual([1, 2])   // rien ne part après l'interruption
  })

  test('interrompre entre deux articles : arrêt immédiat, sans attendre le départ suivant', async ({ page, request }) => {
    const envois = await scenarioImport(page, request, () => apercuDe([1, 2, 3, 4]),
      { 1: [IMPORT_OK(1)], 2: [IMPORT_OK(2)], 3: [IMPORT_OK(3)], 4: [IMPORT_OK(4)] })
    await page.click('#btn-generation-importer')
    await expect(page.locator('#mobilax-import-progression')).toContainText('1 / 4')

    // Article 1 fini, départ du 2 dans 3 s : aucune milliseconde d'horloge ne passe avant le bilan
    await page.click('#btn-import-interrompre')
    const bilan = page.locator('#mobilax-bilan')
    await expect(bilan).toContainText('Import interrompu')
    await expect(bilan).toContainText('1 importé')
    await expect(bilan).toContainText('3 articles restants')
    await avancer(page, 10)
    expect(envois).toEqual([1])
  })

  test('interrompre pendant une pause de quota : arrêt immédiat, sans attendre le compte à rebours', async ({ page, request }) => {
    const envois = await scenarioImport(page, request, () => apercuDe([1, 2, 3]),
      { 1: [IMPORT_OK(1)], 2: [QUOTA(34), IMPORT_OK(2)], 3: [IMPORT_OK(3)] })
    await page.click('#btn-generation-importer')
    await expect(page.locator('#mobilax-import-progression')).toContainText('1 / 3')
    await page.clock.runFor(3_000)
    const pause = page.locator('#mobilax-import-pause')
    await expect(pause).toContainText('reprise dans 34 s')

    // Aucune seconde d'horloge ne passe : l'arrêt ne doit rien au compte à rebours
    await page.click('#btn-import-interrompre')
    const bilan = page.locator('#mobilax-bilan')
    await expect(bilan).toContainText('Import interrompu')
    await expect(bilan).toContainText('1 importé')
    await expect(bilan).toContainText('2 articles restants')
    await expect(pause).toBeHidden()
    await avancer(page, 40)
    expect(envois).toEqual([1, 2])   // l'article en pause ne repart jamais
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
