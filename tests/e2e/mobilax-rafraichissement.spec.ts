/**
 * @file tests/e2e/mobilax-rafraichissement.spec.ts
 * @description Rafraîchissement manuel d'un produit importé (ticket 05 `integration-mobilax`,
 * amendement du 2026-09-27) — la fiche produit affiche « Actualiser » quand le SERVEUR expose la
 * capacité (`rafraichissable_par`, points 11 et 16), jamais devinée à l'écran (point 5) : la fiche
 * ne connaît aucune logique propre à Mobilax, elle nomme juste le fournisseur que le serveur lui
 * donne.
 *
 * Les règles d'écriture (isolation, prix de vente/CUMP/stock jamais touchés) sont prouvées sur
 * SQLite réel, `tests/rafraichissement-mobilax-sqlite.test.ts` — ce fichier ne couvre que le geste
 * d'écran (points 3, 4, 11 à 15) :
 *   - Groupe A, SANS clé ni réseau : un produit Mobilax est posé sur la vraie D1 locale par SQL
 *     (`creerProduitMobilaxLocal`, point 15 — aucune route n'écrit `mobilax_id` sans appeler
 *     Mobilax), puis `POST …/rafraichir` est simulé par `page.route()`. Prouve l'affichage, la
 *     survie du prix au formulaire, les trois messages d'erreur, et la visibilité par rôle.
 *   - Groupe B, VRAIE préproduction (points 7 et 10) : clé lue dans `.dev.vars`, sautée sans elle.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter, MANAGER, TECHNICIEN, obtenirToken } from './fixtures/comptes'
import { seConnecterAdminPlateforme, creerBoutique, choisirBoutique } from './fixtures/console-plateforme'
import { creerProduitMobilaxLocal, creerProduitMobilaxIdSansFournisseurMobilax } from './fixtures/mobilax-local'

/**
 * Clé de préproduction lue dans `.dev.vars` — `null` si absente (test sauté). Même parti pris que
 * `mobilax-recherche-stock.spec.ts` : pas de types Node dans ce dépôt, `process.getBuiltinModule()`
 * (Node ≥ 22.3) charge `fs` sans import statique.
 */
function cleMobilaxPreprod(): string | null {
  try {
    const proc = (globalThis as any).process
    const vars: string = proc.getBuiltinModule('node:fs').readFileSync(`${proc.cwd()}/.dev.vars`, 'utf8')
    return /^\s*MOBILAX_API_KEY\s*=\s*"?([^"\r\n]+)"?/m.exec(vars)?.[1] ?? null
  } catch { return null }
}

async function ficheProduit(request: APIRequestContext, headers: Record<string, string>, id: number) {
  const r = await request.get(`/api/produits/${id}`, { headers })
  expect(r.status(), await r.text()).toBe(200)
  return (await r.json()).data
}

/** Ouvre la fiche d'un produit — même geste que le bouton « Modifier » de la ligne du tableau. */
async function ouvrirFiche(page: Page, produitId: number) {
  await page.evaluate((id: number) => (globalThis as any).editStock(id), produitId)
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
}

