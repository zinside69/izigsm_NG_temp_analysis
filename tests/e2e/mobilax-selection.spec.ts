/**
 * @file tests/e2e/mobilax-selection.spec.ts
 * @description Import d'une sélection depuis la recherche fournisseur (chantier
 * `import-d-une-selection`). Ticket 02 : cases sur la page affichée, barre « N sélectionnés ·
 * durée », « Importer la sélection » par la boucle commune avec la « Qté en rayon » de chaque
 * ligne, bilan, saisie figée pendant l'import, échecs et restants restés cochés, rôles. Ticket 03 :
 * sélection gardée d'une page à l'autre (cases et quantités), nouvelle recherche et changement de
 * mode qui la vident, « Tout cocher » (page affichée), « Vider la sélection », confirmation
 * renforcée au-delà de 200.
 *
 * Réponses d'iziGSM simulées (`page.route()`, spec § couture 1) et horloge simulée
 * (`page.clock`) : aucun appel réel au fournisseur. `serviceWorkers: 'block'`
 * (playwright.config) est requis pour que `page.route()` voie les requêtes.
 */
import { test, expect, type Page } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter, MANAGER, TECHNICIEN } from './fixtures/comptes'

/** Page de résultats simulée : articles `ids`, fiche fournisseur 3. */
/** Articles simulés de la recherche, un par identifiant. */
const produitsDe = (ids: number[]) =>
  ids.map(id => ({ mobilax_id: id, nom: `Pièce ${id}`, ean13: null, prix_achat_ht: 10, stock: 5 }))
const pageDe = (ids: number[]) => ({ success: true, data: {
  fournisseur_id: 3, total: ids.length, page: 1, pages: 1, produits: produitsDe(ids),
} })

type ReponseImport = { status: number; json: unknown }
const IMPORT_OK = (id: number, famille = 'piece'): ReponseImport =>
  ({ status: 201, json: { success: true, data: { produit_id: 100 + id, famille } } })
const DEJA: ReponseImport = { status: 409, json: { success: false, code: 'deja_importe', error: 'Cette pièce est déjà dans votre stock.', data: { produit_id: 41 } } }
const INTROUVABLE: ReponseImport = { status: 404, json: { success: false, code: 'introuvable', error: 'Cette pièce n\'existe plus chez Mobilax.' } }

/** Case d'un article dans les résultats. */
const caseDe = (page: Page, id: number) => page.locator(`#mobilax-resultats input.mobilax-case[value="${id}"]`)
/** « Qté en rayon » de la ligne d'un article. */
const qteDe = (page: Page, id: number) =>
  page.locator('#mobilax-resultats tr', { has: page.locator(`input.mobilax-case[value="${id}"]`) }).locator('input.mobilax-qte')

/**
 * Manager d'une boutique neuve (l'inscription crée un `role_id` 2), fenêtre fournisseur en mode
 * « Par article », recherche simulée (page
 * de `ids`) ; import simulé par identifiant. Horloge installée AVANT toute navigation, figée
 * une fois les résultats affichés : seul `runFor()` fait partir l'article suivant. Rend les corps
 * reçus par la route d'import, dans l'ordre.
 */
async function rechercheSimulee(page: Page, request: any, ids: number[], reponses: Record<number, ReponseImport> = {}) {
  return recherchePaginee(page, request, [ids], reponses)
}

/**
 * Recherche simulée sur plusieurs pages (ticket 03) : `pages[n]` = identifiants de la page n + 1,
 * rendue selon le paramètre `page=` de la requête — manager d'une boutique neuve, horloge figée une
 * fois la page 1 affichée (`rechercheSimulee()` en est le cas à une page). Rend les corps reçus par
 * la route d'import.
 */
