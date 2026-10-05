/**
 * @file tests/e2e/caisse-barre-favoris.spec.ts
 * @description Fenêtre « Nouvelle vente » en « Barre unique + favoris » (recette 001 A′, décision
 * de l'exploitant du 2026-10-02).
 *
 * Défaut d'origine (A) : à l'ouverture, le curseur est dans la recherche ; `douchette.js` se tait
 * dans tout champ de saisie et ce champ n'avait aucune action sur Entrée — un scan n'ajoutait rien,
 * l'exploitant finissait par une ligne libre à 0 € désignée par le code.
 *
 * Contrats, prouvés contre la VRAIE D1 locale (boutique neuve à chaque test) :
 *  - la barre a le focus à l'ouverture et le reprend après chaque ajout ;
 *  - code + Entrée dans la barre → l'article s'ajoute (quantité + 1 au rescan) ;
 *  - texte → liste navigable aux flèches, Entrée ajoute le résultat choisi (le 1er par défaut) ;
 *  - Échap vide la barre sans fermer la vente ;
 *  - tuiles « Favoris » = articles les plus vendus ; un clic = une ligne, deux = quantité 2 ;
 *    aucune tuile pour une boutique sans historique ; noms échappés ;
 *  - « + Ligne libre » explicite ; vente encaissée de bout en bout.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { createTenantAdmin, type TenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

// ═══════════════════════════════════════════════════════════════════════════════
// Aides
// ═══════════════════════════════════════════════════════════════════════════════

const entete = (tenant: TenantAdmin) => ({ Authorization: `Bearer ${tenant.accessToken}` })

async function creerProduit(request: APIRequestContext, tenant: TenantAdmin, data: Record<string, unknown>) {
  const res = await request.post('/api/produits', {
    headers: entete(tenant),
    data:    { stock_minimum: 0, stock_actuel: 20, prix_vente_ht: 10, tva_taux: 20, ...data },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id as number
}

/** Vente encaissée par l'API : elle nourrit les favoris de la boutique. */
async function vendre(request: APIRequestContext, tenant: TenantAdmin, produitId: number, nom: string, quantite: number) {
  const res = await request.post('/api/caisse/vente', {
    headers: entete(tenant),
    data: { mode_paiement: 'especes', lignes: [
      { produit_id: produitId, designation: nom, quantite, prix_unitaire_ht: 10, tva_taux: 20 },
    ] },
  })
  expect(res.status(), await res.text()).toBe(201)
}

/** Connexion, caisse, ouverture de la fenêtre de vente. */
async function ouvrirVente(page: Page, tenant: TenantAdmin) {
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/caisse')
  await expect(page.locator('#kpi-nb-tx')).not.toHaveText('—', { timeout: 15_000 })
  await page.click('#btn-nouvelle-vente')
}

const barre  = (page: Page) => page.locator('#vente-produit-search')
const lignes = (page: Page) => page.locator('#lignes-container .linha-row')
const tuiles = (page: Page) => page.locator('#vente-favoris [data-favori]')

// ═══════════════════════════════════════════════════════════════════════════════
// Barre unique
// ═══════════════════════════════════════════════════════════════════════════════

test('barre : focus à l\'ouverture ; code + Entrée ajoute l\'article, rescanné → quantité 2', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerProduit(request, tenant, { nom: 'E2E Barre écran', code_barre: '3000000388952', prix_vente_ht: 25 })
  await ouvrirVente(page, tenant)

  await expect(barre(page)).toBeFocused()
  // Comme une douchette : frappe rapide puis Entrée, dans la barre qui a le focus
  await page.keyboard.type('3000000388952')
  await page.keyboard.press('Enter')
  await expect(lignes(page)).toHaveCount(1)
  await expect(lignes(page).locator('[data-field="designation"]')).toHaveValue('E2E Barre écran')
  // AVANT (2026-10-05, ticket 02 prix TTC — la caisse se saisit en TTC) : await expect(lignes(page).locator('[data-field="prix_unitaire_ht"]')).toHaveValue('25')
  await expect(lignes(page).locator('[data-field="prix_unitaire_ttc"]')).toHaveValue('30')   // fiche 25 € HT → 30 € TTC
  await expect(barre(page)).toHaveValue('')
  await expect(barre(page)).toBeFocused()

  await page.keyboard.type('3000000388952')
  await page.keyboard.press('Enter')
  await expect(lignes(page)).toHaveCount(1)
  await expect(lignes(page).locator('[data-field="quantite"]')).toHaveValue('2')
})

test('barre : texte → liste aux flèches, Entrée ajoute le résultat choisi ; sans flèche, le premier', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerProduit(request, tenant, { nom: 'E2E Flèche Alpha' })
  await creerProduit(request, tenant, { nom: 'E2E Flèche Bêta' })
  await ouvrirVente(page, tenant)

  await barre(page).pressSequentially('E2E Flèche')
  await expect(page.locator('#vente-produit-results:not(.hidden) [data-produit-id]')).toHaveCount(2)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('#vente-produit-results [aria-selected="true"]')).toContainText('Bêta')
  await page.keyboard.press('Enter')
  await expect(lignes(page)).toHaveCount(1)
  await expect(lignes(page).locator('[data-field="designation"]')).toHaveValue('E2E Flèche Bêta')
  await expect(barre(page)).toBeFocused()

  await barre(page).pressSequentially('E2E Flèche')
  await expect(page.locator('#vente-produit-results:not(.hidden) [data-produit-id]')).toHaveCount(2)
  await page.keyboard.press('Enter')
  await expect(lignes(page)).toHaveCount(2)
  await expect(lignes(page).nth(1).locator('[data-field="designation"]')).toHaveValue('E2E Flèche Alpha')

  // Frappe rapide puis Entrée, sans attendre la liste (comme une douchette sur un texte) : le premier
  // article, jamais le choix aux flèches d'une liste précédente (vécu : Bêta rejoué).
  // Une ancienne liste masquée (Alpha, Bêta) ne doit pas être parcourue : deux ↓ y viseraient Bêta
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await barre(page).pressSequentially('E2E Flèche')
  await page.keyboard.press('Enter')
  await expect(lignes(page)).toHaveCount(2)
  await expect(lignes(page).nth(1).locator('[data-field="quantite"]')).toHaveValue('2')
  await expect(lignes(page).nth(0).locator('[data-field="quantite"]')).toHaveValue('1')
})

