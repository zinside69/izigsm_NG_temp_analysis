/**
 * @file tests/e2e/caisse-ttc.spec.ts
 * @description Ticket 02 du chantier prix TTC (décisions Q2 et Q11 de l'exploitant, 2026-10-04) :
 * la caisse se saisit et se calcule en TTC — le client paie exactement prix affiché × quantité.
 *
 * - Ligne du catalogue : prix proposé = TTC de la fiche ; 19,99 € × 3 = 59,97 € facturés.
 * - Ligne libre saisie en TTC.
 * - Remise sur le PU TTC, arrondi au centime : 9,99 € − 10 % = 8,99 € l'unité.
 * - Paiement mixte accepté sur le total TTC.
 * - Total affiché = total facturé (HT, TVA, TTC), sur des cas à plusieurs taux et prix non ronds.
 *
 * Contre la VRAIE D1 locale (migrations 0062 et 0063 appliquées), boutique neuve à chaque test.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { createTenantAdmin, type TenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

// ═══════════════════════════════════════════════════════════════════════════════
// Aides
// ═══════════════════════════════════════════════════════════════════════════════

const entete = (tenant: TenantAdmin) => ({ Authorization: `Bearer ${tenant.accessToken}` })

const EAN_CABLE = '3000000391020'

/** Un câble à 19,99 € TTC (TVA 20 %) : le prix que le client voit en rayon. */
async function creerCable(request: APIRequestContext, tenant: TenantAdmin) {
  const res = await request.post('/api/produits', {
    headers: entete(tenant),
    data:    { nom: 'E2E Câble TTC', code_barre: EAN_CABLE, prix_vente_ttc: 19.99, tva_taux: 20, stock_actuel: 10, stock_minimum: 0 },
  })
  expect(res.status(), await res.text()).toBe(201)
}

/** Connexion, caisse, fenêtre de vente ouverte. */
async function ouvrirVente(page: Page, tenant: TenantAdmin) {
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/caisse')
  await expect(page.locator('#kpi-nb-tx')).not.toHaveText('—', { timeout: 15_000 })
  await page.click('#btn-nouvelle-vente')
}

const lignes = (page: Page) => page.locator('#lignes-container .linha-row')

/** Ajoute une ligne libre et la remplit (prix saisi en TTC). */
async function ligneLibre(page: Page, l: { designation: string; quantite: number; prixTtc: string; taux: string; remise?: string }) {
  await page.click('#btn-ligne-libre')
  const ligne = lignes(page).last()
  await ligne.locator('[data-field="designation"]').fill(l.designation)
  await ligne.locator('[data-field="quantite"]').fill(String(l.quantite))
  await ligne.locator('[data-field="prix_unitaire_ttc"]').fill(l.prixTtc)
  await ligne.locator('[data-field="tva_taux"]').selectOption(l.taux)
  if (l.remise) await ligne.locator('[data-field="remise_pct"]').fill(l.remise)
}

/** Valide la vente et rend la facture créée (totaux relus en base par l'API). */
async function valider(page: Page, request: APIRequestContext, tenant: TenantAdmin) {
  const reponse = page.waitForResponse(r => r.url().includes('/api/caisse/vente') && r.request().method() === 'POST')
  await page.click('#btn-submit-vente')
  const corps = await (await reponse).json()
  expect(corps.success, JSON.stringify(corps)).toBe(true)
  await expect(page.locator('#toast-inner')).toContainText(/enregistrée/i, { timeout: 15_000 })
  const res = await request.get(`/api/factures/${corps.data.facture.id}`, { headers: entete(tenant) })
  return (await res.json()).data
}

/** Montant en euros, au format de l'écran (« 59,97 »), pour comparer au texte affiché. */
const enTexte = (montant: number) => montant.toFixed(2).replace('.', ',')

// ═══════════════════════════════════════════════════════════════════════════════
// Ligne du catalogue, ligne libre, remise, mixte
// ═══════════════════════════════════════════════════════════════════════════════

test('ligne du catalogue : PU proposé = 19,99 € TTC, × 3 = 59,97 € affichés et facturés', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerCable(request, tenant)
  await ouvrirVente(page, tenant)

  await page.keyboard.type(EAN_CABLE)
  await page.keyboard.press('Enter')
  await expect(lignes(page).locator('[data-field="prix_unitaire_ttc"]')).toHaveValue('19.99')
  await lignes(page).locator('[data-field="quantite"]').fill('3')
  await expect(page.locator('#total-ttc-vente')).toHaveText(/59,97/)

  const facture = await valider(page, request, tenant)
  expect(facture.total_ttc).toBe(59.97)
})