async function recherchePaginee(page: Page, request: any, pages: number[][], reponses: Record<number, ReponseImport> = {}) {
  await page.clock.install()
  await page.route('**/api/mobilax/produits?*', route => {
    const n = Number(new URL(route.request().url()).searchParams.get('page') ?? '1')
    return route.fulfill({ json: { success: true, data: {
      fournisseur_id: 3, total: pages.flat().length, page: n, pages: pages.length,
      produits: produitsDe(pages[n - 1] ?? []),
    } } })
  })
  const corps: Array<Record<string, unknown>> = []
  await page.route('**/api/mobilax/import*', async route => {
    const recu = route.request().postDataJSON()
    corps.push(recu)
    await route.fulfill(reponses[recu.mobilax_id] ?? IMPORT_OK(recu.mobilax_id))
  })
  const tenant = await createTenantAdmin(request)
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/stock')
  await page.click('#btn-mobilax')
  await page.fill('#mobilax-terme', 'ecran')
  await page.click('#btn-mobilax-chercher')
  await expect(page.locator('#mobilax-resultats tr')).toHaveCount(pages[0].length)
  await page.clock.pauseAt(Date.now() + 60_000)
  return corps
}

/** Précédente / Suivante, puis attente de la page annoncée. */
async function allerPage(page: Page, sens: 'suivante' | 'precedente', attendue: string) {
  await page.click(`#btn-mobilax-${sens}`)
  await expect(page.locator('#mobilax-page')).toContainText(attendue)
}

