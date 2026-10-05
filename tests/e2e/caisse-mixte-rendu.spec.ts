/**
 * @file tests/e2e/caisse-mixte-rendu.spec.ts
 * @description Recette 002, parties B et C (décisions de l'exploitant du 2026-10-03).
 *
 * B — « Mixte » = deux parts, dans deux modes au choix (espèces, CB, chèque, virement) : on saisit
 *     la première, la seconde se calcule (total − première). « Valider » reste bloqué tant que la
 *     ventilation est impossible (modes identiques, première part nulle ou ≥ total).
 * C — le montant remis et le rendu sont gardés sur la part en espèces, et imprimés sur la facture.
 *
 * Plus un défaut trouvé en codant B : le total affiché arrondissait autrement que le serveur
 * (arrondi par ligne côté serveur) — un centime d'écart suffisait à faire refuser un mixte juste.
 *
 * Contre la VRAIE D1 locale (migration 0061 appliquée), boutique neuve à chaque test.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { createTenantAdmin, type TenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

// ═══════════════════════════════════════════════════════════════════════════════
// Aides
// ═══════════════════════════════════════════════════════════════════════════════

const entete = (tenant: TenantAdmin) => ({ Authorization: `Bearer ${tenant.accessToken}` })

/** Un écran à 220 € HT, TVA 20 % : 264,00 € TTC. */
async function creerEcran(request: APIRequestContext, tenant: TenantAdmin) {
  const res = await request.post('/api/produits', {
    headers: entete(tenant),
    data:    { nom: 'E2E Ecran mixte', code_barre: '3000000391013', prix_vente_ht: 220, tva_taux: 20, stock_actuel: 5, stock_minimum: 0 },
  })
  expect(res.status(), await res.text()).toBe(201)
}

/** Connexion, caisse, fenêtre de vente ouverte, écran scanné dans la barre. */
async function venteDeLEcran(page: Page, tenant: TenantAdmin) {
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/caisse')
  await expect(page.locator('#kpi-nb-tx')).not.toHaveText('—', { timeout: 15_000 })
  await page.click('#btn-nouvelle-vente')
  await page.keyboard.type('3000000391013')
  await page.keyboard.press('Enter')
  await expect(page.locator('#total-ttc-vente')).toHaveText(/264,00/)
}

/** Valide la vente et rend l'identifiant de la facture créée. */
async function valider(page: Page): Promise<number> {
  const reponse = page.waitForResponse(r => r.url().includes('/api/caisse/vente') && r.request().method() === 'POST')
  await page.click('#btn-submit-vente')
  const corps = await (await reponse).json()
  expect(corps.success, JSON.stringify(corps)).toBe(true)
  await expect(page.locator('#toast-inner')).toContainText(/enregistrée/i, { timeout: 15_000 })
  return corps.data.facture.id
}

/** Paiements d'une facture, relus par l'API. */
async function paiementsDe(request: APIRequestContext, tenant: TenantAdmin, factureId: number) {
  const res = await request.get(`/api/factures/${factureId}`, { headers: entete(tenant) })
  const corps = await res.json()
  return (corps.data.paiements as any[]).map(p => ({
    mode_paiement: p.mode_paiement, montant: p.montant, montant_remis: p.montant_remis, rendu_monnaie: p.rendu_monnaie,
  }))
}

/** HTML de la facture tel que le vrai gabarit le construit pour l'impression. */
async function documentFacture(page: Page, factureId: number): Promise<string> {
  await page.goto('/factures')
  await page.waitForLoadState('networkidle')
  return page.evaluate(async (id) => {
    const g = globalThis as any
    let capte = ''
    g._triggerPrint = (html: string) => { capte = html }
    await g.printFacture(id)
    return capte
  }, factureId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// B — mixte
// ═══════════════════════════════════════════════════════════════════════════════

test('B + C : mixte espèces 100 + CB 164 — seconde part calculée, deux paiements, remis et rendu gardés et imprimés', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerEcran(request, tenant)
  await venteDeLEcran(page, tenant)

  await page.click('[data-mode="mixte"]')
  await expect(page.locator('#mixte-zone')).toBeVisible()
  await page.selectOption('#mixte-mode-1', 'especes')
  await page.selectOption('#mixte-mode-2', 'cb')
  await page.fill('#mixte-montant-1', '100')
  await expect(page.locator('#mixte-montant-2')).toHaveText(/164,00/)

  // Le montant remis porte sur la part en espèces : 120 remis pour 100 dus → 20 rendus
  await page.fill('#montant-remis', '120')
  await expect(page.locator('#rendu-montant')).toHaveText(/20,00/)

  const factureId = await valider(page)
  expect(await paiementsDe(request, tenant, factureId)).toEqual([
    { mode_paiement: 'especes', montant: 100, montant_remis: 120, rendu_monnaie: 20 },
    { mode_paiement: 'cb',      montant: 164, montant_remis: null, rendu_monnaie: null },
  ])

  const html = await documentFacture(page, factureId)
  expect(html).toContain('Espèces remis')
  expect(html).toContain('120,00')
  expect(html).toContain('Rendu')
  expect(html).toContain('20,00')
})

test('B : ventilation impossible → « Valider » bloqué, avec la raison affichée', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerEcran(request, tenant)
  await venteDeLEcran(page, tenant)
  await page.click('[data-mode="mixte"]')

  // Deux fois le même mode
  await page.selectOption('#mixte-mode-1', 'cb')
  await page.selectOption('#mixte-mode-2', 'cb')
  await page.fill('#mixte-montant-1', '100')
  await expect(page.locator('#mixte-message')).toContainText('deux modes différents')
  await expect(page.locator('#btn-submit-vente')).toBeDisabled()

  // Première part égale au total : il ne reste rien pour la seconde
  await page.selectOption('#mixte-mode-2', 'cheque')
  await page.fill('#mixte-montant-1', '264')
  await expect(page.locator('#mixte-message')).toContainText('inférieure au total')
  await expect(page.locator('#btn-submit-vente')).toBeDisabled()

  // Ventilation juste → débloqué ; revenir en CB seul → débloqué aussi
  await page.fill('#mixte-montant-1', '64')
  await expect(page.locator('#btn-submit-vente')).toBeEnabled()
  await page.click('[data-mode="cb"]')
  await expect(page.locator('#mixte-zone')).toBeHidden()
  await expect(page.locator('#btn-submit-vente')).toBeEnabled()
})

