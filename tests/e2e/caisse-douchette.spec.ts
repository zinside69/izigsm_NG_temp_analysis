/**
 * @file tests/e2e/caisse-douchette.spec.ts
 * @description Douchette en caisse (ticket 04 du chantier `vente-lit-catalogue`).
 *
 * La douchette tape comme un clavier, très vite, puis Entrée. Elle est simulée ici par
 * `page.keyboard.type(code)` puis `Enter`, le focus HORS de tout champ de saisie. Joué sur le vrai
 * serveur local et la vraie base, sous un compte de boutique (manager du tenant) ; les produits
 * sont créés par les vraies routes. Seul le scan d'un SERVICE passe par une réponse simulée :
 * aucun service n'a de code-barres avant le ticket 05.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { createTenantAdmin, type TenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

// ═══════════════════════════════════════════════════════════════════════════════
// Aides
// ═══════════════════════════════════════════════════════════════════════════════

async function creerProduit(request: APIRequestContext, tenant: TenantAdmin, data: Record<string, unknown>) {
  const res = await request.post('/api/produits', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data:    { stock_minimum: 0, stock_actuel: 5, prix_vente_ht: 10, tva_taux: 20, ...data },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id as number
}

/** Connexion du tenant et ouverture de la caisse, fenêtre de vente FERMÉE. */
async function ouvrirCaisse(page: Page, tenant: TenantAdmin) {
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/caisse')
  await expect(page.locator('#kpi-nb-tx')).toHaveText('0', { timeout: 15_000 })
}

/** Scan de douchette : frappe rapide puis Entrée, là où se trouve le focus. */
async function scanner(page: Page, code: string) {
  await page.keyboard.type(code)
  await page.keyboard.press('Enter')
}

const lignes = (page: Page) => page.locator('#lignes-container .linha-row')

// ═══════════════════════════════════════════════════════════════════════════════
// Scénarios
// ═══════════════════════════════════════════════════════════════════════════════

test('écran au repos : un scan ouvre la vente et ajoute la ligne ; rescanné, la quantité passe à 2', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerProduit(request, tenant, { nom: 'E2E Douchette coque', code_barre: '3700000000017', prix_vente_ht: 15 })
  await ouvrirCaisse(page, tenant)

  await scanner(page, '3700000000017')
  await expect(page.locator('#modal-vente')).not.toHaveClass(/hidden/)
  await expect(lignes(page)).toHaveCount(1)
  await expect(lignes(page).locator('[data-field="designation"]')).toHaveValue('E2E Douchette coque')
  await expect(lignes(page).locator('[data-field="prix_unitaire_ht"]')).toHaveValue('15')

  await scanner(page, '3700000000017')
  await expect(lignes(page)).toHaveCount(1)
  await expect(lignes(page).locator('[data-field="quantite"]')).toHaveValue('2')
})

test('un EAN tapé comme SKU est trouvé au scan', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerProduit(request, tenant, { nom: 'E2E Verre trempé', sku: '3700000000024' })
  await ouvrirCaisse(page, tenant)

  await scanner(page, '3700000000024')
  await expect(lignes(page)).toHaveCount(1)
  await expect(lignes(page).locator('[data-field="designation"]')).toHaveValue('E2E Verre trempé')
})

test('article ajouté par le sélecteur puis scanné : une seule ligne, quantité 2', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerProduit(request, tenant, { nom: 'E2E Chargeur USB-C', code_barre: '3700000000031' })
  await ouvrirCaisse(page, tenant)
  await page.click('#btn-nouvelle-vente')

  await page.fill('#vente-produit-search', 'E2E Chargeur')
  const resultat = page.locator('#vente-produit-results [data-produit-id]').first()
  await expect(resultat).toBeVisible({ timeout: 10_000 })
  await resultat.click()
  await expect(lignes(page)).toHaveCount(1)

  await scanner(page, '3700000000031')
  await expect(lignes(page)).toHaveCount(1)
  await expect(lignes(page).locator('[data-field="quantite"]')).toHaveValue('2')
})

test('code inconnu : message et lien « Créer la fiche », aucune ligne', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await ouvrirCaisse(page, tenant)

  await scanner(page, '3700000000048')
  await expect(page.locator('#vente-produit-results')).toContainText('Code inconnu : 3700000000048')
  const lien = page.locator('#vente-produit-results a', { hasText: 'Créer la fiche' })
  await expect(lien).toHaveAttribute('href', '/stock?nouveau=1&code=3700000000048')
  await expect(lien).toHaveAttribute('target', '_blank')
  await expect(lignes(page)).toHaveCount(0)
})

test('l\'EAN de l\'un est le SKU de l\'autre : la liste est proposée, aucune ligne ajoutée', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerProduit(request, tenant, { nom: 'E2E Coque noire', code_barre: '3700000000055' })
  await creerProduit(request, tenant, { nom: 'E2E Coque bleue', sku: '3700000000055' })
  await ouvrirCaisse(page, tenant)

  await scanner(page, '3700000000055')
  await expect(page.locator('#vente-produit-results [data-produit-id]')).toHaveCount(2)
  await expect(lignes(page)).toHaveCount(0)
})

test('frappe dans la désignation d\'une ligne : rien n\'est capté, le texte reste dans le champ', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerProduit(request, tenant, { nom: 'E2E Batterie', code_barre: '3700000000062' })
  await ouvrirCaisse(page, tenant)
  await page.click('#btn-nouvelle-vente')
  await page.getByRole('button', { name: /Ajouter une ligne/ }).click()
  const designation = lignes(page).first().locator('[data-field="designation"]')
  await expect(designation).toBeFocused()

  await scanner(page, '3700000000062')
  await expect(lignes(page)).toHaveCount(1)
  await expect(designation).toHaveValue('3700000000062')
})

test('IMEI de 15 chiffres : « Aucun produit pour cet IMEI », aucune erreur', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const erreurs: string[] = []
  page.on('pageerror', e => erreurs.push(e.message))
  await ouvrirCaisse(page, tenant)

  await scanner(page, '356938035643809')
  await expect(page.locator('#vente-produit-results')).toContainText('Aucun produit pour cet IMEI')
  await expect(lignes(page)).toHaveCount(0)
  expect(erreurs).toEqual([])
})

test('résultat de type service (réponse simulée) : ligne service, rescanné → quantité 2', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await page.route(/\/api\/catalogue\/recherche\?scan=/, route => route.fulfill({
    json: { success: true, data: { type_scan: 'code_barre', resultats: [
      { type: 'service', id: 991, nom: 'E2E Pose de film', reference: null, prix_ht: 12.5, tva_taux: 20 },
    ] } },
  }))
  await ouvrirCaisse(page, tenant)

  await scanner(page, '2200000009915')
  await expect(lignes(page)).toHaveCount(1)
  await expect(lignes(page).locator('[data-field="designation"]')).toHaveValue('E2E Pose de film')
  await scanner(page, '2200000009915')
  await expect(lignes(page)).toHaveCount(1)
  await expect(lignes(page).locator('[data-field="quantite"]')).toHaveValue('2')
})

test('stock : /stock?nouveau=1&code=… ouvre la fiche en création, SKU prérempli', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })

  await page.goto('/stock?nouveau=1&code=3700000000079')
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
  await expect(page.locator('#modal-stock-title')).toHaveText('Nouveau produit')
  await expect(page.locator('#stock-reference')).toHaveValue('3700000000079')
})

test('stock : sans nouveau=1, rien ne s\'ouvre', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })

  await page.goto('/stock?code=3700000000079')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '0')
})
