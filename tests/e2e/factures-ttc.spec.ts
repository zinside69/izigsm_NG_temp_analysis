/**
 * @file tests/e2e/factures-ttc.spec.ts
 * @description Ticket 03 du chantier prix TTC (décisions Q2 et Q19 de l'exploitant, 2026-10-04) :
 * factures et avoirs se saisissent en prix unitaire TTC et se calculent depuis lui, comme la caisse.
 *
 * - Création à l'écran : 3 × 19,99 € TTC → 59,97 € affichés, émis, facturés.
 * - Impression : colonne « P.U. TTC », récapitulatif HT / TVA par taux / TTC.
 * - Facture émise avant la bascule (lignes en HT) : réimprimée à l'identique, colonne « P.U. HT ».
 * - Avoir à l'écran en TTC : rend exactement les montants de la ligne (59,97 €).
 *
 * La facture est relue par le vrai gabarit (`printFacture()` → `_buildFactureHTML()`) ; seul
 * `_triggerPrint()` est remplacé, pour capter le HTML au lieu d'ouvrir la boîte d'impression.
 * Contre la VRAIE D1 locale (migrations 0062 et 0063 appliquées), boutique neuve à chaque test.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { createTenantAdmin, type TenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

// ═══════════════════════════════════════════════════════════════════════════════
// Aides
// ═══════════════════════════════════════════════════════════════════════════════

const entete = (tenant: TenantAdmin) => ({ Authorization: `Bearer ${tenant.accessToken}` })

async function creerClient(request: APIRequestContext, tenant: TenantAdmin): Promise<number> {
  const res = await request.post('/api/clients', {
    headers: entete(tenant),
    data:    { prenom: 'Jeanne', nom: 'Facturée' },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id as number
}

/** Facture émise par l'API, lignes telles quelles ; rend son identifiant. */
async function factureEmiseParApi(request: APIRequestContext, tenant: TenantAdmin, clientId: number, lignes: unknown[]) {
  const res = await request.post('/api/factures', {
    headers: entete(tenant),
    data:    { client_id: clientId, lignes, action: 'emettre' },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).facture_id as number
}

async function ouvrirFactures(page: Page, tenant: TenantAdmin) {
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/factures')
  await page.waitForLoadState('networkidle')
  // Émettre et créer un avoir passent par un `confirm()` : on accepte
  page.on('dialog', dialogue => dialogue.accept())
}

/** HTML de la facture tel que le vrai gabarit le construit pour l'impression. */
async function documentFacture(page: Page, factureId: number): Promise<string> {
  return page.evaluate(async (id) => {
    const g = globalThis as any
    let capte = ''
    g._triggerPrint = (html: string) => { capte = html }
    await g.printFacture(id)
    return capte
  }, factureId)
}

async function factureParApi(request: APIRequestContext, tenant: TenantAdmin, id: number) {
  return (await (await request.get(`/api/factures/${id}`, { headers: entete(tenant) })).json()).data
}

// ═══════════════════════════════════════════════════════════════════════════════
// Création, impression, avoir
// ═══════════════════════════════════════════════════════════════════════════════

test('création à l\'écran en TTC : 3 × 19,99 € → 59,97 € affichés et facturés', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const clientId = await creerClient(request, tenant)
  await ouvrirFactures(page, tenant)

  await page.getByRole('button', { name: '+ Nouvelle facture' }).first().click()
  await page.selectOption('#f-client', String(clientId))
  const ligne = page.locator('#facture-lines tr').first()
  await ligne.locator('input[id^="fl-desc-"]').fill('Câble USB-C')
  await ligne.locator('input[id^="fl-qty-"]').fill('3')
  await ligne.locator('input[id^="fl-price-"]').fill('19.99')
  await ligne.locator('select[id^="fl-tva-"]').selectOption('20')
  await expect(page.locator('#f-total-ttc')).toHaveText(/59,97/)
  await expect(page.locator('#f-subtotal-ht')).toHaveText(/49,98/)
  await expect(page.locator('#f-total-tva')).toHaveText(/9,99/)

  const reponse = page.waitForResponse(r => r.url().includes('/api/factures') && r.request().method() === 'POST')
  await page.getByRole('button', { name: '📄 Émettre' }).click()
  const corps = await (await reponse).json()
  expect(corps.success, JSON.stringify(corps)).toBe(true)

  const facture = await factureParApi(request, tenant, corps.facture_id)
  expect([facture.total_ht, facture.total_tva, facture.total_ttc]).toEqual([49.98, 9.99, 59.97])
  expect(facture.lignes.map((l: any) => [l.mode_calcul, l.prix_unitaire_ttc])).toEqual([['ttc', 19.99]])
})

