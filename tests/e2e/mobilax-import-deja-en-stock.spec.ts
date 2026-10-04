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
    // AVANT (2026-10-04) : le message renvoyait vers « Ajuster le stock », alors que la fiche ouverte
    // propose « Ajouter N au stock » depuis le ticket 18 — les deux se contredisaient (recette du jour).
    // + ' La quantité saisie (5) n\'a pas été ajoutée : passez par « Ajuster le stock ».',
    + ' La quantité saisie (5) n\'a pas été ajoutée : le bouton de la fiche vous propose de l\'ajouter.',
  )
  // Le bouton annoncé par le message est bien dans la fiche
  await expect(page.locator('#btn-stock-ajout-import')).toHaveText('Ajouter 5 au stock')
  // Une information, pas un échec
  await expect(flash).toHaveClass(/\binfo\b/)
  // La fiche du produit trouvé s'ouvre
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
  await expect(page.locator('#stock-name')).toHaveValue('E2E batterie saisie à la main')
})

// Recette du 2026-10-04, reproduite en production : pendant l'import d'une ligne, « Importer la
// sélection » restait actif — le lot partait en parallèle, l'import de la ligne refermait la fenêtre
// sous lui, et le bouton de la ligne restait « Import… ».
test('import d\'une ligne en vol : la sélection est figée, puis la ligne redit « Importer »', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const cree = await request.post('/api/produits', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data:    { nom: 'E2E batterie déjà en stock', sku: '3000000000017', stock_minimum: 0 },
  })
  expect(cree.status(), await cree.text()).toBe(201)
  const idExistant = (await cree.json()).id

  await page.route('**/api/mobilax/produits?*', route => route.fulfill({ json: { success: true, data: {
    fournisseur_id: 3, total: 1, page: 1, pages: 1,
    produits: [{ mobilax_id: 17, nom: 'Batterie iPhone 12', ean13: '3000000000017', prix_achat_ht: 5.8, stock: 12 }],
  } } }))
  // La réponse de l'import est retenue tant que le test ne la libère pas : l'import reste « en vol »
  let libererImport: () => void = () => {}
  const importLibere = new Promise<void>(resolve => { libererImport = resolve })
  let importsRecus = 0
  await page.route('**/api/mobilax/import*', async route => {
    importsRecus += 1
    await importLibere
    await route.fulfill({
      status: 409,
      json:   { success: false, code: 'deja_importe', error: 'Cette pièce est déjà dans votre stock.', data: { produit_id: idExistant } },
    })
  })

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/stock')
  await page.click('#btn-mobilax')
  await page.fill('#mobilax-terme', 'batterie')
  await page.click('#btn-mobilax-chercher')
  await expect(page.locator('#mobilax-resultats tr')).toHaveCount(1)

  // La ligne est cochée (sélection active) puis importée seule
  await page.locator('#mobilax-resultats input[type="checkbox"]').check()
  await page.locator('#mobilax-resultats input.mobilax-qte').fill('1')
  const boutonDeLigne = page.locator('#mobilax-resultats button[data-mobilax-id="17"]')
  await boutonDeLigne.click()
  await expect.poll(() => importsRecus).toBe(1)

  // Pendant l'import de la ligne : barre de sélection et case figées
  await expect(page.locator('#btn-selection-importer')).toBeDisabled()
  await expect(page.locator('#mobilax-resultats input[type="checkbox"]')).toBeDisabled()

  libererImport()
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
  // Un seul import est parti, et la ligne (fenêtre refermée, résultats gardés) redit « Importer »
  expect(importsRecus).toBe(1)
  await expect(boutonDeLigne).toHaveText('Importer')
  await expect(boutonDeLigne).toBeEnabled()
})

test('même pièce fournisseur : le texte habituel est conservé', async ({ page, request }) => {
  await importerPieceDejaEnStock(page, request, 'Cette pièce est déjà dans votre stock.')

  await expect(page.locator('.flash').last())
    .toHaveText('Cette pièce est déjà dans votre stock — voici sa fiche.')
})
