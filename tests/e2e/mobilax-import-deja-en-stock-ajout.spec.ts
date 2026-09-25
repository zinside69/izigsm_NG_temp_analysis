/**
 * @file tests/e2e/mobilax-import-deja-en-stock-ajout.spec.ts
 * @description Pièce déjà en stock à l'import : ajout de quantité en un clic, description reprise
 * si vide, rattachement sans appel fournisseur (ticket 18 du chantier `vente-lit-catalogue`).
 *
 * ⚠ ÉCRIT SANS ÊTRE JOUÉ par l'agent qui l'a produit (T-002, socle d'orchestration : les
 * contrôles du socle ne jouent aucun E2E). À rejouer sur la vraie base locale, **migration 0050
 * appliquée** (`produits.mobilax_id`), avant tout report — et à voir rouge d'abord : chaque test
 * échoue sur le code d'avant le ticket (bouton absent, route 404, description inchangée,
 * `mobilax_id` absent, second import en `cle_refusee`/`sans_fournisseur`).
 *
 * Deux familles :
 *  - « Ajouter N au stock » et lot : fournisseur SIMULÉ à l'écran (`page.route()` sur la
 *    recherche et l'import), mais la route d'ajout et la base sont RÉELLES — le stock et le
 *    mouvement se relisent par l'API.
 *  - description / rattachement / zéro appel : VRAIE préproduction Mobilax (1 connexion, 1
 *    recherche, 1 fiche par test, sous les quotas), clé lue dans `.dev.vars`. Sans clé, sautés.
 *    Le « zéro appel » se prouve par l'absurde : le second import est rejoué après avoir
 *    SUPPRIMÉ la fiche fournisseur — tout appel à Mobilax échouerait (`sans_fournisseur`), la
 *    réponse « déjà en stock » ne peut venir que de la reconnaissance locale par `mobilax_id`.
 */
import { test, expect, type Page } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

const MOTIF_AJOUT = 'Import fournisseur — déjà en stock'

function cleMobilaxPreprod(): string | null {
  try {
    const proc = (globalThis as any).process
    const vars: string = proc.getBuiltinModule('node:fs').readFileSync(`${proc.cwd()}/.dev.vars`, 'utf8')
    return /^\s*MOBILAX_API_KEY\s*=\s*"?([^"\r\n]+)"?/m.exec(vars)?.[1] ?? null
  } catch { return null }
}

// ─── « Ajouter N au stock » (fournisseur simulé, route d'ajout et base réelles) ──────────────

/**
 * Boutique neuve avec un produit à 4 pièces ; recherche et import simulés (l'import répond
 * « déjà en stock » avec ce produit). Rend le jeton, l'identifiant du produit, et le compteur
 * des appels reçus par la route d'ajout.
 */
async function pieceDejaEnStock(page: Page, request: any) {
  const tenant = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }
  const cree = await request.post('/api/produits', {
    headers, data: { nom: 'E2E batterie déjà en stock', sku: '3000000000017', stock_actuel: 4, stock_minimum: 0 },
  })
  expect(cree.status(), await cree.text()).toBe(201)
  const produitId = (await cree.json()).id

  await page.route('**/api/mobilax/produits?*', route => route.fulfill({ json: { success: true, data: {
    fournisseur_id: 3, total: 1, page: 1, pages: 1,
    produits: [{ mobilax_id: 17, nom: 'Batterie iPhone 12', ean13: '3000000000017', prix_achat_ht: 5.8, stock: 12 }],
  } } }))
  await page.route('**/api/mobilax/import*', route => route.fulfill({
    status: 409,
    json: { success: false, code: 'deja_importe', error: 'Cette pièce est déjà dans votre stock.', data: { produit_id: produitId } },
  }))
  const ajouts: unknown[] = []
  // AVANT (2026-09-24, premiere execution reelle de cet E2E ecrit par l'agent T-002) : await page.route('**/api/mobilax/produits/*/ajout-stock', async route => {
  // apiPost pose ?boutique_id= sur toute ecriture : le motif glob ne voyait jamais la requete.
  await page.route(/\/api\/mobilax\/produits\/\d+\/ajout-stock(\?|$)/, async route => {
    ajouts.push(route.request().postDataJSON())
    await route.fallback()   // la vraie route répond
  })

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/stock')
  await page.click('#btn-mobilax')
  await page.fill('#mobilax-terme', 'batterie')
  await page.click('#btn-mobilax-chercher')
  await expect(page.locator('#mobilax-resultats tr')).toHaveCount(1)
  return { tenant, headers, produitId, ajouts }
}

