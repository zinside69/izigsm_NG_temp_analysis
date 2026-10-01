/**
 * @file tests/e2e/formulaires-email.spec.ts
 * @description Formulaires portant un email mis en conformité le 2026-10-01 (`method="post"` +
 * `onsubmit="return false"`, la fonction de la page posée par `addEventListener('submit', …)`) :
 * `settings.html #form-general` et `personnel.html #form-add-employe`.
 *
 * Ces tests GARDENT l'enregistrement : ils passaient avant la mise en conformité et doivent passer
 * après. Ils prouvent que déplacer l'appel de `onsubmit="fonction(event)"` vers un écouteur n'a rien
 * cassé. La règle de balise elle-même est tenue par le garde-fou statique
 * `tests/formulaires-mot-de-passe-conformite.test.ts` (volet « email »), vu rouge sur ces deux pages.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

test.describe('Formulaires à email — l\'enregistrement fonctionne toujours', () => {
  test('Réglages › Général : la ville saisie est enregistrée et relue', async ({ page, request }) => {
    const tenant = await createTenantAdmin(request)
    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })

    const ville = `Ville-E2E-${Date.now()}`
    await page.goto('/settings')
    await expect(page.locator('#nom')).not.toHaveValue('', { timeout: 15_000 })
    await page.fill('#ville', ville)
    await page.locator('#form-general button[type="submit"]').click()
    await expect(page.getByText('Boutique mise à jour')).toBeVisible({ timeout: 10_000 })
    // Aucune soumission native : l'adresse n'a pas bougé
    expect(page.url()).not.toContain('?')

    await page.reload()
    await expect(page.locator('#ville')).toHaveValue(ville, { timeout: 15_000 })
  })

  test('Personnel : un employé ajouté apparaît dans la liste', async ({ page, request }) => {
    const tenant = await createTenantAdmin(request)
    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })

    const nom = `Employe${Date.now()}`
    await page.goto('/personnel')
    await page.locator('button[onclick="openAddEmployeModal()"]').click()
    const formulaire = page.locator('#form-add-employe')
    await formulaire.locator('[name="prenom"]').fill('Jeanne')
    await formulaire.locator('[name="nom"]').fill(nom)
    await formulaire.locator('[name="email"]').fill(`${nom.toLowerCase()}@exemple.fr`)
    await formulaire.locator('button[type="submit"]').click()

    await expect(page.locator('#modal-add-employe')).toBeHidden({ timeout: 10_000 })
    await expect(page.getByText(nom).first()).toBeVisible({ timeout: 10_000 })
    expect(page.url()).not.toContain('?')
  })
})