test.describe('Stock — rafraîchissement manuel d\'une pièce fournisseur (sans clé ni réseau)', () => {
  test('bouton visible pour un manager, actualise le prix d\'achat, la marge et affiche le stock fournisseur', async ({ page, request }) => {
    const tenant = await createTenantAdmin(request)
    const headers = { Authorization: `Bearer ${tenant.accessToken}` }
    const { produitId } = await creerProduitMobilaxLocal(request, headers, tenant.boutiqueId, {
      nom: 'E2E écran à actualiser', prix_achat_ht: 10, prix_vente_ht: 25, mobilaxId: 900001,
    })
    await page.route(`**/api/mobilax/produits/${produitId}/rafraichir*`, route => route.fulfill({
      json: { success: true, data: { prix_achat_ht: 12.5, stock: 7 } },
    }))

    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/stock')
    await ouvrirFiche(page, produitId)

    const bouton = page.locator('#btn-stock-actualiser')
    await expect(bouton).toBeVisible()
    // Marge initiale : (25 - 10) / 25 * 100 = 60 %, calculée par le serveur (marge_pct)
    await expect(page.locator('#stock-marge')).toContainText('60')
    await expect(page.locator('#stock-fournisseur-stock')).toBeHidden()

    await bouton.click()
    await expect(page.locator('#stock-price-buy')).toHaveValue('12.5')
    // Prix de vente jamais touché ; marge recalculée : (25 - 12.5) / 25 * 100 = 50 %
    await expect(page.locator('#stock-price')).toHaveValue('25')
    await expect(page.locator('#stock-marge')).toContainText('50')
    await expect(page.locator('#stock-fournisseur-stock')).toContainText('Mobilax')
    await expect(page.locator('#stock-fournisseur-stock')).toContainText('7 en stock')
    await expect(bouton).toBeEnabled()
    await expect(page.locator('#btn-stock-actualiser-texte')).toHaveText('Actualiser')
  })

  test('Actualiser puis Enregistrer : la valeur revalidée survit à la relecture de la fiche (point 4 et 12)', async ({ page, request }) => {
    const tenant = await createTenantAdmin(request)
    const headers = { Authorization: `Bearer ${tenant.accessToken}` }
    const { produitId } = await creerProduitMobilaxLocal(request, headers, tenant.boutiqueId, {
      nom: 'E2E persistance actualisation', prix_achat_ht: 10, prix_vente_ht: 25, mobilaxId: 900002,
    })
    // Seule la route de rafraîchissement est simulée : « Enregistrer » part vers la vraie D1 locale.
    await page.route(`**/api/mobilax/produits/${produitId}/rafraichir*`, route => route.fulfill({
      json: { success: true, data: { prix_achat_ht: 15.75, stock: 3 } },
    }))

    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/stock')
    await ouvrirFiche(page, produitId)
    await page.click('#btn-stock-actualiser')
    await expect(page.locator('#stock-price-buy')).toHaveValue('15.75')

    await page.locator('#modal-stock').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.locator('#modal-stock')).toBeHidden()

    // Relu par une requête directe, jamais interceptée : la vraie base porte la valeur revalidée
    expect((await ficheProduit(request, headers, produitId)).prix_achat_ht).toBe(15.75)

    // Fiche rouverte à l'écran, depuis un GET /api/produits réel (loadStock() après saveStock())
    await ouvrirFiche(page, produitId)
    await expect(page.locator('#stock-price-buy')).toHaveValue('15.75')
  })

  test('quota Mobilax atteint (429) : message avec le délai, prix inchangé, bouton réutilisable', async ({ page, request }) => {
    const tenant = await createTenantAdmin(request)
    const headers = { Authorization: `Bearer ${tenant.accessToken}` }
    const { produitId } = await creerProduitMobilaxLocal(request, headers, tenant.boutiqueId, {
      nom: 'E2E quota', prix_achat_ht: 10, prix_vente_ht: 25, mobilaxId: 900003,
    })
    await page.route(`**/api/mobilax/produits/${produitId}/rafraichir*`, route => route.fulfill({
      status: 429, json: { success: false, error: 'Quota Mobilax atteint.', code: 'quota', reessayer_dans_s: 42 },
    }))

    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/stock')
    await ouvrirFiche(page, produitId)
    const bouton = page.locator('#btn-stock-actualiser')
    await bouton.click()

    await expect(page.locator('#stock-actualiser-message')).toContainText('42 s')
    await expect(page.locator('#stock-price-buy')).toHaveValue('10')
    await expect(bouton).toBeEnabled()
    await expect(page.locator('#btn-stock-actualiser-texte')).toHaveText('Actualiser')
  })

  test('Mobilax indisponible (502) : message affiché, prix inchangé, bouton réutilisable', async ({ page, request }) => {
    const tenant = await createTenantAdmin(request)
    const headers = { Authorization: `Bearer ${tenant.accessToken}` }
    const { produitId } = await creerProduitMobilaxLocal(request, headers, tenant.boutiqueId, {
      nom: 'E2E indisponible', prix_achat_ht: 10, prix_vente_ht: 25, mobilaxId: 900004,
    })
    await page.route(`**/api/mobilax/produits/${produitId}/rafraichir*`, route => route.fulfill({
      status: 502, json: { success: false, error: 'Mobilax est indisponible pour le moment.', code: 'indisponible' },
    }))

    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/stock')
    await ouvrirFiche(page, produitId)
    const bouton = page.locator('#btn-stock-actualiser')
    await bouton.click()

    await expect(page.locator('#stock-actualiser-message')).toContainText('indisponible')
    await expect(page.locator('#stock-price-buy')).toHaveValue('10')
    await expect(bouton).toBeEnabled()
  })

  test('coupure réseau pendant l\'actualisation : « connexion perdue », prix inchangé, bouton réutilisable', async ({ page, request }) => {
    const tenant = await createTenantAdmin(request)
    const headers = { Authorization: `Bearer ${tenant.accessToken}` }
    const { produitId } = await creerProduitMobilaxLocal(request, headers, tenant.boutiqueId, {
      nom: 'E2E coupure réseau', prix_achat_ht: 10, prix_vente_ht: 25, mobilaxId: 900005,
    })
    await page.route(`**/api/mobilax/produits/${produitId}/rafraichir*`, route => route.abort())

    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/stock')
    await ouvrirFiche(page, produitId)
    const bouton = page.locator('#btn-stock-actualiser')
    await bouton.click()

    await expect(page.locator('#stock-actualiser-message')).toContainText('Connexion perdue')
    await expect(page.locator('#stock-price-buy')).toHaveValue('10')
    await expect(bouton).toBeEnabled()
    await expect(page.locator('#btn-stock-actualiser-texte')).toHaveText('Actualiser')
  })
})