test.describe('Mobilax — import d\'une sélection (page affichée)', () => {
  test('barre de sélection : nombre et durée estimée, masquée tant que rien n\'est coché', async ({ page, request }) => {
    await rechercheSimulee(page, request, [1, 2, 3])
    const barre = page.locator('#mobilax-selection')
    await expect(barre).toBeHidden()

    await caseDe(page, 1).check()
    await caseDe(page, 3).check()
    await expect(barre).toBeVisible()
    await expect(barre).toContainText('2 sélectionnés')
    await expect(barre).toContainText('moins d\'une minute')
    await expect(page.locator('#btn-selection-importer')).toBeEnabled()

    await caseDe(page, 1).uncheck()
    await expect(barre).toContainText('1 sélectionné')
    await caseDe(page, 3).uncheck()
    await expect(barre).toBeHidden()
  })

  test('import : quantité de chaque ligne envoyée (vide → non envoyée), un départ toutes les 3 s, bilan et lien ; échec resté coché', async ({ page, request }) => {
    const corps = await rechercheSimulee(page, request, [1, 2, 3, 4], { 1: IMPORT_OK(1), 2: DEJA, 3: INTROUVABLE, 4: IMPORT_OK(4, 'accessoire') })
    for (const id of [1, 2, 3, 4]) await caseDe(page, id).check()
    await qteDe(page, 1).fill('5')
    await qteDe(page, 2).fill('')      // vide → stock initial par défaut, rien d'envoyé
    await qteDe(page, 3).fill('0')
    await qteDe(page, 4).fill('2')

    await page.click('#btn-selection-importer')
    const progression = page.locator('#mobilax-import-progression')
    await expect(progression).toContainText('1 / 4')
    await page.clock.runFor(2_900)
    // Temps RÉEL laissé à une requête partie trop tôt pour atteindre la route (vu en revue)
    await page.waitForTimeout(300)
    expect(corps).toHaveLength(1)      // 20 imports par minute au plus
    await page.clock.runFor(100)
    await expect(progression).toContainText('2 / 4')
    await page.clock.runFor(3_000)
    await expect(progression).toContainText('3 / 4')   // l'échec de l'article 3 n'arrête pas la boucle
    await page.clock.runFor(3_000)

    const bilan = page.locator('#mobilax-bilan')
    await expect(bilan).toContainText('Import terminé')
    await expect(bilan).toContainText('2 importés')
    await expect(bilan).toContainText('1 déjà dans votre stock')
    await expect(bilan).toContainText('1 échec')
    await expect(bilan).toContainText('Pièce 3')
    await expect(bilan).toContainText('Accessoire : 1')
    await expect(bilan.locator('a[href="/stock?fournisseur_id=3"]')).toHaveCount(1)
    // Quantités en nombre ; ligne vide → aucune quantité envoyée
    expect(corps).toEqual([
      { mobilax_id: 1, quantite_en_rayon: 5 },
      { mobilax_id: 2 },
      { mobilax_id: 3, quantite_en_rayon: 0 },
      { mobilax_id: 4, quantite_en_rayon: 2 },
    ])

    // Importés et déjà en stock décochés ; l'échec reste coché, prêt à être relancé
    await expect(caseDe(page, 1)).not.toBeChecked()
    await expect(caseDe(page, 2)).not.toBeChecked()
    await expect(caseDe(page, 3)).toBeChecked()
    await expect(caseDe(page, 4)).not.toBeChecked()
    await expect(page.locator('#mobilax-selection')).toContainText('1 sélectionné')
  })

  test('quantité invalide sur une ligne cochée : rien ne part, les lignes sont signalées ; corrigée, l\'import part', async ({ page, request }) => {
    const corps = await rechercheSimulee(page, request, [1, 2, 3, 4])
    for (const id of [1, 2, 3, 4]) await caseDe(page, id).check()
    await qteDe(page, 2).fill('1.5')
    await qteDe(page, 3).fill('-1')
    // Texte non numérique : `value` d'un champ nombre le rend vide — seul `validity.badInput` le voit
    await qteDe(page, 4).fill('')
    await qteDe(page, 4).pressSequentially('1e')

    await page.click('#btn-selection-importer')
    const message = page.locator('#mobilax-message')
    await expect(message).toContainText('quantité')
    for (const id of [2, 3, 4]) await expect(qteDe(page, id)).toHaveAttribute('aria-invalid', 'true')
    await expect(qteDe(page, 1)).not.toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('#mobilax-import')).toBeHidden()
    await page.clock.runFor(10_000)
    expect(corps).toHaveLength(0)

    // Saisies corrigées : le signalement disparaît, l'import part
    for (const id of [2, 3, 4]) await qteDe(page, id).fill('1')
    await page.click('#btn-selection-importer')
    await expect(page.locator('#mobilax-import-progression')).toContainText('1 / 4')
    await expect(message).not.toContainText('invalide')
  })

  test('pendant l\'import : cases figées, boutons d\'import désactivés, recherche libre', async ({ page, request }) => {
    await rechercheSimulee(page, request, [1, 2, 3])
    await caseDe(page, 1).check()
    await caseDe(page, 2).check()
    await page.click('#btn-selection-importer')
    await expect(page.locator('#mobilax-import-progression')).toContainText('1 / 2')

    await expect(caseDe(page, 1)).toBeDisabled()
    await expect(caseDe(page, 3)).toBeDisabled()
    await expect(page.locator('#btn-selection-importer')).toBeDisabled()
    await expect(page.locator('#mobilax-resultats button[data-mobilax-id="3"]')).toBeDisabled()

    // Recherche libre (story 18) : les nouvelles lignes naissent figées, elles aussi
    await page.fill('#mobilax-terme', 'batterie')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-message')).toContainText('3 pièces trouvées')
    await expect(caseDe(page, 3)).toBeDisabled()
    await expect(page.locator('#mobilax-resultats button[data-mobilax-id="3"]')).toBeDisabled()

    // Fin de l'import : tout redevient saisissable
    await page.clock.runFor(3_000)
    await expect(page.locator('#mobilax-bilan')).toContainText('Import terminé')
    await expect(caseDe(page, 3)).toBeEnabled()
    await expect(page.locator('#mobilax-resultats button[data-mobilax-id="3"]')).toBeEnabled()
  })

  test('interrompu : restants restés cochés, « Importer la sélection » ne relance qu\'eux', async ({ page, request }) => {
    const corps = await rechercheSimulee(page, request, [1, 2, 3])
    for (const id of [1, 2, 3]) await caseDe(page, id).check()
    await page.click('#btn-selection-importer')
    await expect(page.locator('#mobilax-import-progression')).toContainText('1 / 3')

    await page.click('#btn-import-interrompre')
    const bilan = page.locator('#mobilax-bilan')
    await expect(bilan).toContainText('Import interrompu')
    await expect(bilan).toContainText('2 articles restants')
    await expect(bilan).toContainText('restent cochés')
    await expect(caseDe(page, 1)).not.toBeChecked()
    await expect(caseDe(page, 2)).toBeChecked()
    await expect(caseDe(page, 3)).toBeChecked()
    await expect(page.locator('#mobilax-selection')).toContainText('2 sélectionnés')

    await page.click('#btn-selection-importer')
    await expect(page.locator('#mobilax-import-progression')).toContainText('1 / 2')
    await page.clock.runFor(3_000)
    await expect(bilan).toContainText('Import terminé')
    expect(corps.map(c => c.mobilax_id)).toEqual([1, 2, 3])
  })

  test('pendant l\'import d\'une sélection : aucune génération ne peut être préparée ni lancée', async ({ page, request }) => {
    await rechercheSimulee(page, request, [1, 2])
    await caseDe(page, 1).check()
    await caseDe(page, 2).check()
    await page.click('#btn-selection-importer')
    await expect(page.locator('#mobilax-import-progression')).toContainText('1 / 2')

    await expect(page.locator('#btn-generation-importer')).toBeDisabled()
    await page.check('#mobilax-mode-generation')
    await page.fill('#mobilax-terme', 'iPhone 17')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-message')).toContainText('Un import est en cours')
    await expect(page.locator('#mobilax-series-liste label')).toHaveCount(0)
  })

  test('recherche relancée pendant l\'import : le bilan ne prétend pas que les restants sont cochés', async ({ page, request }) => {
    await rechercheSimulee(page, request, [1, 2, 3])
    for (const id of [1, 2, 3]) await caseDe(page, id).check()
    await page.click('#btn-selection-importer')
    await expect(page.locator('#mobilax-import-progression')).toContainText('1 / 3')

    // Nouvelle recherche (story 18) : les lignes cochées quittent la page, la sélection avec elles
    await page.fill('#mobilax-terme', 'batterie')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-message')).toContainText('3 pièces trouvées')
    await page.click('#btn-import-interrompre')

    const bilan = page.locator('#mobilax-bilan')
    await expect(bilan).toContainText('Import interrompu')
    await expect(bilan).toContainText('2 articles restants')
    await expect(bilan).toContainText('relancez la recherche')
    await expect(bilan).not.toContainText('restent cochés')
    await expect(caseDe(page, 2)).not.toBeChecked()
    await expect(page.locator('#mobilax-selection')).toBeHidden()
  })

  test('manager : cases et boutons d\'import', async ({ page }) => {
    await page.route('**/api/mobilax/produits?*', route => route.fulfill({ json: pageDe([1, 2]) }))
    await seConnecter(page, MANAGER)
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/stock')
    await page.click('#btn-mobilax')
    await page.fill('#mobilax-terme', 'ecran')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-resultats input.mobilax-case')).toHaveCount(2)
    await expect(page.locator('#mobilax-resultats button[data-mobilax-id]')).toHaveCount(2)
    await caseDe(page, 2).check()
    await expect(page.locator('#mobilax-selection')).toContainText('1 sélectionné')
  })

  test('technicien : ni cases, ni barre, ni boutons d\'import', async ({ page }) => {
    await page.route('**/api/mobilax/produits?*', route => route.fulfill({ json: pageDe([1, 2]) }))
    await seConnecter(page, TECHNICIEN)
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/stock')
    await page.click('#btn-mobilax')
    await page.fill('#mobilax-terme', 'ecran')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-resultats tr')).toHaveCount(2)
    await expect(page.locator('#mobilax-resultats')).toContainText('Pièce 1')

    await expect(page.locator('#mobilax-resultats input.mobilax-case')).toHaveCount(0)
    await expect(page.locator('#mobilax-resultats button[data-mobilax-id]')).toHaveCount(0)
    await expect(page.locator('#mobilax-resultats input.mobilax-qte')).toHaveCount(0)
    await expect(page.locator('#mobilax-selection')).toBeHidden()
    await expect(page.locator('#mobilax-tout-cocher')).toBeHidden()
  })
})