test('barre : Échap vide la barre et ferme la liste, la vente reste ouverte', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerProduit(request, tenant, { nom: 'E2E Échap coque' })
  await ouvrirVente(page, tenant)

  await barre(page).pressSequentially('E2E Échap')
  await expect(page.locator('#vente-produit-results:not(.hidden) [data-produit-id]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(barre(page)).toHaveValue('')
  await expect(page.locator('#vente-produit-results')).toHaveClass(/hidden/)
  await expect(page.locator('#modal-vente')).not.toHaveClass(/hidden/)
})

// ═══════════════════════════════════════════════════════════════════════════════
// Favoris
// ═══════════════════════════════════════════════════════════════════════════════

test('favoris : les plus vendus d\'abord, prix TTC ; un clic = une ligne, deux = quantité 2', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const verre = await creerProduit(request, tenant, { nom: 'E2E Fav verre', prix_vente_ht: 8.25 })
  const coque = await creerProduit(request, tenant, { nom: 'E2E Fav coque' })
  await vendre(request, tenant, coque, 'E2E Fav coque', 1)
  await vendre(request, tenant, verre, 'E2E Fav verre', 3)
  await ouvrirVente(page, tenant)

  await expect(tuiles(page)).toHaveCount(2)
  await expect(tuiles(page).nth(0)).toContainText('E2E Fav verre')
  await expect(tuiles(page).nth(0)).toContainText('9,90')
  await expect(tuiles(page).nth(1)).toContainText('E2E Fav coque')

  await tuiles(page).nth(0).click()
  await tuiles(page).nth(0).click()
  await expect(lignes(page)).toHaveCount(1)
  await expect(lignes(page).locator('[data-field="quantite"]')).toHaveValue('2')
  // AVANT (2026-10-05, ticket 02 prix TTC — la caisse se saisit en TTC) : await expect(lignes(page).locator('[data-field="prix_unitaire_ht"]')).toHaveValue('8.25')
  await expect(lignes(page).locator('[data-field="prix_unitaire_ttc"]')).toHaveValue('9.9')  // fiche 8,25 € HT → 9,90 € TTC
  await expect(barre(page)).toBeFocused()
})

test('favoris : boutique sans historique → aucun bloc', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerProduit(request, tenant, { nom: 'E2E Jamais vendu' })
  await ouvrirVente(page, tenant)

  await expect(barre(page)).toBeFocused()
  await expect(tuiles(page)).toHaveCount(0)
  await expect(page.locator('#vente-favoris-zone')).toBeHidden()
})

test('favoris : un nom piégé est affiché comme du texte', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const nom = 'E2E <img src=x data-xss-favori> piège'
  const id = await creerProduit(request, tenant, { nom })
  await vendre(request, tenant, id, nom, 1)
  await ouvrirVente(page, tenant)

  await expect(tuiles(page)).toHaveCount(1)
  await expect(tuiles(page).first()).toContainText('<img')
  await expect(page.locator('img[data-xss-favori]')).toHaveCount(0)
})

// ═══════════════════════════════════════════════════════════════════════════════
// Ligne libre et vente de bout en bout
// ═══════════════════════════════════════════════════════════════════════════════

test('« + Ligne libre », favori et scan dans la même vente, encaissée', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const cable = await creerProduit(request, tenant, { nom: 'E2E Bout câble', code_barre: '3700275473000' })
  await vendre(request, tenant, cable, 'E2E Bout câble', 1)
  await creerProduit(request, tenant, { nom: 'E2E Bout chargeur', code_barre: '3700275473017', prix_vente_ht: 20 })
  await ouvrirVente(page, tenant)

  await tuiles(page).first().click()
  await page.keyboard.type('3700275473017')
  await page.keyboard.press('Enter')
  await expect(lignes(page)).toHaveCount(2)

  await page.getByRole('button', { name: /Ligne libre/ }).click()
  await expect(lignes(page)).toHaveCount(3)
  const libre = lignes(page).nth(2)
  await expect(libre.locator('[data-field="designation"]')).toBeFocused()
  await libre.locator('[data-field="designation"]').fill('Main d\'œuvre')
  // AVANT (2026-10-05, ticket 02 prix TTC — la caisse se saisit en TTC) : await libre.locator('[data-field="prix_unitaire_ht"]').fill('5')
  await libre.locator('[data-field="prix_unitaire_ttc"]').fill('6')

  // AVANT (2026-10-05, ticket 02 prix TTC — la caisse se saisit en TTC) : // 10 + 20 + 5 = 35 HT → 42,00 TTC
  // 12 + 24 + 6 = 42,00 TTC (fiches à 10 et 20 € HT, ligne libre saisie à 6 € TTC)
  await expect(page.locator('#total-ttc-vente')).toHaveText(/42,00/)
  await page.fill('#montant-remis', '50')
  await page.click('#btn-submit-vente')
  await expect(page.locator('#toast-inner')).toContainText(/enregistrée/i, { timeout: 15_000 })
})