test.describe('Stock — visibilité du bouton Actualiser (rôles et capacité serveur)', () => {
  test('produit ordinaire (aucun fournisseur à API) : jamais de bouton', async ({ page, request }) => {
    const tenant = await createTenantAdmin(request)
    const headers = { Authorization: `Bearer ${tenant.accessToken}` }
    const cree = await request.post('/api/produits', {
      headers, data: { nom: 'E2E produit ordinaire', prix_achat_ht: 5, prix_vente_ht: 12 },
    })
    expect(cree.status(), await cree.text()).toBe(201)
    const produitId = (await cree.json()).id

    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/stock')
    await ouvrirFiche(page, produitId)
    await expect(page.locator('#btn-stock-actualiser')).toBeHidden()
  })

  test('mobilax_id posé mais fiche fournisseur non Mobilax (point 11, cas a) : jamais de bouton', async ({ page, request }) => {
    const tenant = await createTenantAdmin(request)
    const headers = { Authorization: `Bearer ${tenant.accessToken}` }
    const { produitId } = await creerProduitMobilaxIdSansFournisseurMobilax(request, headers, tenant.boutiqueId, {
      nom: 'E2E fournisseur non Mobilax', prix_achat_ht: 8, prix_vente_ht: 20, mobilaxId: 900006,
    })

    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/stock')
    await ouvrirFiche(page, produitId)
    await expect(page.locator('#btn-stock-actualiser')).toBeHidden()
  })

  test('technicien : aucun bouton sur un produit rafraîchissable (point 13)', async ({ page, request }) => {
    const managerHeaders = { Authorization: `Bearer ${await obtenirToken(request, MANAGER)}` }
    const { produitId } = await creerProduitMobilaxLocal(request, managerHeaders, 1, {
      nom: `E2E technicien ${Date.now()}`, prix_achat_ht: 9, prix_vente_ht: 22, mobilaxId: 900007,
    })

    await seConnecter(page, TECHNICIEN)
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/stock')
    await ouvrirFiche(page, produitId)
    await expect(page.locator('#btn-stock-actualiser')).toBeHidden()
  })

  test('admin plateforme avec une boutique sélectionnée : jamais de bouton, même sur un produit rafraîchissable (point 14)', async ({ page, request }) => {
    const { tenant, nomBoutique } = await creerBoutique(request)
    const headers = { Authorization: `Bearer ${tenant.accessToken}` }
    const { produitId } = await creerProduitMobilaxLocal(request, headers, tenant.boutiqueId, {
      nom: 'E2E admin plateforme', prix_achat_ht: 11, prix_vente_ht: 27, mobilaxId: 900008,
    })

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)
    await page.goto('/stock')
    await ouvrirFiche(page, produitId)
    await expect(page.locator('#btn-stock-actualiser')).toBeHidden()
  })
})

