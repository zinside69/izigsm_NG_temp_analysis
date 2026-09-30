/**
 * @file tests/e2e/vente-occasion-imei.spec.ts
 * @description IMEI du produit et vente d'occasion (ticket 07 du chantier `vente-lit-catalogue`).
 *
 * Parcours complet sur le vrai serveur local et la vraie base : l'IMEI se saisit dans la fiche
 * produit, le téléphone se retrouve en scannant cet IMEI en caisse, la vente fige son identité
 * (marque, modèle, IMEI) sur la facture A4 — et corriger ensuite la fiche ne change pas le
 * document émis (décisions de l'exploitant du 2026-09-30).
 *
 * La facture est « relue » par le vrai gabarit d'impression (`printFacture()` → `_buildFactureHTML()`)
 * sur la vraie page Factures ; seul `_triggerPrint()` est remplacé, pour capter le HTML au lieu
 * d'ouvrir la boîte d'impression (qui retire le document 500 ms après).
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { createTenantAdmin, type TenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

const IMEI    = '356938035643809'
const IMEI_B  = '490154203237518'

async function creerProduit(request: APIRequestContext, tenant: TenantAdmin, data: Record<string, unknown>) {
  const res = await request.post('/api/produits', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data:    { stock_minimum: 0, stock_actuel: 1, prix_vente_ht: 250, tva_taux: 20, ...data },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id as number
}

async function connecter(page: Page, tenant: TenantAdmin) {
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
}

async function ouvrirFiche(page: Page, nom: string) {
  const ligne = page.locator('#stock-tbody tr', { hasText: nom }).first()
  await expect(ligne).toBeVisible({ timeout: 20_000 })
  await ligne.getByTitle('Modifier').click()
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
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

test('IMEI saisi dans la fiche → scanné en caisse → figé sur la facture, insensible à la fiche corrigée', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const id = await creerProduit(request, tenant, { nom: 'E2E iPhone 12 128 Go occasion', marque: 'Apple' })
  await connecter(page, tenant)

  // 1. L'IMEI se saisit dans la fiche produit
  await page.goto('/stock')
  await ouvrirFiche(page, 'E2E iPhone 12 128 Go occasion')
  await page.fill('#stock-imei', IMEI)
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '0')
  const fiche = await (await request.get(`/api/produits/${id}`, { headers: { Authorization: `Bearer ${tenant.accessToken}` } })).json()
  expect(fiche.data.imei).toBe(IMEI)

  // 2. Scanné en caisse, le téléphone s'ajoute
  await page.goto('/caisse')
  await expect(page.locator('#kpi-nb-tx')).toHaveText('0', { timeout: 15_000 })
  await page.keyboard.type(IMEI)
  await page.keyboard.press('Enter')
  const ligne = page.locator('#lignes-container .linha-row')
  await expect(ligne).toHaveCount(1)
  await expect(ligne.locator('[data-field="designation"]')).toHaveValue('E2E iPhone 12 128 Go occasion')

  // 3. Vendu : la facture porte l'identité figée
  await page.fill('#montant-remis', '300')
  const reponse = page.waitForResponse(r => r.url().includes('/api/caisse/vente') && r.request().method() === 'POST')
  await page.click('#btn-submit-vente')
  const factureId = (await (await reponse).json()).data.facture.id as number

  const avant = await documentFacture(page, factureId)
  expect(avant).toContain('Appareil vendu')
  expect(avant).toContain('Apple E2E iPhone 12 128 Go occasion')
  expect(avant).toContain(`IMEI ${IMEI}`)

  // 4. La fiche corrigée après la vente ne change pas le document émis
  const maj = await request.put(`/api/produits/${id}`, {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data:    { nom: 'Nom corrigé après vente', marque: 'Autre', imei: IMEI_B },
  })
  expect(maj.status(), await maj.text()).toBe(200)
  const apres = await documentFacture(page, factureId)
  expect(apres).toContain(`IMEI ${IMEI}`)
  expect(apres).toContain('Apple E2E iPhone 12 128 Go occasion')
  expect(apres).not.toContain(IMEI_B)
  expect(apres).not.toContain('Nom corrigé après vente')
})

test('IMEI à clé fausse : refusé dans la fiche, et « IMEI invalide » au scan en caisse', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerProduit(request, tenant, { nom: 'E2E Galaxy occasion' })
  await connecter(page, tenant)

  await page.goto('/stock')
  await ouvrirFiche(page, 'E2E Galaxy occasion')
  await page.fill('#stock-imei', '356938035643800')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.locator('body')).toContainText('IMEI invalide')
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')

  await page.goto('/caisse')
  await expect(page.locator('#kpi-nb-tx')).toHaveText('0', { timeout: 15_000 })
  await page.keyboard.type('356938035643800')
  await page.keyboard.press('Enter')
  await expect(page.locator('#vente-produit-results')).toContainText('IMEI invalide (clé de contrôle)')
  await expect(page.locator('#lignes-container .linha-row')).toHaveCount(0)
})

test('un second produit au même IMEI est refusé en nommant la fiche existante', async ({ request }) => {
  const tenant = await createTenantAdmin(request)
  await creerProduit(request, tenant, { nom: 'E2E Pixel 7 occasion', imei: IMEI })
  const res = await request.post('/api/produits', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data:    { nom: 'E2E doublon', imei: IMEI, stock_minimum: 0 },
  })
  expect(res.status()).toBe(409)
  const corps = await res.json()
  expect(corps.champ).toBe('imei')
  expect(corps.error).toContain('E2E Pixel 7 occasion')
})
