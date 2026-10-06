/**
 * @file tests/e2e/services-ttc.spec.ts
 * @description Ticket 04 du chantier prix TTC (décisions Q1 et Q8 de l'exploitant, 2026-10-04) : le prix
 * d'un service et le prix spécifique d'un service pour un modèle se saisissent en TTC, qui fait foi ;
 * le HT s'en déduit et s'affiche en second. Un ancien écran qui envoie le HT seul est converti.
 * En caisse, un service est proposé à son TTC stocké.
 *
 * Contre la VRAIE D1 locale (migration 0064 appliquée), boutique neuve à chaque test. La base locale
 * n'a aucun modèle d'appareil : un modèle est créé par l'admin plateforme (seul habilité, référentiel
 * global), puis lié par le manager de la boutique neuve.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { createTenantAdmin, type TenantAdmin } from './fixtures/tenant'
import { seConnecter, obtenirToken, ADMIN_PLATEFORME } from './fixtures/comptes'

// ═══════════════════════════════════════════════════════════════════════════════
// Aides
// ═══════════════════════════════════════════════════════════════════════════════

const entete = (jeton: string) => ({ Authorization: `Bearer ${jeton}` })

/** Un modèle d'appareil neuf (marque et modèle uniques), créé par l'admin plateforme ; rend son id. */
async function creerModele(request: APIRequestContext): Promise<number> {
  const jeton = await obtenirToken(request, ADMIN_PLATEFORME)
  const suffixe = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const marque = await request.post('/api/services/marques', { headers: entete(jeton), data: { nom: `E2E Marque ${suffixe}` } })
  expect(marque.status(), await marque.text()).toBe(201)
  const modele = await request.post('/api/services/modeles', {
    headers: entete(jeton),
    data:    { nom: `E2E Modèle ${suffixe}`, marque_id: (await marque.json()).id },
  })
  expect(modele.status(), await modele.text()).toBe(201)
  return (await modele.json()).id as number
}

/** Un service de la boutique du tenant, par l'API ; rend son id. */
async function creerService(request: APIRequestContext, tenant: TenantAdmin, data: Record<string, unknown>): Promise<number> {
  const res = await request.post('/api/services', { headers: entete(tenant.accessToken), data: { tva_taux: 20, ...data } })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id as number
}

async function serviceParApi(request: APIRequestContext, tenant: TenantAdmin, id: number) {
  return (await (await request.get(`/api/services/${id}`, { headers: entete(tenant.accessToken) })).json()).data
}

async function connecter(page: Page, tenant: TenantAdmin) {
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Catalogue : saisie en TTC
// ═══════════════════════════════════════════════════════════════════════════════

test('catalogue : service saisi à 49,90 € TTC → HT 41,58 affiché en second, TTC stocké tel quel', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await connecter(page, tenant)
  await page.goto('/services')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: '＋ Service' }).click()
  await page.fill('#svc-nom', 'E2E Pose de film')
  await page.fill('#svc-prix', '49.90')
  await page.selectOption('#svc-tva', '20')
  await expect(page.locator('#svc-prix-detail')).toContainText('HT : 41.58')

  const reponse = page.waitForResponse(r => r.url().includes('/api/services') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Enregistrer' }).first().click()
  const corps = await (await reponse).json()
  expect(corps.success, JSON.stringify(corps)).toBe(true)

  const service = await serviceParApi(request, tenant, corps.id)
  expect([service.prix_ttc, service.prix_ht]).toEqual([49.9, 41.58])
})

