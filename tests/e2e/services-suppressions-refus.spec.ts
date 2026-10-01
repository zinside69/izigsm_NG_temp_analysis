/**
 * @file tests/e2e/services-suppressions-refus.spec.ts
 * @description Page Services, référentiel marques / modèles / liaisons : une suppression refusée
 * par le serveur est DITE à l'opérateur (`todo.md` 🟡 P3, recherche du 2026-10-01).
 *
 * `deleteMarque()`, `deleteModele()` et `removeLiaison()` (`services.js`) faisaient
 * `await apiDelete(…)` sans lire la réponse : `api()` ne lève pas sur une erreur HTTP, la liste
 * était relue et l'opérateur ne voyait rien — ni succès, ni refus.
 *
 * Cas réel, sans simulation, pour la marque et le modèle : un **manager** voit le bouton 🗑 du
 * référentiel global, mais les routes de suppression sont `requireRole('admin')` → 403. Le
 * manager étant refusé, aucune donnée globale n'est touchée. La liaison (ouverte aux managers)
 * passe par un refus simulé (`page.route`).
 *
 * Ces chemins suivent la convention « déballage » de `services.js` (`CLAUDE.md` : deux conventions
 * gardées délibérément) : message du serveur par `alert()`, comme `saveMarque()`.
 */
import { test, expect, type Page } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

/** Manager d'une boutique neuve sur l'onglet Modèles de `/services` ; dialogues consignés et acceptés. */
async function ouvrirReferentiel(page: Page, request: any): Promise<string[]> {
  const dialogues: string[] = []
  page.on('dialog', async d => { dialogues.push(`${d.type()}: ${d.message()}`); await d.accept() })
  const tenant = await createTenantAdmin(request)
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/services')
  await page.click('#tab-modeles')
  await expect(page.locator('#marques-list .marque-item').first()).toBeVisible({ timeout: 15_000 })
  return dialogues
}

/**
 * La base locale n'a aucun modèle (toutes les marques affichent 0) : la liste des modèles de la
 * marque choisie est simulée. Prédicat sur l'URL plutôt qu'un motif : `apiGet` ajoute
 * `boutique_id` à la query.
 */
async function simulerUnModele(page: Page) {
  await page.route(u => u.pathname === '/api/services/modeles' && u.searchParams.has('marque_id'), route =>
    route.fulfill({ json: { success: true, data: [
      { id: 9002, nom: 'Modèle E2E', marque_nom: 'Marque E2E', type: 'smartphone', annee: null },
    ] } }))
}

/** Le dernier dialogue est une alerte qui porte un message — le refus a été dit. */
async function refusAnnonce(dialogues: string[]) {
  await expect.poll(() => dialogues.filter(d => d.startsWith('alert:')).length, { timeout: 10_000 }).toBeGreaterThan(0)
  const alerte = dialogues.filter(d => d.startsWith('alert:')).pop()!
  expect(alerte.replace('alert:', '').trim().length).toBeGreaterThan(0)
}

test.describe('Services — une suppression refusée est annoncée', () => {
  test('marque : un manager refusé (403) voit le refus, la marque reste', async ({ page, request }) => {
    const dialogues = await ouvrirReferentiel(page, request)
    const premiere = page.locator('#marques-list .marque-item').first()
    const id = await premiere.getAttribute('id')
    // Les actions d'une marque n'apparaissent qu'au survol (`.marque-item:hover .marque-actions`)
    await premiere.hover()
    await premiere.locator('button.btn-danger').click()

    expect(dialogues.some(d => d.startsWith("confirm:")), "confirmation demandée").toBe(true)
    await refusAnnonce(dialogues)
    await expect(page.locator(`#${id}`)).toBeVisible()
  })

  test('modèle : un manager refusé (403) voit le refus', async ({ page, request }) => {
    // Liste simulée, suppression RÉELLE : `requireRole('admin')` refuse le manager avant toute lecture
    await simulerUnModele(page)
    const dialogues = await ouvrirReferentiel(page, request)
    await page.locator('#marques-list .marque-item').first().click()
    const carte = page.locator('.modele-card').first()
    await expect(carte).toBeVisible({ timeout: 15_000 })
    await carte.locator('button.btn-danger').click()

    expect(dialogues.some(d => d.startsWith("confirm:")), "confirmation demandée").toBe(true)
    await refusAnnonce(dialogues)
  })

  test('liaison : un refus du serveur est annoncé', async ({ page, request }) => {
    // Liste des services liés simulée (une ligne), suppression refusée par le serveur
    await simulerUnModele(page)
    await page.route(u => /^\/api\/services\/modeles\/\d+\/services$/.test(u.pathname), route =>
      route.fulfill({ json: { success: true, data: { modele: { id: 9002 }, services: [
        { id: 9001, nom: 'Remplacement écran', prix_ttc_effectif: 120, prix_ht_specifique: null, categorie_nom: 'Écrans' },
      ] } } }))
    await page.route(u => /^\/api\/services\/modeles\/\d+\/services\/\d+$/.test(u.pathname), route =>
      route.request().method() === 'DELETE'
        ? route.fulfill({ status: 500, json: { success: false, error: 'Panne simulée du serveur' } })
        : route.fallback())

    const dialogues = await ouvrirReferentiel(page, request)
    await page.locator('#marques-list .marque-item').first().click()
    const carte = page.locator('.modele-card').first()
    await expect(carte).toBeVisible({ timeout: 15_000 })
    await carte.getByRole('button', { name: /Services/ }).click()
    await page.locator('#liaison-services-list button.btn-danger').first().click()

    await refusAnnonce(dialogues)
    expect(dialogues.join(' | ')).toContain('Panne simulée du serveur')
  })
})
