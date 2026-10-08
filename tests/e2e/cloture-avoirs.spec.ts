/**
 * @file tests/e2e/cloture-avoirs.spec.ts
 * @description Ticket 02 du chantier avoirs (décisions Q9 et Q14 de l'exploitant, 2026-10-06) : la clôture du
 * jour ne compte plus les avoirs dans les ventes. L'historique des clôtures affiche les ventes, les avoirs émis
 * et le net du jour.
 *
 * Contre la VRAIE D1 locale (migration 0068 appliquée), boutique neuve.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

test('journée avec une facture de 59,97 € et un avoir de 19,99 € : ventes 59,97 €, avoirs − 19,99 €, net 39,98 €', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const entete = { Authorization: `Bearer ${tenant.accessToken}` }

  const client = await request.post('/api/clients', { headers: entete, data: { prenom: 'Jeanne', nom: 'Clôture' } })
  expect(client.status(), await client.text()).toBe(201)
  const facture = await request.post('/api/factures', {
    headers: entete,
    data: {
      client_id: (await client.json()).id, action: 'emettre',
      lignes: [{ description: 'Câble', quantite: 3, prix_unitaire_ttc: 19.99, tva_taux: 20 }],
    },
  })
  expect(facture.status(), await facture.text()).toBe(201)
  const avoir = await request.post('/api/avoirs', {
    headers: entete,
    data: {
      facture_id: (await facture.json()).facture_id, motif: 'Retour',
      lignes: [{ description: 'Câble', quantite: 1, prix_unitaire_ttc: 19.99, tva_taux: 20 }],
    },
  })
  expect(avoir.status(), await avoir.text()).toBe(201)

  const cloture = await request.post('/api/caisse/cloture', { headers: entete, data: {} })
  expect(cloture.status(), await cloture.text()).toBe(201)
  const corps = (await cloture.json()).data
  expect([corps.total_ttc, corps.avoirs_ttc]).toEqual([59.97, 19.99])

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/caisse')
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => (globalThis as any).CaisseApp.switchTab('clotures'))

  const ligne = page.locator(`[data-cloture="${corps.date_cloture}"]`)
  await expect(ligne.locator('[data-champ="ventes-ttc"]')).toContainText('59,97')
  await expect(ligne.locator('[data-champ="avoirs-ttc"]')).toContainText(/−\s*19,99/)
  // HT et TVA des avoirs en texte visible (story 46), pas seulement au survol : 19,99 TTC = 16,66 HT + 3,33 TVA
  await expect(ligne.locator('[data-champ="avoirs-detail"]')).toBeVisible()
  await expect(ligne.locator('[data-champ="avoirs-detail"]')).toContainText(/HT 16,66.*TVA 3,33/)
  await expect(ligne.locator('[data-champ="net-ttc"]')).toContainText('39,98')

  // CA du jour (KPI) = ventes seules, comme la clôture
  const kpis = (await (await request.get('/api/caisse/kpis', { headers: entete })).json()).data
  expect(kpis.today.total_ttc).toBe(59.97)
})

test('journée sans avoir : avoirs à 0, net = ventes', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const entete = { Authorization: `Bearer ${tenant.accessToken}` }
  const client = await request.post('/api/clients', { headers: entete, data: { prenom: 'Jean', nom: 'SansAvoir' } })
  const facture = await request.post('/api/factures', {
    headers: entete,
    data: {
      client_id: (await client.json()).id, action: 'emettre',
      lignes: [{ description: 'Câble', quantite: 1, prix_unitaire_ttc: 12, tva_taux: 20 }],
    },
  })
  expect(facture.status(), await facture.text()).toBe(201)
  const cloture = await request.post('/api/caisse/cloture', { headers: entete, data: {} })
  expect(cloture.status(), await cloture.text()).toBe(201)
  const dateCloture = (await cloture.json()).data.date_cloture

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/caisse')
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => (globalThis as any).CaisseApp.switchTab('clotures'))

  const ligne = page.locator(`[data-cloture="${dateCloture}"]`)
  await expect(ligne.locator('[data-champ="avoirs-ttc"]')).toContainText('0,00')
  await expect(ligne.locator('[data-champ="avoirs-detail"]')).toHaveCount(0)
  await expect(ligne.locator('[data-champ="net-ttc"]')).toContainText('12,00')
})
