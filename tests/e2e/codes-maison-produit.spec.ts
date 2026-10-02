/**
 * @file tests/e2e/codes-maison-produit.spec.ts
 * @description Codes maison — PARTIE ÉCRAN PRODUIT (ticket 05 `vente-lit-catalogue`, T-012), sur
 * les routes livrées par T-009 : `POST /api/produits/:id/code-maison`, `avertissement_code_maison`
 * à la création, `avertissements` du bilan CSV. Remplace le fichier unique `codes-maison.spec.ts`
 * prescrit par le ticket (découpé entre T-012 — écran produit — et le socle, caisse comprise).
 *
 * Ne touche ni `caisse.js` ni `caisse.html` : le scan réutilise la capture de douchette livrée par
 * le ticket 04 (`caisse-douchette.spec.ts`), ici seulement comme preuve que le code maison affiché
 * est bien celui que la caisse reconnaît. Prouvé contre la VRAIE D1 locale, boutique neuve par
 * test ; `.modal-overlay` fermée par opacité 0, jamais `toBeVisible()` (`CLAUDE.md`).
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { createTenantAdmin, type TenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

/** Variable de page (`public/static/js/stock.js`) lue par `confirmImportCsv()` — ambiante pour
 *  que `page.evaluate()` puisse l'assigner sans fabriquer de `File`/`Buffer`. */
declare let csvFileContent: string | null

// ═══════════════════════════════════════════════════════════════════════════════
// Aides
// ═══════════════════════════════════════════════════════════════════════════════

/** EAN-13 réel, clé juste — fixture partagée avec `tests/codeMaison.test.ts`. */
const SKU_EAN_VALIDE = '4006381333931'

async function creerProduit(request: APIRequestContext, tenant: TenantAdmin, data: Record<string, unknown>) {
  const res = await request.post('/api/produits', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data:    { stock_minimum: 0, ...data },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id as number
}

async function produitDe(request: APIRequestContext, tenant: TenantAdmin, id: number) {
  const res = await request.get(`/api/produits/${id}`, { headers: { Authorization: `Bearer ${tenant.accessToken}` } })
  return (await res.json()).data
}

/**
 * Vide le code-barres d'un produit créé sans dispense (`createProduit()` lui pose un code maison
 * automatique, T-009) : certains scénarios ont besoin d'ouvrir une fiche dont le champ est
 * réellement vide, pas déjà codé par la pose automatique.
 */
async function viderCode(request: APIRequestContext, tenant: TenantAdmin, id: number) {
  const res = await request.put(`/api/produits/${id}`, {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data:    { code_barre: '' },
  })
  expect(res.status(), await res.text()).toBe(200)
}

async function ouvrirStock(page: Page, tenant: TenantAdmin) {
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/stock')
}

/** Ouvre la fiche d'un produit depuis la liste, par son nom (bouton « Modifier » de sa ligne). */
async function ouvrirFiche(page: Page, nom: string) {
  const ligne = page.locator('#stock-tbody tr', { hasText: nom })
  await expect(ligne).toBeVisible({ timeout: 10_000 })
  await ligne.locator('button[title="Modifier"]').click()
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scénarios
// ═══════════════════════════════════════════════════════════════════════════════

test('créer un produit sans code à la main : code maison affiché dans sa fiche, puis scanné en caisse', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await ouvrirStock(page, tenant)

  await page.locator('.page-header-actions button', { hasText: 'Nouveau produit' }).click()
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
  // En création, le produit n'a pas encore d'identifiant : pas de bouton « Générer » (P15 2026-10-02)
  await expect(page.locator('#btn-stock-generer-code')).toBeHidden()

  const nom = `E2E Code maison ${Date.now()}`
  await page.fill('#stock-name', nom)
  await page.locator('#modal-stock button', { hasText: 'Enregistrer' }).click()
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '0')

  await ouvrirFiche(page, nom)
  const code = await page.locator('#stock-code-barre').inputValue()
  // '21' = type produit, suivi des 10 chiffres de l'identifiant et de la clé EAN-13
  expect(code).toMatch(/^21\d{11}$/)
  await page.locator('#modal-stock .modal-close').click()

  await page.goto('/caisse')
  await expect(page.locator('#kpi-nb-tx')).toHaveText('0', { timeout: 15_000 })
  await page.keyboard.type(code)
  await page.keyboard.press('Enter')
  await expect(page.locator('#modal-vente')).not.toHaveClass(/hidden/)
  const ligne = page.locator('#lignes-container .linha-row')
  await expect(ligne).toHaveCount(1)
  await expect(ligne.locator('[data-field="designation"]')).toHaveValue(nom)
})

test('« Générer » puis « Enregistrer » sans rien saisir : le code maison reste en base et affiché', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const id = await creerProduit(request, tenant, { nom: 'E2E Générer puis enregistrer' })
  await viderCode(request, tenant, id)
  await ouvrirStock(page, tenant)
  await ouvrirFiche(page, 'E2E Générer puis enregistrer')

  await expect(page.locator('#stock-code-barre')).toHaveValue('')
  await expect(page.locator('#btn-stock-generer-code')).toBeVisible()
  await page.click('#btn-stock-generer-code')
  // Attendre la réponse de l'API avant de lire : un inputValue() immédiat après le clic recevait
  // encore le champ vide (la pose n'avait pas eu le temps d'écrire le champ).
  await expect(page.locator('#stock-code-barre')).toHaveValue(/^21\d{11}$/)
  const code = await page.locator('#stock-code-barre').inputValue()
  await expect(page.locator('#btn-stock-generer-code')).toBeHidden()

  // Aucune saisie supplémentaire : « Enregistrer » n'a pas besoin de renvoyer le code déjà posé
  await page.locator('#modal-stock button', { hasText: 'Enregistrer' }).click()
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '0')

  const produit = await produitDe(request, tenant, id)
  expect(produit.code_barre).toBe(code)

  // Affiché à la réouverture, relu par l'API
  await ouvrirFiche(page, 'E2E Générer puis enregistrer')
  await expect(page.locator('#stock-code-barre')).toHaveValue(code)
})

