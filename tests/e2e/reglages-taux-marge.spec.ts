/**
 * @file tests/e2e/reglages-taux-marge.spec.ts
 * @description Écran Réglages — taux de marge par défaut et par famille (ticket 02,
 *              chantier Mobilax).
 *
 * Observé à l'écran, après rechargement : ce que l'exploitant a saisi est ce qu'il relit.
 * Un appel API réussi ne suffit pas (`project-docs/modop-tests.md`) — la page doit
 * relire les taux enregistrés et les réafficher dans les bons champs.
 *
 * Second cas, le plus exposé : chaque onglet des réglages envoie un corps partiel, et la
 * route commune assigne la TVA et les paiements sans COALESCE (`bugs.md`, 2026-09-10).
 * Les taux vivent sur une route dédiée ; ce test prouve qu'enregistrer un autre onglet
 * ne les efface pas.
 *
 * Chaque test crée son propre tenant : aucun taux ne fuit d'un test à l'autre.
 */
import { test, expect, type Page } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

/** Saisie de référence : défaut, deux familles surchargées (dont un 0 % voulu), deux vides. */
const SAISIE = {
  marge_taux_defaut:      '30',
  marge_taux_piece:       '',
  marge_taux_accessoire:  '80',
  marge_taux_appareil:    '',
  marge_taux_consommable: '0',
}

/** Ouvre l'onglet Marges des réglages, une fois la session posée. */
async function ouvrirOngletMarges(page: Page) {
  await page.goto('/settings')
  await page.click('[data-tab="marges"]')
  await expect(page.locator('#tab-marges')).toBeVisible()
}

/** Relit les cinq champs de l'onglet Marges. */
async function lireSaisie(page: Page) {
  const valeurs: Record<string, string> = {}
  for (const champ of Object.keys(SAISIE)) {
    valeurs[champ] = await page.locator(`#${champ}`).inputValue()
  }
  return valeurs
}

test.describe('Réglages — taux de marge', () => {
  test('les taux saisis sont relus à l\'identique après rechargement', async ({ page, request }) => {
    const tenant = await createTenantAdmin(request)
    await seConnecter(page, tenant)
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })

    await ouvrirOngletMarges(page)
    for (const [champ, valeur] of Object.entries(SAISIE)) {
      await page.fill(`#${champ}`, valeur)
    }
    await page.click('#form-marges button[type="submit"]')
    await expect(page.locator('.toast')).toContainText('Taux de marge mis à jour')

    await page.reload()
    await page.click('[data-tab="marges"]')

    expect(await lireSaisie(page), 'un champ vide doit rester vide : il retombe sur le défaut').toEqual(SAISIE)
  })

  test('enregistrer l\'onglet Paiements n\'efface pas les taux de marge', async ({ page, request }) => {
    const tenant = await createTenantAdmin(request)
    await seConnecter(page, tenant)
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })

    await ouvrirOngletMarges(page)
    for (const [champ, valeur] of Object.entries(SAISIE)) {
      await page.fill(`#${champ}`, valeur)
    }
    await page.click('#form-marges button[type="submit"]')
    await expect(page.locator('.toast')).toContainText('Taux de marge mis à jour')

    await page.click('[data-tab="paiements"]')
    await page.click('#form-paiements button[type="submit"]')
    await expect(page.locator('.toast').last()).toContainText('Paramètres mis à jour')

    await page.reload()
    await page.click('[data-tab="marges"]')

    expect(await lireSaisie(page)).toEqual(SAISIE)
  })
})