// ── Ticket 03 : sélection sur plusieurs pages, « Tout cocher », « Vider », confirmation > 200 ──

test.describe('Mobilax — import d\'une sélection (plusieurs pages)', () => {
  test('sélection gardée d\'une page à l\'autre : cases et quantités réaffichées, compteur sur toute la sélection', async ({ page, request }) => {
    await recherchePaginee(page, request, [[1, 2], [3, 4]])
    const barre = page.locator('#mobilax-selection')
    await caseDe(page, 1).check()
    await qteDe(page, 1).fill('7')

    await allerPage(page, 'suivante', 'Page 2 / 2')
    await expect(caseDe(page, 3)).not.toBeChecked()
    await expect(barre).toContainText('1 sélectionné')
    await caseDe(page, 4).check()
    await expect(barre).toContainText('2 sélectionnés')

    await allerPage(page, 'precedente', 'Page 1 / 2')
    await expect(caseDe(page, 1)).toBeChecked()
    await expect(caseDe(page, 2)).not.toBeChecked()
    await expect(qteDe(page, 1)).toHaveValue('7')

    // Quantité retenue = dernière valeur vue sur la ligne
    await qteDe(page, 1).fill('8')
    await allerPage(page, 'suivante', 'Page 2 / 2')
    await expect(caseDe(page, 4)).toBeChecked()
    await allerPage(page, 'precedente', 'Page 1 / 2')
    await expect(qteDe(page, 1)).toHaveValue('8')
    await expect(barre).toContainText('2 sélectionnés')
  })

  test('nouvelle recherche : la sélection est vidée', async ({ page, request }) => {
    await recherchePaginee(page, request, [[1, 2], [3, 4]])
    const barre = page.locator('#mobilax-selection')
    await caseDe(page, 1).check()
    await allerPage(page, 'suivante', 'Page 2 / 2')
    await caseDe(page, 3).check()
    await expect(barre).toContainText('2 sélectionnés')

    await page.fill('#mobilax-terme', 'batterie')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-page')).toContainText('Page 1 / 2')
    await expect(barre).toBeHidden()
    await expect(caseDe(page, 1)).not.toBeChecked()
    await allerPage(page, 'suivante', 'Page 2 / 2')
    await expect(caseDe(page, 3)).not.toBeChecked()
  })

  test('« Tout cocher » : coche et décoche la page affichée seulement', async ({ page, request }) => {
    await recherchePaginee(page, request, [[1, 2], [3, 4]])
    const barre = page.locator('#mobilax-selection')
    const tout = page.locator('#mobilax-tout-cocher')
    // Une ligne sur deux cochée : « Tout cocher » à l'état mixte, pas coché
    await caseDe(page, 1).check()
    await expect(tout).toHaveJSProperty('indeterminate', true)
    await expect(tout).not.toBeChecked()
    await tout.check()
    await expect(caseDe(page, 1)).toBeChecked()
    await expect(caseDe(page, 2)).toBeChecked()
    await expect(barre).toContainText('2 sélectionnés')

    await allerPage(page, 'suivante', 'Page 2 / 2')
    await expect(caseDe(page, 3)).not.toBeChecked()
    await expect(caseDe(page, 4)).not.toBeChecked()
    await expect(tout).not.toBeChecked()

    await allerPage(page, 'precedente', 'Page 1 / 2')
    await expect(tout).toBeChecked()
    await tout.uncheck()
    await expect(caseDe(page, 1)).not.toBeChecked()
    await expect(caseDe(page, 2)).not.toBeChecked()
    await expect(barre).toBeHidden()
  })

  test('« Vider la sélection » : plus rien de coché, sur aucune page', async ({ page, request }) => {
    await recherchePaginee(page, request, [[1, 2], [3, 4]])
    const barre = page.locator('#mobilax-selection')
    await caseDe(page, 1).check()
    await allerPage(page, 'suivante', 'Page 2 / 2')
    await caseDe(page, 3).check()
    await expect(barre).toContainText('2 sélectionnés')

    await page.click('#btn-selection-vider')
    await expect(barre).toBeHidden()
    await expect(caseDe(page, 3)).not.toBeChecked()
    await allerPage(page, 'precedente', 'Page 1 / 2')
    await expect(caseDe(page, 1)).not.toBeChecked()
  })

  test('import d\'une sélection répartie sur deux pages : quantités retenues envoyées, « Tout cocher » figé', async ({ page, request }) => {
    const corps = await recherchePaginee(page, request, [[1, 2], [3, 4]])
    await caseDe(page, 1).check()
    await qteDe(page, 1).fill('5')
    await allerPage(page, 'suivante', 'Page 2 / 2')
    await caseDe(page, 4).check()
    await qteDe(page, 4).fill('2')

    await page.click('#btn-selection-importer')
    await expect(page.locator('#mobilax-import-progression')).toContainText('1 / 2')
    await expect(page.locator('#mobilax-tout-cocher')).toBeDisabled()
    await expect(page.locator('#btn-selection-vider')).toBeDisabled()
    await page.clock.runFor(3_000)

    await expect(page.locator('#mobilax-bilan')).toContainText('2 importés')
    // L'article de la page 1 part avec la quantité saisie là-bas, bien que la page 2 soit affichée
    expect(corps).toEqual([{ mobilax_id: 1, quantite_en_rayon: 5 }, { mobilax_id: 4, quantite_en_rayon: 2 }])
    await expect(caseDe(page, 4)).not.toBeChecked()
    await expect(page.locator('#mobilax-selection')).toBeHidden()
    await expect(page.locator('#mobilax-tout-cocher')).toBeEnabled()
  })

  test('au-delà de 200 articles : confirmation renforcée, rien ne part avant « Lancer l\'import »', async ({ page, request }) => {
    const pages = [0, 1, 2].map(p => Array.from({ length: 100 }, (_, i) => p * 100 + i + 1))
    const corps = await recherchePaginee(page, request, pages)
    const tout = page.locator('#mobilax-tout-cocher')
    await tout.check()
    await allerPage(page, 'suivante', 'Page 2 / 3')
    await tout.check()
    await allerPage(page, 'suivante', 'Page 3 / 3')
    await tout.check()
    await expect(page.locator('#mobilax-selection')).toContainText('300 sélectionnés')

    const confirmation = page.locator('#mobilax-confirmation')
    await page.click('#btn-selection-importer')
    await expect(confirmation).toBeVisible()
    await expect(confirmation).toContainText('300 articles')
    await expect(confirmation).toContainText('environ 15 min')
    await page.clock.runFor(10_000)
    expect(corps).toHaveLength(0)

    await page.click('#btn-import-annuler')
    await expect(confirmation).toBeHidden()
    await page.click('#btn-selection-importer')
    await page.click('#btn-import-lancer')
    await expect(confirmation).toBeHidden()
    await expect(page.locator('#mobilax-import-progression')).toContainText('1 / 300')
    await expect.poll(() => corps.length).toBe(1)
  })

  test('confirmation renforcée ouverte : « Vider la sélection » la referme', async ({ page, request }) => {
    const pages = [0, 1, 2].map(p => Array.from({ length: 100 }, (_, i) => p * 100 + i + 1))
    const corps = await recherchePaginee(page, request, pages)
    const tout = page.locator('#mobilax-tout-cocher')
    await tout.check()
    await allerPage(page, 'suivante', 'Page 2 / 3')
    await tout.check()
    await allerPage(page, 'suivante', 'Page 3 / 3')
    await tout.check()
    await page.click('#btn-selection-importer')
    await expect(page.locator('#mobilax-confirmation')).toBeVisible()

    await page.click('#btn-selection-vider')
    await expect(page.locator('#mobilax-confirmation')).toBeHidden()
    await expect(page.locator('#mobilax-selection')).toBeHidden()
    expect(corps).toHaveLength(0)
  })

  test('changer de mode oublie la sélection', async ({ page, request }) => {
    await recherchePaginee(page, request, [[1, 2], [3, 4]])
    await caseDe(page, 1).check()
    await expect(page.locator('#mobilax-selection')).toContainText('1 sélectionné')

    await page.check('#mobilax-mode-generation')
    await page.check('#mobilax-mode-article')
    await expect(page.locator('#mobilax-selection')).toBeHidden()
    await page.fill('#mobilax-terme', 'ecran')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-resultats tr')).toHaveCount(2)
    await expect(caseDe(page, 1)).not.toBeChecked()
  })

  test('texte non numérique retenu : réaffiché en erreur au retour sur la page, import bloqué', async ({ page, request }) => {
    const corps = await recherchePaginee(page, request, [[1, 2], [3, 4]])
    await caseDe(page, 1).check()
    // `value` d'un champ nombre rend vide un texte illisible : seul `validity.badInput` le voit
    await qteDe(page, 1).fill('')
    await qteDe(page, 1).pressSequentially('1e')
    await allerPage(page, 'suivante', 'Page 2 / 2')
    await allerPage(page, 'precedente', 'Page 1 / 2')

    // Le texte ne peut être réaffiché : la ligne l'est en erreur, jamais comme un champ vide valide
    await expect(qteDe(page, 1)).toHaveAttribute('aria-invalid', 'true')
    await expect(qteDe(page, 1)).toHaveCSS('border-color', 'rgb(180, 35, 24)')
    await page.click('#btn-selection-importer')
    await expect(page.locator('#mobilax-message')).toContainText('Pièce 1')
    await page.clock.runFor(10_000)
    expect(corps).toHaveLength(0)
  })
})