test('ligne libre saisie en TTC : 12,00 € TTC à 20 % → HT 10,00, TVA 2,00', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await ouvrirVente(page, tenant)

  await ligneLibre(page, { designation: 'Main d\'œuvre', quantite: 1, prixTtc: '12', taux: '20' })
  await expect(page.locator('#total-ht-vente')).toHaveText(/10,00/)
  await expect(page.locator('#total-tva-vente')).toHaveText(/2,00/)
  await expect(page.locator('#total-ttc-vente')).toHaveText(/12,00/)

  const facture = await valider(page, request, tenant)
  expect([facture.total_ht, facture.total_tva, facture.total_ttc]).toEqual([10, 2, 12])
})

test('remise 10 % sur 9,99 € TTC × 2 : 8,99 € l\'unité, 17,98 € affichés et facturés', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await ouvrirVente(page, tenant)

  await ligneLibre(page, { designation: 'Coque', quantite: 2, prixTtc: '9.99', taux: '20', remise: '10' })
  await expect(page.locator('#total-ttc-vente')).toHaveText(/17,98/)

  const facture = await valider(page, request, tenant)
  expect(facture.total_ttc).toBe(17.98)
})

test('paiement mixte sur 59,97 € TTC : espèces 20,00 + CB 39,97 accepté', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerCable(request, tenant)
  await ouvrirVente(page, tenant)
  await page.keyboard.type(EAN_CABLE)
  await page.keyboard.press('Enter')
  await lignes(page).locator('[data-field="quantite"]').fill('3')
  await expect(page.locator('#total-ttc-vente')).toHaveText(/59,97/)

  await page.click('[data-mode="mixte"]')
  await page.selectOption('#mixte-mode-1', 'especes')
  await page.selectOption('#mixte-mode-2', 'cb')
  await page.fill('#mixte-montant-1', '20')
  await expect(page.locator('#mixte-montant-2')).toHaveText(/39,97/)

  const facture = await valider(page, request, tenant)
  expect(facture.total_ttc).toBe(59.97)
  expect((facture.paiements as any[]).map(p => p.montant)).toEqual([20, 39.97])
})

// ═══════════════════════════════════════════════════════════════════════════════
// Total affiché = total facturé, au centime
// ═══════════════════════════════════════════════════════════════════════════════

test('plusieurs taux, prix non ronds et remise : HT, TVA et TTC affichés = ceux de la facture', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await ouvrirVente(page, tenant)

  await ligneLibre(page, { designation: 'Câble',        quantite: 3, prixTtc: '19.99', taux: '20' })
  await ligneLibre(page, { designation: 'Livre',        quantite: 2, prixTtc: '7.77',  taux: '5.5' })
  await ligneLibre(page, { designation: 'Petite pièce', quantite: 3, prixTtc: '0.03',  taux: '10' })
  await ligneLibre(page, { designation: 'Étui',         quantite: 1, prixTtc: '13.33', taux: '20', remise: '15' })
  // Revue : 4,35 € − 10 % = 3,92 € en centimes ; la virgule flottante donnait 3,91 €
  await ligneLibre(page, { designation: 'Film',         quantite: 1, prixTtc: '4.35',  taux: '20', remise: '10' })

  const affiche = {
    ht:  await page.locator('#total-ht-vente').textContent(),
    tva: await page.locator('#total-tva-vente').textContent(),
    ttc: await page.locator('#total-ttc-vente').textContent(),
  }
  const facture = await valider(page, request, tenant)

  // AVANT (2026-10-05, revue du ticket 02 — ligne « Film » ajoutée) :
  // // Calcul à la main (centimes) : 59,97 + 15,54 + 0,09 + 11,33 = 86,93 TTC
  // expect(facture.total_ttc).toBe(86.93)
  // Calcul à la main (centimes) : 59,97 + 15,54 + 0,09 + 11,33 + 3,92 = 90,85 TTC
  expect(facture.total_ttc).toBe(90.85)
  expect(affiche.ht).toContain(enTexte(facture.total_ht))
  expect(affiche.tva).toContain(enTexte(facture.total_tva))
  expect(affiche.ttc).toContain(enTexte(facture.total_ttc))
})
