/**
 * @file tests/e2e/services-synchro-resume.spec.ts
 * @description Résumé de la synchro phone-specs-api (catalogue services, onglet Marques & Modèles).
 *
 * Défaut vu en production le 2026-10-04 : chaque marque échouait (403 pour le manager), et la fenêtre
 * affichait pourtant une coche verte et « Synchronisation terminée » — l'erreur restait cachée dans le
 * journal. Contrat : un échec se lit comme un échec, et chaque erreur est nommée dans le résumé.
 * Réponses d'iziGSM simulées (`page.route()`) : aucun appel à l'API externe.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

test('synchro dont toutes les marques échouent : résumé en échec, erreur nommée', async ({ page, request }) => {
  await page.route('**/api/services/catalog/sync-status*', route => route.fulfill({ json: { success: true, data: [
    { id: 1, nom: 'Apple', brand_slug: 'apple-phones-48', nb_modeles: 146, synced_at: null },
  ] } }))
  await page.route('**/api/services/catalog/sync-modeles/**', route => route.fulfill({
    status: 422, json: { success: false, error: 'API phone-specs indisponible (503).' },
  }))

  const tenant = await createTenantAdmin(request)
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/services')
  await page.click('#tab-modeles')
  await page.getByRole('button', { name: /Synchroniser API/ }).click()
  await page.locator('.sync-cb[data-slug="apple-phones-48"]').check()
  await page.click('#sync-btn-start')

  const resume = page.locator('#sync-step-done')
  await expect(resume).toBeVisible()
  await expect(page.locator('#sync-resume-titre')).toHaveText('Synchronisation échouée')
  await expect(resume).not.toContainText('Synchronisation terminée')
  await expect(resume).toContainText('Apple — API phone-specs indisponible (503).')
})

test('synchro réussie : résumé en succès, aucune erreur listée', async ({ page, request }) => {
  await page.route('**/api/services/catalog/sync-status*', route => route.fulfill({ json: { success: true, data: [
    { id: 1, nom: 'Apple', brand_slug: 'apple-phones-48', nb_modeles: 146, synced_at: null },
  ] } }))
  await page.route('**/api/services/catalog/sync-modeles/**', route => route.fulfill({ json: {
    success: true, data: { brand_slug: 'apple-phones-48', modeles_added: 2, modeles_total: 148, pages_fetched: 1, status: 'success' },
  } }))

  const tenant = await createTenantAdmin(request)
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/services')
  await page.click('#tab-modeles')
  await page.getByRole('button', { name: /Synchroniser API/ }).click()
  await page.locator('.sync-cb[data-slug="apple-phones-48"]').check()
  await page.click('#sync-btn-start')

  await expect(page.locator('#sync-resume-titre')).toHaveText('Synchronisation terminée')
  await expect(page.locator('#sync-summary-text')).toHaveText('2 modèle(s) ajouté(s) · 1 marque(s) ok · 0 erreur(s)')
  await expect(page.locator('#sync-resume-erreurs')).toBeEmpty()
})
