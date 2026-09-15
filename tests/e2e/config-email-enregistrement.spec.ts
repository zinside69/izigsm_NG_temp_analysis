/**
 * @file tests/e2e/config-email-enregistrement.spec.ts
 * @description Enregistrer la configuration email — Réglages › Email (`settings.html #form-email`)
 * et Notifications (`notifications.html #config-form`).
 *
 * Revue du 2026-09-15 : ces deux formulaires portent une clé API en `type="password"` ; leur
 * `onsubmit="fonction(event)"` a été remplacé par `onsubmit="return false"` + un
 * `addEventListener('submit')` (CLAUDE.md § Formulaires avec mot de passe). Aucun test ne soumettait
 * ces formulaires : un écouteur oublié aurait rendu l'enregistrement muet, sans aucune erreur.
 *
 * Observé à l'écran, après rechargement — jamais seulement par un appel API réussi
 * (`project-docs/modop-tests.md`). La valeur relue est l'expéditeur (`email_from`) : la clé API,
 * elle, n'est jamais réaffichée (sécurité). Chaque test crée son propre tenant.
 */
import { test, expect, type Page } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

/** Connexion d'un tenant neuf. */
async function connecter(page: Page, request: Parameters<typeof createTenantAdmin>[0]) {
  const tenant = await createTenantAdmin(request)
  await seConnecter(page, tenant)
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
}

/** Réglages › Email ouvert. */
async function ouvrirReglagesEmail(page: Page) {
  await page.goto('/settings')
  await page.click('[data-tab="email"]')
  await expect(page.locator('#tab-email')).toBeVisible()
}

test.describe('Configuration email — l\'enregistrement part et tient', () => {
  test('Réglages › Email : l\'expéditeur est enregistré, relu après rechargement', async ({ page, request }) => {
    await connecter(page, request)
    await ouvrirReglagesEmail(page)
    const expediteur = `Atelier E2E <noreply-${Date.now()}@exemple.fr>`
    await page.fill('#email_from', expediteur)
    await page.click('#form-email button[type="submit"]')
    await expect(page.locator('.toast', { hasText: 'Configuration email enregistrée' }).last()).toBeVisible()
    // Aucune soumission native : l'adresse n'a pas bougé
    expect(page.url()).not.toContain('?')

    await page.reload()
    await page.click('[data-tab="email"]')
    await expect(page.locator('#email_from')).toHaveValue(expediteur)
  })

  test('Notifications : l\'expéditeur est enregistré et le succès annoncé, relu dans les réglages', async ({ page, request }) => {
    await connecter(page, request)
    await page.goto('/notifications')
    const expediteur = `Atelier E2E <notif-${Date.now()}@exemple.fr>`
    await page.fill('#cfg-from', expediteur)
    await page.click('#config-form button[type="submit"]')
    await expect(page.getByText('Configuration sauvegardée')).toBeVisible()
    expect(page.url()).not.toContain('?')

    // Même réglage que l'onglet Email : relu là-bas, depuis la base
    await ouvrirReglagesEmail(page)
    await expect(page.locator('#email_from')).toHaveValue(expediteur)
  })
})