test('impression d\'une facture en TTC : colonne P.U. TTC, récapitulatif HT / TVA par taux / TTC', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const clientId = await creerClient(request, tenant)
  const factureId = await factureEmiseParApi(request, tenant, clientId, [
    { description: 'Câble USB-C', quantite: 3, prix_unitaire_ttc: 19.99, tva_taux: 20 },
    { description: 'Livre',       quantite: 2, prix_unitaire_ttc: 7.77,  tva_taux: 5.5 },
  ])
  await ouvrirFactures(page, tenant)

  const html = await documentFacture(page, factureId)
  expect(html).toContain('P.U. TTC')
  expect(html).not.toContain('P.U. HT')
  expect(html).toMatch(/19,99/)
  expect(html).toMatch(/7,77/)
  // Récapitulatif par taux : 20 % → base 49,98 / TVA 9,99 ; 5,5 % → base 14,73 / TVA 0,81
  expect(html).toMatch(/49,98/)
  expect(html).toMatch(/14,73/)
  expect(html).toMatch(/0,81/)
  // Total TTC = 59,97 + 15,54
  expect(html).toMatch(/75,51/)
})

test('facture émise avant la bascule (lignes en HT) : réimprimée à l\'identique, colonne P.U. HT', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const clientId = await creerClient(request, tenant)
  const factureId = await factureEmiseParApi(request, tenant, clientId, [
    { description: 'Écran', quantite: 1, prix_unitaire_ht: 220, tva_taux: 20 },
  ])
  await ouvrirFactures(page, tenant)

  const html = await documentFacture(page, factureId)
  expect(html).toContain('P.U. HT')
  expect(html).not.toContain('P.U. TTC')
  expect(html).toMatch(/220,00/)
  expect(html).toMatch(/264,00/)
})

test('avoir saisi en TTC sur la ligne entière : 59,97 €, exactement la ligne de facture', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const clientId = await creerClient(request, tenant)
  const factureId = await factureEmiseParApi(request, tenant, clientId, [
    { description: 'Câble USB-C', quantite: 3, prix_unitaire_ttc: 19.99, tva_taux: 20 },
  ])
  await ouvrirFactures(page, tenant)

  await page.evaluate((id) => (globalThis as any).openModalAvoir(id), factureId)
  await page.fill('#avoir-motif', 'Retour')
  const ligne = page.locator('#avoir-lines tr').first()
  await ligne.locator('input[id^="al-desc-"]').fill('Câble USB-C')
  await ligne.locator('input[id^="al-qty-"]').fill('3')
  await ligne.locator('input[id^="al-price-"]').fill('19.99')
  await ligne.locator('select[id^="al-tva-"]').selectOption('20')
  await expect(page.locator('#avoir-total-ttc')).toHaveText(/59,97/)

  const reponse = page.waitForResponse(r => r.url().includes('/api/avoirs') && r.request().method() === 'POST')
  await page.getByRole('button', { name: /Émettre l'avoir/ }).click()
  const corps = await (await reponse).json()
  expect(corps.success, JSON.stringify(corps)).toBe(true)

  const avoir = (await (await request.get(`/api/avoirs/${corps.id}`, { headers: entete(tenant) })).json()).data
  expect([avoir.total_ht, avoir.total_tva, avoir.total_ttc]).toEqual([49.98, 9.99, 59.97])
})

test('avoir à 5,5 % (revue) : le taux de la ligne fait la ventilation — 2 × 7,77 € → 14,73 HT / 0,81 TVA', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const clientId = await creerClient(request, tenant)
  const factureId = await factureEmiseParApi(request, tenant, clientId, [
    { description: 'Livre', quantite: 2, prix_unitaire_ttc: 7.77, tva_taux: 5.5 },
  ])
  await ouvrirFactures(page, tenant)

  await page.evaluate((id) => (globalThis as any).openModalAvoir(id), factureId)
  await page.fill('#avoir-motif', 'Retour')
  const ligne = page.locator('#avoir-lines tr').first()
  await ligne.locator('input[id^="al-desc-"]').fill('Livre')
  await ligne.locator('input[id^="al-qty-"]').fill('2')
  await ligne.locator('input[id^="al-price-"]').fill('7.77')
  await ligne.locator('select[id^="al-tva-"]').selectOption('5.5')
  await expect(page.locator('#avoir-total-ht')).toHaveText(/14,73/)
  await expect(page.locator('#avoir-total-tva')).toHaveText(/0,81/)

  const reponse = page.waitForResponse(r => r.url().includes('/api/avoirs') && r.request().method() === 'POST')
  await page.getByRole('button', { name: /Émettre l'avoir/ }).click()
  const corps = await (await reponse).json()
  expect(corps.success, JSON.stringify(corps)).toBe(true)
  const avoir = (await (await request.get(`/api/avoirs/${corps.id}`, { headers: entete(tenant) })).json()).data
  expect([avoir.total_ht, avoir.total_tva, avoir.total_ttc]).toEqual([14.73, 0.81, 15.54])
})
