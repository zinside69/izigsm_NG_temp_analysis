/**
 * @file tests/e2e/stock-fiche-quantite.spec.ts
 * @description Quantité dans la fiche d'un produit existant (décision du 2026-09-12).
 *
 * `PUT /produits/:id` ignore `stock_actuel` — le stock ne bouge que par un mouvement tracé. La
 * fiche affichait pourtant un champ quantité modifiable : l'opérateur corrigeait son stock, le
 * message annonçait « Produit mis à jour », et rien ne changeait. Désormais le champ est en
 * lecture seule en modification, avec un bouton qui ouvre « Ajuster le stock » ; il reste
 * saisissable à la création, où `POST /produits` enregistre bien le stock initial.
 *
 * Fenêtres `.modal-overlay` : fermées par opacité 0, jamais `toBeVisible()` (`CLAUDE.md`).
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

test('fiche d\'un produit existant : quantité en lecture seule, ajustement par le mouvement tracé', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const res = await request.post('/api/produits', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data:    { nom: 'E2E fiche quantité', stock_actuel: 3, stock_minimum: 1 },
  })
  expect(res.status(), await res.text()).toBe(201)

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/stock')

  // Modification : la quantité s'affiche mais ne se saisit pas
  await page.locator('tr', { hasText: 'E2E fiche quantité' }).locator('button[title="Modifier"]').click()
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
  await expect(page.locator('#stock-qty')).toHaveValue('3')
  await expect(page.locator('#stock-qty')).not.toBeEditable()

  // Le bouton mène au mouvement tracé, sur ce produit
  await page.click('#btn-stock-ajuster')
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '0')
  await expect(page.locator('#modal-adjust-stock')).toHaveCSS('opacity', '1')
  await expect(page.locator('#adjust-current-qty')).toHaveText('3')

  // Création : la quantité initiale reste saisissable, et le bouton n'a pas lieu d'être
  await page.evaluate("closeModal('modal-adjust-stock')")
  await page.evaluate('openNewStock()')
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
  await expect(page.locator('#stock-qty')).toBeEditable()
  await expect(page.locator('#btn-stock-ajuster')).toBeHidden()
})
