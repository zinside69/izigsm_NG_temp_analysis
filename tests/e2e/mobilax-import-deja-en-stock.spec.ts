/**
 * @file tests/e2e/mobilax-import-deja-en-stock.spec.ts
 * @description Import unitaire d'une pièce déjà en stock : le message nomme le produit trouvé
 * (ticket 01 du chantier `vente-lit-catalogue`, décision de l'exploitant du 2026-09-17).
 *
 * Depuis la migration 0048, une pièce dont l'EAN — ou le SKU, que l'import renseigne avec l'EAN —
 * est déjà porté par un produit de la boutique répond `deja_importe` avec un message qui nomme ce
 * produit. L'écran affichait un texte générique ; il affiche désormais ce message, **comme une
 * information, jamais comme un échec**. La quantité saisie n'est toujours pas ajoutée (règle du
 * 2026-09-12, confirmée).
 *
 * Réponses d'iziGSM simulées (`page.route()`) : aucun appel réel au fournisseur. Le produit
 * désigné, lui, existe réellement, puisque sa fiche s'ouvre.
 */
import { test, expect, type Page } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

async function importerPieceDejaEnStock(page: Page, request: any, message: string, quantite?: string) {
  const tenant = await createTenantAdmin(request)
  const cree = await request.post('/api/produits', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data:    { nom: 'E2E batterie saisie à la main', sku: '3000000000017', stock_minimum: 0 },
  })
  expect(cree.status(), await cree.text()).toBe(201)
  const idExistant = (await cree.json()).id

  await page.route('**/api/mobilax/produits?*', route => route.fulfill({ json: { success: true, data: {
    fournisseur_id: 3, total: 1, page: 1, pages: 1,
    produits: [{ mobilax_id: 17, nom: 'Batterie iPhone 12', ean13: '3000000000017', prix_achat_ht: 5.8, stock: 12 }],
  } } }))
  await page.route('**/api/mobilax/import*', route => route.fulfill({
    status: 409,
    json:   { success: false, code: 'deja_importe', error: message.replace('{id}', String(idExistant)), data: { produit_id: idExistant } },
  }))

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/stock')
  await page.click('#btn-mobilax')
  await page.fill('#mobilax-terme', 'batterie')
  await page.click('#btn-mobilax-chercher')
  await expect(page.locator('#mobilax-resultats tr')).toHaveCount(1)
  if (quantite !== undefined) await page.locator('#mobilax-resultats input.mobilax-qte').fill(quantite)
  await page.locator('#mobilax-resultats button[data-mobilax-id="17"]').click()
  return idExistant
}

test('SKU déjà existant : le message le précise et nomme le produit, en information', async ({ page, request }) => {
  const id = await importerPieceDejaEnStock(
    page, request, 'Ce SKU est déjà utilisé par « E2E batterie saisie à la main » (produit n° {id}).', '5',
  )

  const flash = page.locator('.flash').last()
  await expect(flash).toHaveText(
    `Déjà en stock : ce SKU est déjà utilisé par « E2E batterie saisie à la main » (produit n° ${id}) — voici sa fiche.`
    + ' La quantité saisie (5) n\'a pas été ajoutée : passez par « Ajuster le stock ».',
  )
  // Une information, pas un échec
  await expect(flash).toHaveClass(/\binfo\b/)
  // La fiche du produit trouvé s'ouvre
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
  await expect(page.locator('#stock-name')).toHaveValue('E2E batterie saisie à la main')
})

test('même pièce fournisseur : le texte habituel est conservé', async ({ page, request }) => {
  await importerPieceDejaEnStock(page, request, 'Cette pièce est déjà dans votre stock.')

  await expect(page.locator('.flash').last())
    .toHaveText('Cette pièce est déjà dans votre stock — voici sa fiche.')
})
