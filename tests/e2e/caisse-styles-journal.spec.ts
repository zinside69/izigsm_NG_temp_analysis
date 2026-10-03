/**
 * @file tests/e2e/caisse-styles-journal.spec.ts
 * @description Les styles maison de la page Caisse s'appliquent (défaut trouvé le 2026-10-03).
 *
 * `caisse.html` écrit ses classes (`.journal-row`, `.tab-btn`, `.kpi-card`, `.badge-vente`…) avec
 * `@apply`, syntaxe de Tailwind. Posées dans un `<style>` ordinaire, le navigateur les ignorait toutes,
 * en silence, depuis la création de la page (juin) : le « Journal du jour » s'affichait en texte collé,
 * sans colonnes. Le Tailwind du CDN ne traite `@apply` que dans `<style type="text/tailwindcss">`.
 *
 * Mesuré par le style CALCULÉ du navigateur (`toHaveCSS`), jamais par la présence de la classe :
 * la classe était bien là, c'est sa règle qui manquait.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

test('journal du jour : chaque ligne est une grille de colonnes, la pastille « vente » est colorée', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const vente = await request.post('/api/caisse/vente', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data: { mode_paiement: 'cb', lignes: [{ designation: 'E2E Coque', quantite: 1, prix_unitaire_ht: 10, tva_taux: 20 }] },
  })
  expect(vente.status(), await vente.text()).toBe(201)

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/caisse')

  const ligneDeVente = page.locator('#journal-list .journal-row', { hasText: 'FAC-' }).first()
  await expect(ligneDeVente).toBeVisible({ timeout: 15_000 })
  await expect(ligneDeVente, 'la ligne doit être disposée en colonnes').toHaveCSS('display', 'grid')

  const entete = page.locator('.journal-row', { hasText: /heure/i }).first()
  await expect(entete).toHaveCSS('display', 'grid')

  // La pastille du type « vente » a un fond (vert), pas le fond transparent d'une règle ignorée
  const pastille = ligneDeVente.locator('.badge-vente')
  await expect(pastille).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
})