async function ficheProduit(request: any, headers: Record<string, string>, id: number) {
  const r = await request.get(`/api/produits/${id}`, { headers })
  expect(r.status(), await r.text()).toBe(200)
  return (await r.json()).data
}

test.describe('Stock — pièce déjà en stock : « Ajouter N au stock »', () => {
  test('quantité saisie : bouton dans la fiche, rien ajouté avant le clic, un clic = UNE entrée tracée', async ({ page, request }) => {
    const { headers, produitId, ajouts } = await pieceDejaEnStock(page, request)
    await page.locator('#mobilax-resultats input.mobilax-qte').fill('5')
    await page.locator('#mobilax-resultats button[data-mobilax-id="17"]').click()

    // La fiche existante s'ouvre, avec l'offre — le stock n'a pas bougé (règle du 2026-09-12)
    await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
    const bouton = page.locator('#btn-stock-ajout-import')
    await expect(bouton).toHaveText('Ajouter 5 au stock')
    expect((await ficheProduit(request, headers, produitId)).stock_actuel).toBe(4)
    expect(ajouts).toHaveLength(0)

    await bouton.click()
    await expect(page.locator('#stock-ajout-import-texte')).toContainText('4 → 9')
    await expect(page.locator('#stock-qty')).toHaveValue('9')
    // Le bouton a disparu : un second clic est impossible
    await expect(page.locator('#stock-ajout-import-action')).toBeHidden()
    await expect(bouton).toBeHidden()

    // Relecture : stock à 9, et UN seul mouvement sous le motif de l'ajout
    const fiche = await ficheProduit(request, headers, produitId)
    expect(fiche.stock_actuel).toBe(9)
    const ajoutes = fiche.mouvements.filter((m: any) => m.motif === MOTIF_AJOUT)
    expect(ajoutes.map((m: any) => [m.type_mouvement, m.quantite, m.stock_avant, m.stock_apres])).toEqual([['entree', 5, 4, 9]])
    // AVANT (2026-09-25, point 1 de la relecture : l'offre envoie sa clé d'ajout) : expect(ajouts).toEqual([{ quantite: 5 }])
    expect(ajouts).toEqual([{ quantite: 5, cle: expect.stringMatching(/^[0-9a-f-]{36}$/) }])
  })

  test('réponse perdue après l\'ajout : le second clic renvoie la MÊME clé, le stock n\'est compté qu\'une fois', async ({ page, request }) => {
    const { headers, produitId, ajouts } = await pieceDejaEnStock(page, request)
    // Le premier envoi atteint le vrai serveur (qui ajoute), puis sa réponse est coupée : c'est
    // le cas qui doublait le stock quand seul l'écran empêchait le second clic.
    let premier = true
    await page.route(/\/api\/mobilax\/produits\/\d+\/ajout-stock(\?|$)/, async route => {
      if (!premier) return route.fallback()
      premier = false
      // Servi ici sans `fallback()` : la route du harnais ne le verra pas, on le consigne nous-mêmes
      ajouts.push(route.request().postDataJSON())
      await route.fetch()
      await route.abort('connectionreset')
    })
    await page.locator('#mobilax-resultats input.mobilax-qte').fill('5')
    await page.locator('#mobilax-resultats button[data-mobilax-id="17"]').click()
    await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')

    const bouton = page.locator('#btn-stock-ajout-import')
    await bouton.click()
    await expect(page.locator('#stock-ajout-import-texte')).toContainText('Connexion perdue')
    // Le serveur a bien ajouté, l'écran ne le sait pas : le bouton reste proposé
    expect((await ficheProduit(request, headers, produitId)).stock_actuel).toBe(9)
    await expect(bouton).toBeEnabled()

    await bouton.click()
    await expect(page.locator('#stock-ajout-import-texte')).toContainText('4 → 9')
    const fiche = await ficheProduit(request, headers, produitId)
    expect(fiche.stock_actuel).toBe(9)
    expect(fiche.mouvements.filter((m: any) => m.motif === MOTIF_AJOUT)).toHaveLength(1)
    // Deux envois, une seule clé
    expect(ajouts).toHaveLength(2)
    expect((ajouts[1] as any).cle).toBe((ajouts[0] as any).cle)
  })

  test('sans quantité saisie : aucune offre', async ({ page, request }) => {
    const { headers, produitId, ajouts } = await pieceDejaEnStock(page, request)
    await page.locator('#mobilax-resultats input.mobilax-qte').fill('')
    await page.locator('#mobilax-resultats button[data-mobilax-id="17"]').click()

    await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
    await expect(page.locator('#stock-ajout-import')).toBeHidden()
    await expect(page.locator('#btn-stock-ajout-import')).toBeHidden()
    expect(ajouts).toHaveLength(0)
    expect((await ficheProduit(request, headers, produitId)).stock_actuel).toBe(4)
  })

  test('l\'offre ne survit pas à la fiche : rouverte plus tard, la fiche n\'en porte plus', async ({ page, request }) => {
    const { produitId } = await pieceDejaEnStock(page, request)
    await page.locator('#mobilax-resultats input.mobilax-qte').fill('5')
    await page.locator('#mobilax-resultats button[data-mobilax-id="17"]').click()
    await expect(page.locator('#btn-stock-ajout-import')).toBeVisible()
    await page.locator('#modal-stock .modal-close').click()

    await page.evaluate((id: number) => (globalThis as any).editStock(id), produitId)
    await expect(page.locator('#stock-ajout-import')).toBeHidden()
  })

  test('import en lot : la pièce déjà en stock est comptée « déjà en stock », sans bouton ni ajout', async ({ page, request }) => {
    const { headers, produitId, ajouts } = await pieceDejaEnStock(page, request)
    await page.locator('#mobilax-resultats input.mobilax-case[value="17"]').check()
    await page.locator('#mobilax-resultats input.mobilax-qte').fill('5')   // quantité préremplie du lot
    await page.click('#btn-selection-importer')

    const bilan = page.locator('#mobilax-bilan')
    await expect(bilan).toContainText('Import terminé')
    await expect(bilan).toContainText('1 déjà dans votre stock')
    // AVANT (2026-09-24, premiere execution reelle de cet E2E ecrit par l'agent T-002) : await expect(bilan).not.toContainText('échec')
    // le bilan affiche toujours « N échec » : « pas le mot échec » ne pouvait jamais passer.
    await expect(bilan).toContainText('0 échec')
    await expect(page.locator('#stock-ajout-import')).toBeHidden()
    expect(ajouts).toHaveLength(0)
    expect((await ficheProduit(request, headers, produitId)).stock_actuel).toBe(4)
  })

  test('route d\'ajout : le produit d\'une autre boutique est introuvable, son stock ne bouge pas', async ({ request }) => {
    const chez = await createTenantAdmin(request)
    const autre = await createTenantAdmin(request)
    const cree = await request.post('/api/produits', {
      headers: { Authorization: `Bearer ${autre.accessToken}` }, data: { nom: 'E2E produit d\'autrui', stock_actuel: 4, stock_minimum: 0 },
    })
    const idAutrui = (await cree.json()).id

    const r = await request.post(`/api/mobilax/produits/${idAutrui}/ajout-stock`, {
      // AVANT (2026-09-25, point 1 : clé d'ajout obligatoire — sans elle, 400 et non plus 404) : headers: { Authorization: `Bearer ${chez.accessToken}` }, data: { quantite: 5 },
      headers: { Authorization: `Bearer ${chez.accessToken}` }, data: { quantite: 5, cle: 'e2e-cle-autrui-0001' },
    })
    expect(r.status()).toBe(404)
    expect((await ficheProduit(request, { Authorization: `Bearer ${autre.accessToken}` }, idAutrui)).stock_actuel).toBe(4)
  })

  test('route d\'ajout : même clé rejouée → premier résultat rendu, un seul mouvement ; clé réutilisée ailleurs → 409', async ({ request }) => {
    const tenant = await createTenantAdmin(request)
    const headers = { Authorization: `Bearer ${tenant.accessToken}` }
    const cree = await request.post('/api/produits', { headers, data: { nom: 'E2E rejeu clé', stock_actuel: 4, stock_minimum: 0 } })
    const id = (await cree.json()).id
    const url = `/api/mobilax/produits/${id}/ajout-stock`
    const cle = 'e2e-cle-rejeu-0001'

    const un = await request.post(url, { headers, data: { quantite: 5, cle } })
    expect(un.status(), await un.text()).toBe(200)
    expect((await un.json()).data).toEqual({ stock_avant: 4, stock_apres: 9, deja_applique: false })
    const deux = await request.post(url, { headers, data: { quantite: 5, cle } })
    expect((await deux.json()).data).toEqual({ stock_avant: 4, stock_apres: 9, deja_applique: true })
    const autreQuantite = await request.post(url, { headers, data: { quantite: 3, cle } })
    expect(autreQuantite.status()).toBe(409)

    const fiche = await ficheProduit(request, headers, id)
    expect(fiche.stock_actuel).toBe(9)
    expect(fiche.mouvements.filter((m: any) => m.motif === MOTIF_AJOUT)).toHaveLength(1)
  })
})