test('prix par modèle saisi à 129 € TTC → stocké tel quel, HT 107,50 affiché en second', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const modeleId = await creerModele(request)
  const serviceId = await creerService(request, tenant, { nom: 'E2E Écran', prix_ttc: 99 })
  await connecter(page, tenant)
  await page.goto('/services')
  await page.waitForLoadState('networkidle')

  await page.evaluate(id => (globalThis as any).openModalLiaison(id, 'E2E Modèle'), modeleId)
  await page.selectOption('#liaison-service-select', String(serviceId))
  await page.fill('#liaison-prix-specifique', '129')
  await page.locator('#modal-liaison').getByRole('button', { name: '＋' }).click()

  const ligne = page.locator('#liaison-services-list', { hasText: 'E2E Écran' })
  await expect(ligne).toContainText('129.00 € TTC')
  await expect(ligne).toContainText('HT 107.50')

  const liaisons = (await (await request.get(`/api/services/modeles/${modeleId}/services`, { headers: entete(tenant.accessToken) })).json()).data.services
  expect(liaisons.map((s: any) => [s.prix_ttc_specifique, s.prix_ht_specifique, s.prix_ttc_effectif])).toEqual([[129, 107.5, 129]])
})

// ═══════════════════════════════════════════════════════════════════════════════
// API : TTC prioritaire, HT converti (transition)
// ═══════════════════════════════════════════════════════════════════════════════

test('API : HT seul (ancien écran) converti — service 50 € HT → 60 € TTC, prix par modèle 99,99 € HT → 119,99 € TTC', async ({ request }) => {
  const tenant = await createTenantAdmin(request)
  const modeleId = await creerModele(request)
  const serviceId = await creerService(request, tenant, { nom: 'E2E Diagnostic', prix_ht: 50 })
  const service = await serviceParApi(request, tenant, serviceId)
  expect([service.prix_ttc, service.prix_ht]).toEqual([60, 50])

  const lien = await request.post(`/api/services/modeles/${modeleId}/services`, {
    headers: entete(tenant.accessToken),
    data:    { service_id: serviceId, prix_ht_specifique: 99.99 },
  })
  expect(lien.status(), await lien.text()).toBe(200)
  const liaisons = (await (await request.get(`/api/services/modeles/${modeleId}/services`, { headers: entete(tenant.accessToken) })).json()).data.services
  expect(liaisons.map((s: any) => [s.prix_ttc_specifique, s.prix_ht_specifique])).toEqual([[119.99, 99.99]])
})

// ═══════════════════════════════════════════════════════════════════════════════
// Caisse : service proposé à son TTC
// ═══════════════════════════════════════════════════════════════════════════════

test('caisse : un service saisi à 9,99 € TTC est proposé à 9,99 € (et non 10,00 €)', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerService(request, tenant, { nom: 'E2E Coque posée', prix_ttc: 9.99 })
  await connecter(page, tenant)
  await page.goto('/caisse')
  await expect(page.locator('#kpi-nb-tx')).not.toHaveText('—', { timeout: 15_000 })
  await page.click('#btn-nouvelle-vente')

  await page.locator('#vente-produit-search').pressSequentially('Coque posée')
  const resultat = page.locator('#vente-produit-results:not(.hidden) [data-service-id]').first()
  await expect(resultat).toContainText('9,99')
  await resultat.click()
  await expect(page.locator('#lignes-container .linha-row [data-field="prix_unitaire_ttc"]')).toHaveValue('9.99')
  await expect(page.locator('#total-ttc-vente')).toHaveText(/9,99/)
})

test('catalogue : taux 0 % (franchise) gardé à l\'enregistrement et au rechargement — 60 € TTC = 60 € HT (revue)', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await connecter(page, tenant)
  await page.goto('/services')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: '＋ Service' }).click()
  await page.fill('#svc-nom', 'E2E Réparation franchise')
  await page.fill('#svc-prix', '60')
  await page.selectOption('#svc-tva', '0')
  const reponse = page.waitForResponse(r => r.url().includes('/api/services') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Enregistrer' }).first().click()
  const corps = await (await reponse).json()

  const service = await serviceParApi(request, tenant, corps.id)
  expect([service.prix_ttc, service.prix_ht, service.tva_taux]).toEqual([60, 60, 0])

  // Rechargé dans le formulaire : le taux reste 0 %
  await page.evaluate(id => (globalThis as any).openModalService(id), corps.id)
  await expect(page.locator('#svc-tva')).toHaveValue('0')
})
