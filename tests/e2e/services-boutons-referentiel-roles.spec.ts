/**
 * @file tests/e2e/services-boutons-referentiel-roles.spec.ts
 * @description Catalogue services, onglet Marques & Modèles : chaque bouton n'est proposé qu'aux rôles
 * que le serveur accepte (règle « un geste proposé ne doit pas échouer à coup sûr »).
 *
 * Trouvé le 2026-10-04 : « ＋ Marque », « ＋ Modèle » (serveur : admin seul) et « Synchroniser API »
 * (serveur : admin et manager depuis le 2026-10-04) étaient montrés à tous — le technicien, et le
 * manager pour les deux premiers, étaient refusés à coup sûr.
 */
import { test, expect, type Page } from '@playwright/test'
import { ADMIN_PLATEFORME, MANAGER, TECHNICIEN, seConnecter, type Compte } from './fixtures/comptes'

async function ouvrirMarquesEtModeles(page: Page, compte: Compte) {
  await seConnecter(page, compte)
  await page.waitForURL(/\/(dashboard|console-boutiques)/, { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/services')
  await page.click('#tab-modeles')
  // L'onglet, pas `#btns-modeles` : vide pour un technicien, Playwright le tiendrait pour invisible
  await expect(page.locator('#pane-modeles')).toBeVisible()
}

const boutonMarque  = (page: Page) => page.locator('#btns-modeles').getByRole('button', { name: /Marque/ })
const boutonModele  = (page: Page) => page.locator('#btns-modeles').getByRole('button', { name: /Modèle/ })
const boutonSynchro = (page: Page) => page.locator('#btns-modeles').getByRole('button', { name: /Synchroniser API/ })

test('technicien : aucun des trois boutons du référentiel', async ({ page }) => {
  await ouvrirMarquesEtModeles(page, TECHNICIEN)
  await expect(boutonMarque(page)).toBeHidden()
  await expect(boutonModele(page)).toBeHidden()
  await expect(boutonSynchro(page)).toBeHidden()
})

test('manager : « Synchroniser API » seul', async ({ page }) => {
  await ouvrirMarquesEtModeles(page, MANAGER)
  await expect(boutonMarque(page)).toBeHidden()
  await expect(boutonModele(page)).toBeHidden()
  await expect(boutonSynchro(page)).toBeVisible()
})

test('admin : les trois boutons', async ({ page }) => {
  await ouvrirMarquesEtModeles(page, ADMIN_PLATEFORME)
  await expect(boutonMarque(page)).toBeVisible()
  await expect(boutonModele(page)).toBeVisible()
  await expect(boutonSynchro(page)).toBeVisible()
})