// ─── Vraie préproduction Mobilax (points 7 et 10) ────────────────────────────────────────────

test.describe('Stock — rafraîchissement réel en préproduction', () => {
  test('actualise réellement le prix d\'achat ; consigne ce que /full renvoie pour le stock', async ({ page, request }) => {
    const cle = cleMobilaxPreprod()
    test.skip(!cle, 'MOBILAX_API_KEY absente de .dev.vars — rafraîchissement réel impossible')

    const tenant = await createTenantAdmin(request)
    const headers = { Authorization: `Bearer ${tenant.accessToken}` }
    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })

    // Fiche fournisseur Mobilax réelle, par le vrai formulaire (comme mobilax-recherche-stock.spec.ts)
    await page.goto('/fournisseurs')
    await page.click('#btn-new-fournisseur')
    await page.fill('#f-nom', 'Mobilax')
    await page.fill('#f-api-key', cle!)
    await page.check('#f-api-mobilax')
    await page.click('#btn-save-fournisseur')
    await expect(page.locator('#modal-fournisseur')).toBeHidden({ timeout: 15_000 })

    // Import réel d'une pièce trouvable, pour obtenir un produit avec un vrai mobilax_id
    await page.goto('/stock')
    await page.click('#btn-mobilax')
    await page.fill('#mobilax-terme', 'ecran iphone 12')
    await page.click('#btn-mobilax-chercher')
    const premiere = page.locator('#mobilax-resultats tr').first()
    await expect(premiere).toBeVisible({ timeout: 20_000 })
    await premiere.getByRole('button', { name: 'Importer' }).click()
    await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1', { timeout: 20_000 })
    const produitId = Number(await page.locator('#stock-id').inputValue())

    // Prix d'achat modifié à la main, puis enregistré — pour prouver qu'Actualiser le fait revenir
    await page.fill('#stock-price-buy', '0.01')
    await page.locator('#modal-stock').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.locator('#modal-stock')).toBeHidden()

    await ouvrirFiche(page, produitId)
    await expect(page.locator('#stock-price-buy')).toHaveValue('0.01')
    const bouton = page.locator('#btn-stock-actualiser')
    await expect(bouton).toBeVisible()
    await bouton.click()

    const nouveauPrix = Number(await page.locator('#stock-price-buy').inputValue())
    expect(nouveauPrix).toBeGreaterThan(0)
    expect(nouveauPrix).not.toBe(0.01)

    // Point 10 : le stock Mobilax affiché doit être celui de Mobilax, jamais un 0 inventé si
    // `/full` ne porte pas `quantity`. On consigne ici ce qui a été observé, pour le compte rendu.
    const ficheApi = await ficheProduit(request, headers, produitId)
    const brut = await request.get(`/api/produits/${produitId}`, { headers })
    void brut
    const stockAffiche = page.locator('#stock-fournisseur-stock')
    const visible = await stockAffiche.isVisible()
    // eslint-disable-next-line no-console
    console.log(`[ticket 05, point 10] prix_achat_ht relu=${ficheApi.prix_achat_ht} ; ` +
      `badge stock Mobilax affiché=${visible} ; texte="${visible ? await stockAffiche.textContent() : ''}"`)
  })
})
