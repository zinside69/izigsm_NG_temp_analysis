/**
 * @file tests/e2e/mobilax-ajout-bilan-lot.spec.ts
 * @description « Ajouter N au stock » proposé dans le BILAN d'un import en lot (décision de
 * l'exploitant du 2026-10-03).
 *
 * Constat en production : une pièce déjà en stock, cochée avec « Qté en rayon » = 1 puis importée par
 * « Importer la sélection », finissait sur « 1 déjà dans votre stock » — la quantité saisie ignorée
 * sans le dire, et aucun moyen de l'ajouter. L'offre n'existait qu'après l'import d'une seule pièce,
 * dans sa fiche.
 *
 * Règle gardée : rien ne s'ajoute sans un clic (règle du 2026-09-12). Un clic = une pièce, par la même
 * route que la fiche (`POST /api/mobilax/produits/:id/ajout-stock`, clé d'idempotence par offre).
 *
 * Fournisseur simulé (recherche, import 409 `deja_importe`) ; route d'ajout et base réelles.
 */
import { test, expect, type Page } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

/** Pièce déjà en stock (4), trouvée chez Mobilax ; renvoie les en-têtes et les ajouts envoyés. */
async function pieceDejaEnStock(page: Page, request: any) {
  const tenant = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }
  const cree = await request.post('/api/produits', {
    headers, data: { nom: 'E2E écran déjà en stock', sku: '3000000296028', stock_actuel: 4, stock_minimum: 0 },
  })
  expect(cree.status(), await cree.text()).toBe(201)
  const produitId = (await cree.json()).id

  await page.route('**/api/mobilax/produits?*', route => route.fulfill({ json: { success: true, data: {
    fournisseur_id: 3, total: 1, page: 1, pages: 1,
    produits: [{ mobilax_id: 35261, nom: 'Ecran Incell iPhone 12 Pro Max', ean13: '3000000296028', prix_achat_ht: 14.5, stock: 151 }],
  } } }))
  await page.route('**/api/mobilax/import*', route => route.fulfill({
    status: 409,
    json: { success: false, code: 'deja_importe', error: 'Cette pièce est déjà dans votre stock.', data: { produit_id: produitId } },
  }))
  const ajouts: any[] = []
  await page.route(/\/api\/mobilax\/produits\/\d+\/ajout-stock(\?|$)/, async route => {
    ajouts.push(route.request().postDataJSON())
    await route.fallback()   // la vraie route répond
  })

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/stock')
  await page.click('#btn-mobilax')
  await page.fill('#mobilax-terme', '3000000296028')
  await page.click('#btn-mobilax-chercher')
  await expect(page.locator('#mobilax-resultats tr')).toHaveCount(1)
  return { headers, produitId, ajouts }
}

/** Coche la ligne, saisit la quantité (ou rien), lance « Importer la sélection ». */
async function importerEnLot(page: Page, quantite: string) {
  const ligne = page.locator('#mobilax-resultats tr').first()
  await ligne.locator('input[type="checkbox"]').check()
  if (quantite) await ligne.locator('input.mobilax-qte').fill(quantite)
  await page.click('#btn-selection-importer')
  await expect(page.locator('#mobilax-bilan')).toContainText('1 déjà dans votre stock', { timeout: 15_000 })
}

async function stockDe(request: any, headers: Record<string, string>, id: number) {
  const r = await request.get(`/api/produits/${id}`, { headers })
  return (await r.json()).data.stock_actuel as number
}

test('lot : pièce déjà en stock avec 2 saisis → le bilan propose « Ajouter 2 au stock », un clic l\'ajoute', async ({ page, request }) => {
  const { headers, produitId, ajouts } = await pieceDejaEnStock(page, request)
  await importerEnLot(page, '2')

  const bilan = page.locator('#mobilax-bilan')
  await expect(bilan).toContainText('quantité saisie non ajoutée')
  await expect(bilan).toContainText('Ecran Incell iPhone 12 Pro Max')
  const bouton = bilan.getByRole('button', { name: 'Ajouter 2 au stock' })
  await expect(bouton).toBeVisible()
  expect(await stockDe(request, headers, produitId), 'rien sans clic').toBe(4)

  await bouton.click()
  await expect(bilan).toContainText('2 ajoutés au stock : 4 → 6')
  await expect(bilan.getByRole('button', { name: /Ajouter/ })).toHaveCount(0)
  expect(await stockDe(request, headers, produitId)).toBe(6)

  // Un seul envoi, avec sa clé d'idempotence
  expect(ajouts).toHaveLength(1)
  expect(ajouts[0].quantite).toBe(2)
  expect(typeof ajouts[0].cle).toBe('string')
})

test('lot : pièce déjà en stock SANS quantité saisie → aucune offre', async ({ page, request }) => {
  const { ajouts } = await pieceDejaEnStock(page, request)
  await importerEnLot(page, '')
  await expect(page.locator('#mobilax-bilan').getByRole('button', { name: /Ajouter/ })).toHaveCount(0)
  expect(ajouts).toHaveLength(0)
})