// ═══════════════════════════════════════════════════════════════════════════════
// C — espèces seules
// ═══════════════════════════════════════════════════════════════════════════════

test('C : espèces, 300 remis pour 264 → rendu 36 gardé sur le paiement', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerEcran(request, tenant)
  await venteDeLEcran(page, tenant)

  await page.fill('#montant-remis', '300')
  await expect(page.locator('#rendu-montant')).toHaveText(/36,00/)
  const factureId = await valider(page)
  expect(await paiementsDe(request, tenant, factureId)).toEqual([
    { mode_paiement: 'especes', montant: 264, montant_remis: 300, rendu_monnaie: 36 },
  ])
})

// ═══════════════════════════════════════════════════════════════════════════════
// Total affiché = total facturé
// ═══════════════════════════════════════════════════════════════════════════════

// AVANT (2026-10-05, ticket 02 prix TTC — la caisse se saisit en TTC) : test('total affiché arrondi comme le serveur : 3 × 0,03 € HT → 0,12 € TTC, et un mixte sur ce total passe', async ({ page, request }) => {
// AVANT (2026-10-05, revue du ticket 02 — 3 × 0,04 € TTC ne discriminait plus : une somme naïve donne aussi 0,12) :
// test('total affiché arrondi comme le serveur : 3 × 0,04 € TTC → 0,12 € TTC, et un mixte sur ce total passe', async ({ page, request }) => {
test('total affiché arrondi comme le serveur : 3 × 0,05 € TTC remisés de 10 % → 0,15 € TTC, et un mixte sur ce total passe', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/caisse')
  await expect(page.locator('#kpi-nb-tx')).not.toHaveText('—', { timeout: 15_000 })
  await page.click('#btn-nouvelle-vente')

  for (let i = 0; i < 3; i++) {
    await page.click('#btn-ligne-libre')
    const ligne = page.locator('#lignes-container .linha-row').nth(i)
    await ligne.locator('[data-field="designation"]').fill(`Petite pièce ${i + 1}`)
    // AVANT (2026-10-05, ticket 02 prix TTC — la caisse se saisit en TTC) : await ligne.locator('[data-field="prix_unitaire_ht"]').fill('0.03')
    // AVANT (2026-10-05, revue du ticket 02 — prix remisé, voir le titre) : await ligne.locator('[data-field="prix_unitaire_ttc"]').fill('0.04')
    await ligne.locator('[data-field="prix_unitaire_ttc"]').fill('0.05')
    await ligne.locator('[data-field="remise_pct"]').fill('10')
  }
  // AVANT (2026-10-05, ticket 02 prix TTC — la caisse se saisit en TTC) : // Serveur : TVA arrondie par ligne (0,006 → 0,01) ×3 = 0,03 ; TTC = 0,09 + 0,03 = 0,12
  // AVANT (2026-10-05, revue du ticket 02) : // Serveur : chaque ligne vaut 0,04 € TTC (HT 0,03 arrondi, TVA 0,01) ; 3 lignes = 0,12 € TTC
  // AVANT (2026-10-05, revue du ticket 02) : await expect(page.locator('#total-ttc-vente')).toHaveText(/0,12/)
  // Serveur : PU remisé arrondi par ligne (0,045 → 0,05) ; 3 lignes = 0,15 € TTC. Une somme naïve,
  // sans arrondi par ligne, afficherait 0,135 → 0,14 et un mixte saisi dessus serait refusé.
  await expect(page.locator('#total-ttc-vente')).toHaveText(/0,15/)

  await page.click('[data-mode="mixte"]')
  await page.selectOption('#mixte-mode-1', 'especes')
  await page.selectOption('#mixte-mode-2', 'cb')
  await page.fill('#mixte-montant-1', '0.05')
  // AVANT (2026-10-05, revue du ticket 02) : await expect(page.locator('#mixte-montant-2')).toHaveText(/0,07/)
  await expect(page.locator('#mixte-montant-2')).toHaveText(/0,10/)
  const factureId = await valider(page)
  // AVANT (2026-10-05, revue du ticket 02) : expect((await paiementsDe(request, tenant, factureId)).map(p => p.montant)).toEqual([0.05, 0.07])
  expect((await paiementsDe(request, tenant, factureId)).map(p => p.montant)).toEqual([0.05, 0.1])
})