// ─── Description, rattachement, zéro appel (VRAIE préproduction Mobilax) ─────────────────────

/**
 * Boutique neuve avec sa fiche fournisseur Mobilax (clé de préproduction), puis la première pièce
 * de « ecran iphone 12 » lue par l'API — mobilax_id, EAN, nom réels. Rend aussi l'id de la fiche.
 */
async function boutiqueMobilaxReelle(page: Page, request: any, cle: string) {
  const tenant = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/fournisseurs')
  await page.click('#btn-new-fournisseur')
  await page.fill('#f-nom', 'Mobilax')
  await page.fill('#f-api-key', cle)
  await page.check('#f-api-mobilax')
  await page.click('#btn-save-fournisseur')
  await expect(page.locator('#modal-fournisseur')).toBeHidden({ timeout: 15_000 })

  const recherche = await request.get('/api/mobilax/produits?q=ecran%20iphone%2012', { headers })
  expect(recherche.status(), await recherche.text()).toBe(200)
  const { fournisseur_id, produits } = (await recherche.json()).data
  const piece = produits.find((p: any) => p.ean13)
  expect(piece, 'une pièce avec EAN en préproduction').toBeTruthy()
  return { tenant, headers, fournisseurId: fournisseur_id as number, piece }
}

test.describe('Import Mobilax réel — pièce déjà en stock', () => {
  test('description vide reprise, rattachement, puis second import « déjà en stock » SANS Mobilax', async ({ page, request }) => {
    const cle = cleMobilaxPreprod()
    test.skip(!cle, 'MOBILAX_API_KEY absente de .dev.vars — import réel impossible')
    const { headers, fournisseurId, piece } = await boutiqueMobilaxReelle(page, request, cle!)

    // Produit saisi à la main : l'EAN tapé comme SKU, aucune description, aucun lien fournisseur
    const cree = await request.post('/api/produits', {
      headers, data: { nom: 'E2E saisi à la main', sku: piece.ean13, stock_actuel: 3, stock_minimum: 0 },
    })
    expect(cree.status(), await cree.text()).toBe(201)
    const produitId = (await cree.json()).id

    // 1er import : reconnu par l'EAN, « déjà en stock », jamais de quantité ajoutée
    const premier = await request.post('/api/mobilax/import', { headers, data: { mobilax_id: piece.mobilax_id, quantite_en_rayon: 7 } })
    expect(premier.status()).toBe(409)
    expect((await premier.json()).data.produit_id).toBe(produitId)

    const rattache = await ficheProduit(request, headers, produitId)
    expect(rattache.stock_actuel).toBe(3)                        // règle du 2026-09-12 : rien d'ajouté
    expect(rattache.description, 'description vide reprise du fournisseur').toBeTruthy()
    expect(rattache.description).not.toMatch(/<[a-z]/i)          // texte brut, jamais le HTML du fournisseur
    expect(rattache.fournisseur_id).toBe(fournisseurId)
    expect(rattache.reference_fournisseur).toBeTruthy()
    expect(rattache.mobilax_id).toBe(piece.mobilax_id)

    // Zéro appel Mobilax au second import : la fiche fournisseur est supprimée — un appel échouerait
    // en `sans_fournisseur` (422). Seule la reconnaissance locale par `mobilax_id` peut répondre 409.
    const suppr = await request.delete(`/api/fournisseurs/${fournisseurId}`, { headers })
    expect(suppr.status(), await suppr.text()).toBeLessThan(300)
    const second = await request.post('/api/mobilax/import', { headers, data: { mobilax_id: piece.mobilax_id } })
    expect(second.status()).toBe(409)
    expect(await second.json()).toMatchObject({ code: 'deja_importe', data: { produit_id: produitId } })
  })

  test('description saisie à la main : jamais écrasée par celle du fournisseur', async ({ page, request }) => {
    const cle = cleMobilaxPreprod()
    test.skip(!cle, 'MOBILAX_API_KEY absente de .dev.vars — import réel impossible')
    const { headers, piece } = await boutiqueMobilaxReelle(page, request, cle!)

    const cree = await request.post('/api/produits', {
      headers, data: { nom: 'E2E avec notes', sku: piece.ean13, stock_minimum: 0, description: 'Note de l\'atelier : compatible 12 mini' },
    })
    expect(cree.status(), await cree.text()).toBe(201)
    const produitId = (await cree.json()).id

    const r = await request.post('/api/mobilax/import', { headers, data: { mobilax_id: piece.mobilax_id } })
    expect(r.status()).toBe(409)
    const fiche = await ficheProduit(request, headers, produitId)
    expect(fiche.description).toBe('Note de l\'atelier : compatible 12 mini')
    // Rattaché malgré tout : l'identifiant est posé, l'import suivant reconnaîtra la pièce
    expect(fiche.mobilax_id).toBe(piece.mobilax_id)
  })
})
