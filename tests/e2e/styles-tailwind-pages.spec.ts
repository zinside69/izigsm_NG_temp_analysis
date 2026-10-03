/**
 * @file tests/e2e/styles-tailwind-pages.spec.ts
 * @description Styles maison en `@apply` effectivement appliqués sur `personnel.html` et `sav.html`
 * (même défaut que la page Caisse, trouvé le 2026-10-03 — `caisse-styles-journal.spec.ts`).
 *
 * Ces pages écrivaient `.statut-badge` (Personnel), `.badge` et `.tab-btn` (SAV) en `@apply` dans un
 * `<style>` ordinaire : le navigateur ignorait ces règles, en silence. Le Tailwind du CDN ne traite
 * `@apply` que dans `<style type="text/tailwindcss">`.
 *
 * Mesuré par le style CALCULÉ (`toHaveCSS`) : la classe était présente, c'est sa règle qui manquait.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

test('Personnel : la pastille de statut d\'un employé est mise en forme (inline-flex, arrondie)', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const creation = await request.post('/api/employes', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data: { prenom: 'Styles', nom: 'Pastille', poste: 'technicien' },
  })
  expect(creation.status(), await creation.text()).toBe(201)

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/personnel')

  const pastille = page.locator('.employe-card .statut-badge').first()
  await expect(pastille).toBeVisible({ timeout: 15_000 })
  // AVANT (2026-10-03) : await expect(pastille, 'la pastille doit être une boîte en ligne (inline-flex)').toHaveCSS('display', 'inline-flex')
  // La pastille est un enfant direct d'un conteneur `flex flex-col` : le navigateur « blockifie » son
  // display calculé (inline → block, inline-flex → flex). Règle ignorée : « block » ; appliquée : « flex ».
  await expect(pastille, 'règle .statut-badge appliquée (inline-flex, blockifié en flex)').toHaveCSS('display', 'flex')
  await expect(pastille).toHaveCSS('border-radius', '9999px')
})

// AVANT (2026-10-03) : ce test exigeait l'onglet souligné en indigo (règle @apply de la page). Mesure
// faite : le socle `main.css` style déjà `.tab-btn` (violet du thème) ; décision de l'exploitant : garder
// le style du socle. Le test vérifie donc la pastille réparée ET l'onglet resté au style du socle.
test('SAV : la pastille de statut d\'une garantie est mise en forme, les onglets gardent le style du socle', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const garantie = await request.post('/api/garanties', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data: { appareil_marque: 'Apple', appareil_modele: 'iPhone 12', description_reparation: 'Écran', garantie_jours: 90 },
  })
  expect(garantie.status(), await garantie.text()).toBe(201)

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/sav')

  const pastille = page.locator('span.badge').first()
  await expect(pastille).toBeVisible({ timeout: 15_000 })
  await expect(pastille, 'la pastille doit être une boîte en ligne (inline-flex)').toHaveCSS('display', 'inline-flex')

  // Onglet actif : style du socle — souligné du violet du thème (rgb(108, 71, 255)), sans fond
  const ongletActif = page.locator('#tab-garanties')
  await expect(ongletActif).toHaveCSS('border-bottom-color', 'rgb(108, 71, 255)')
  await expect(ongletActif).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
})

test('Caisse : les onglets gardent le style du socle (aucune pastille bleue pleine)', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/caisse')

  const ongletActif = page.locator('.tab-btn.active').first()
  await expect(ongletActif).toBeVisible({ timeout: 15_000 })
  await expect(ongletActif, 'pas de fond bleu (bg-blue-600) : style du socle').toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
})
