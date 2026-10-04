/**
 * @file tests/e2e/ca-ht-ttc.spec.ts
 * @description Chiffre d'affaires en HT et en TTC côte à côte (ticket 11 du chantier prix TTC,
 * décision Q21 de l'exploitant du 2026-10-04) : tableau de bord et page Statistiques.
 * Réponses de `/api/stats` simulées (`page.route()`) : montants connus, rendu vérifié à l'écran.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

async function simulerStatistiques(page: Page) {
  await page.route(/\/api\/stats(\?.*)?$/, route => route.fulfill({ json: { success: true, data: {
    ca_mois: 180, ca_mois_ht: 150, ca_mois_precedent: 12, ca_mois_precedent_ht: 10, evolution_ca_pct: 1400,
  } } }))
  await page.route(/\/api\/stats\/ca-mensuel/, route => route.fulfill({ json: { success: true, data: {
    mois: [], total_12_mois: 192, total_12_mois_ht: 160, moyenne_mensuelle: 16,
  } } }))
}

async function seConnecterNeuf(page: Page, request: APIRequestContext) {
  const tenant = await createTenantAdmin(request)
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
}

test('tableau de bord : CA du mois en TTC et en HT', async ({ page, request }) => {
  await simulerStatistiques(page)
  await seConnecterNeuf(page, request)
  await page.goto('/dashboard')
  await expect(page.locator('#kpi-ca')).toContainText('180')
  await expect(page.locator('#kpi-ca-ht')).toContainText('HT : 150')
})

test('statistiques : CA du mois et CA 12 mois en TTC et en HT', async ({ page, request }) => {
  await simulerStatistiques(page)
  await seConnecterNeuf(page, request)
  await page.goto('/stats')
  await expect(page.locator('#kpi-ca-mois')).toContainText('180')
  await expect(page.locator('#kpi-ca-mois-ht')).toContainText('HT : 150')
  await expect(page.locator('#kpi-ca-total')).toContainText('192')
  await expect(page.locator('#kpi-ca-total-ht')).toContainText('HT : 160')
})
