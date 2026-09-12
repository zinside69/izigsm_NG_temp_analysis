/**
 * @file tests/e2e/stock-a-commander.spec.ts
 * @description Page Stock : « À commander » au lieu de « Stock bas » / « Alertes seuil bas »
 *              (décision de l'exploitant du 2026-09-12, vocabulaire `CONTEXT.md` § Stock).
 *
 * Le glossaire définit « à commander » : produit **surveillé** (seuil > 0) dont la quantité est
 * inférieure ou égale à son seuil — rupture comprise. La page comptait autrement : son indicateur
 * additionnait les produits sous le seuil (hors rupture) et **toutes** les ruptures, même celles
 * des produits non surveillés ; son filtre écartait les ruptures surveillées. Renommer sans
 * aligner aurait fait mentir l'écran : libellés et calculs suivent désormais la règle du serveur
 * (`sqlSousSeuil()`). La rupture reste un état affiché à part (badge « Rupture »).
 *
 * Boutique neuve, quatre produits : deux à commander, deux qui ne le sont pas.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

test('page Stock : « À commander » compte et filtre les seuls produits surveillés sous leur seuil', async ({ page, request }) => {
  const tenant  = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }

  for (const produit of [
    { nom: 'E2E AC sous seuil',             stock_actuel: 1, stock_minimum: 2 },  // à commander
    { nom: 'E2E AC rupture surveillée',     stock_actuel: 0, stock_minimum: 2 },  // à commander + rupture
    { nom: 'E2E AC rupture non surveillée', stock_actuel: 0, stock_minimum: 0 },  // rupture seule
    { nom: 'E2E AC en stock',               stock_actuel: 5, stock_minimum: 0 },  // rien
  ]) {
    const res = await request.post('/api/produits', { headers, data: produit })
    expect(res.status(), await res.text()).toBe(201)
  }

  await seConnecter(page, tenant)
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/stock')
  await expect(page.locator('#kpi-refs')).toHaveText('4', { timeout: 15_000 })

  // Indicateur : libellé du glossaire, deux produits — pas trois
  await expect(page.locator('.kpi-label', { hasText: 'À commander' })).toBeVisible()
  await expect(page.locator('#kpi-alerts')).toHaveText('2')

  // Plus aucun libellé à éviter sur la page
  await expect(page.getByText(/stock bas|seuil bas/i)).toHaveCount(0)

  // Badge de ligne : « À commander » sous le seuil, « Rupture » reste un état à part
  const ligne = (nom: string) => page.locator('#stock-tbody tr', { hasText: nom })
  await expect(ligne('E2E AC sous seuil')).toContainText('À commander')
  await expect(ligne('E2E AC rupture surveillée')).toContainText('Rupture')

  // Filtre : les deux produits à commander, rupture surveillée comprise
  const filtre = page.locator('[data-filter-stock="low"]')
  await expect(filtre).toContainText('À commander')
  await filtre.click()
  await expect(page.locator('#stock-tbody tr', { hasText: 'E2E AC' })).toHaveCount(2)
  await expect(ligne('E2E AC sous seuil')).toBeVisible()
  await expect(ligne('E2E AC rupture surveillée')).toBeVisible()
})