test('fiche produit : un code-barres déjà porté par un autre produit est refusé, en nommant le porteur', async ({ page, request }) => {
  const tenant     = await createTenantAdmin(request)
  const idPorteur  = await creerProduit(request, tenant, { nom: 'E2E Porteur du code', code_barre: '3700275472164' })
  await creerProduit(request, tenant, { nom: 'E2E Produit sans code' })
  await ouvrirStock(page, tenant)
  await ouvrirFiche(page, 'E2E Produit sans code')

  await page.fill('#stock-code-barre', '3700275472164')
  await page.locator('#modal-stock button', { hasText: 'Enregistrer' }).click()

  await expect(page.locator('.flash.error')).toHaveText(
    `Erreur: Ce code-barres est déjà utilisé par « E2E Porteur du code » (produit n° ${idPorteur}).`,
  )
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
})

test('SKU EAN-13 valide : « Générer » est refusé en clair, aucun code n\'est posé', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const id = await creerProduit(request, tenant, { nom: 'E2E SKU EAN valide', sku: SKU_EAN_VALIDE })
  await ouvrirStock(page, tenant)
  await ouvrirFiche(page, 'E2E SKU EAN valide')

  // Dispense par SKU : le champ Code-barres reste vide, mais le serveur juge la règle EAN-13 —
  // le bouton reste visible (⊥ une copie d'estEan13Valide() à l'écran, P15 2026-10-02)
  await expect(page.locator('#stock-code-barre')).toHaveValue('')
  await expect(page.locator('#btn-stock-generer-code')).toBeVisible()
  await page.click('#btn-stock-generer-code')

  await expect(page.locator('.flash.error')).toHaveText(
    'Erreur: Ce produit a déjà un code-barres (ou un SKU qui en tient lieu).',
  )
  await expect(page.locator('#stock-code-barre')).toHaveValue('')

  const produit = await produitDe(request, tenant, id)
  expect(produit.code_barre).toBeNull()
})

test('ouvrir une fiche sans code, le poser par l\'API pendant qu\'elle est ouverte, modifier le prix puis Enregistrer : le code posé reste', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const id = await creerProduit(request, tenant, { nom: 'E2E Pose concurrente', prix_vente_ht: 10 })
  await viderCode(request, tenant, id)
  await ouvrirStock(page, tenant)
  await ouvrirFiche(page, 'E2E Pose concurrente')
  await expect(page.locator('#stock-code-barre')).toHaveValue('')

  // Pose par l'API, hors de l'écran — le champ affiché ne le sait pas
  const pose = await request.post(`/api/produits/${id}/code-maison`, { headers: { Authorization: `Bearer ${tenant.accessToken}` } })
  expect(pose.status(), await pose.text()).toBe(200)
  const codePose = (await pose.json()).code_barre as string

  await page.fill('#stock-price', '12.5')
  await page.locator('#modal-stock button', { hasText: 'Enregistrer' }).click()
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '0')

  const produit = await produitDe(request, tenant, id)
  expect(produit.code_barre).toBe(codePose)
  expect(produit.prix_vente_ht).toBe(12.5)
})

test('avertissement de pose après création, affiché en clair (réponse simulée)', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await ouvrirStock(page, tenant)

  const avertissement = 'Code maison 2100000099999 non posé : déjà utilisé par « E2E Déjà codé » ' +
    '(produit n° 321). Corrigez ce doublon puis utilisez « Générer un code maison ».'
  await page.route('**/api/produits*', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    await route.fulfill({ json: { success: true, id: 9999, message: 'Produit créé.', avertissement_code_maison: avertissement } })
  })

  await page.locator('.page-header-actions button', { hasText: 'Nouveau produit' }).click()
  await page.fill('#stock-name', 'E2E Avertissement création')
  await page.locator('#modal-stock button', { hasText: 'Enregistrer' }).click()

  // Preuve du déballage `r.data.avertissement_code_maison` (CLAUDE.md § Enveloppe des réponses API)
  await expect(page.locator('.flash')).toHaveText(avertissement)
})

test('avertissements du bilan d\'import CSV, affichés en clair (réponse simulée)', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await ouvrirStock(page, tenant)

  const avertissement = 'Ligne 2 : code maison non posé pour « E2E CSV Porteur » (produit n° 55) : ' +
    'déjà utilisé par « E2E CSV Autre » (produit n° 54).'
  await page.route('**/api/produits/import-csv*', async route => {
    await route.fulfill({ json: { success: true, imported: 1, updated: 0, skipped: 0, errors: [], avertissements: [avertissement] } })
  })

  await page.locator('.page-header-actions button', { hasText: 'Importer CSV' }).click()
  await expect(page.locator('#modal-import-csv')).toHaveCSS('opacity', '1')
  // Contenu posé directement dans la variable de page lue par confirmImportCsv() : évite de
  // fabriquer un `Buffer` (tsconfig sans @types/node, CLAUDE.md § import-par-generation).
  await page.evaluate(() => { csvFileContent = 'nom\nE2E CSV Porteur\n' })
  await page.click('#btn-confirm-import')

  await expect(page.locator('#import-result')).toContainText(avertissement)
})
