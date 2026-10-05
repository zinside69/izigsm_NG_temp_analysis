/**
 * @file tests/e2e/stock-prix-ttc.spec.ts
 * @description Prix de vente TTC des pièces à l'écran (ticket 01 du chantier prix TTC, décision Q1 de
 * l'exploitant du 2026-10-04) : le manager saisit le prix de vente en TTC dans la fiche ; le HT et la
 * TVA déduits s'affichent dessous ; 9,90 € saisi se relit 9,90 € dans la liste et dans la fiche.
 * Contre la vraie D1 locale (migration 0062 appliquée).
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

async function ouvrirStock(page: Page, request: APIRequestContext) {
  const tenant = await createTenantAdmin(request)
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/stock')
}

test('fiche : 9,90 € TTC saisi → HT et TVA déduits affichés, relu 9,90 € dans la liste et la fiche', async ({ page, request }) => {
  await ouvrirStock(page, request)

  await page.evaluate('openNewStock()')
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
  await expect(page.locator('label[for="stock-price"]')).toHaveText('Prix de vente TTC (€)')
  await page.fill('#stock-name', 'E2E écran prix TTC')
  await page.fill('#stock-price', '9.90')
  // HT et TVA déduits du TTC saisi, au taux de la fiche (20 % par défaut)
  await expect(page.locator('#stock-prix-detail')).toContainText('HT : 8,25')
  await expect(page.locator('#stock-prix-detail')).toContainText('TVA 20 % : 1,65')
  await page.locator('#modal-stock button', { hasText: 'Enregistrer' }).click()
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '0')

  // Liste : colonne « Prix vente TTC », 9,90 € tel que saisi
  await expect(page.locator('.table-card thead').first()).toContainText('Prix vente TTC')
  const ligne = page.locator('#stock-tbody tr', { hasText: 'E2E écran prix TTC' })
  await expect(ligne).toContainText('9,90')

  // Fiche rouverte : le champ redit 9,90 (TTC), pas le HT
  await ligne.getByTitle('Modifier').click()
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
  await expect(page.locator('#stock-price')).toHaveValue('9.9')
  await expect(page.locator('#stock-prix-detail')).toContainText('HT : 8,25')
})
