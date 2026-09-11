/**
 * @file tests/e2e/reglages-onglets-sans-ecrasement.spec.ts
 * @description Écran Réglages — enregistrer un onglet ne doit pas écraser les autres
 *              (🔴 P1 trouvé le 2026-09-10, `bugs.md`).
 *
 * Chaque onglet de `settings.html` envoie à `PUT /api/boutiques/:id/settings` un corps
 * PARTIEL : ses seuls champs. `updateBoutiqueSettings()` assignait la TVA, les moyens de
 * paiement et les notifications sans COALESCE, avec replis `?? 20` / `?? 0` — mesuré en
 * local : Paiements enregistré → TVA 5,5 repassée à 20 ; Numérotation enregistrée →
 * espèces et CB décochés. Toujours 200, aucun signal.
 *
 * Observé à l'écran, après rechargement — jamais seulement par un appel API réussi
 * (`project-docs/modop-tests.md`). Chaque test crée son propre tenant.
 */
import { test, expect, type Page } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

/** Ouvre un onglet des réglages. */
async function ouvrirOnglet(page: Page, onglet: string) {
  await page.click(`[data-tab="${onglet}"]`)
  await expect(page.locator(`#tab-${onglet}`)).toBeVisible()
}

/**
 * Enregistre un onglet et attend son toast de confirmation. `.last()` : deux
 * enregistrements rapprochés du même onglet affichent deux toasts identiques (3 s chacun).
 */
async function enregistrer(page: Page, formulaire: string, confirmation: string) {
  await page.click(`#${formulaire} button[type="submit"]`)
  await expect(page.locator('.toast', { hasText: confirmation }).last()).toBeVisible()
}

/** Connexion d'un tenant neuf, puis ouverture des réglages. */
async function ouvrirReglages(page: Page, request: Parameters<typeof createTenantAdmin>[0]) {
  const tenant = await createTenantAdmin(request)
  await seConnecter(page, tenant)
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/settings')
}

test.describe('Réglages — un onglet n\'écrase pas les autres', () => {
  test('TVA et moyens de paiement survivent à l\'enregistrement des autres onglets', async ({ page, request }) => {
    await ouvrirReglages(page, request)

    // 1. Facturation : TVA à 5,5 % (régime réduit — le cas qui voyait sa mention légale changer)
    await ouvrirOnglet(page, 'facturation')
    await page.selectOption('#tva_taux_defaut', '5.5')
    await enregistrer(page, 'form-facturation', 'Facturation mise à jour')

    // 2. Paiements : espèces + CB cochés, chèque décoché — écrasait la TVA à 20 %
    await ouvrirOnglet(page, 'paiements')
    await page.check('#paiement_especes')
    await page.check('#paiement_cb')
    await page.uncheck('#paiement_cheque')
    await enregistrer(page, 'form-paiements', 'Paramètres mis à jour')

    // 3. Numérotation — décochait tous les moyens de paiement
    await ouvrirOnglet(page, 'numerotation')
    await enregistrer(page, 'form-numerotation', 'Numérotation mise à jour')

    await page.reload()

    await ouvrirOnglet(page, 'facturation')
    await expect(page.locator('#tva_taux_defaut'), 'TVA remise à 20 % par un autre onglet').toHaveValue('5.5')

    await ouvrirOnglet(page, 'paiements')
    await expect(page.locator('#paiement_especes'), 'espèces décoché par un autre onglet').toBeChecked()
    await expect(page.locator('#paiement_cb'), 'CB décochée par un autre onglet').toBeChecked()
    await expect(page.locator('#paiement_cheque')).not.toBeChecked()
  })

  test('un moyen de paiement décoché reste décoché', async ({ page, request }) => {
    // Garde-fou du correctif : conserver un champ absent ne doit pas empêcher d'en décocher un.
    await ouvrirReglages(page, request)

    await ouvrirOnglet(page, 'paiements')
    await page.check('#paiement_especes')
    await enregistrer(page, 'form-paiements', 'Paramètres mis à jour')

    await page.uncheck('#paiement_especes')
    await enregistrer(page, 'form-paiements', 'Paramètres mis à jour')

    await page.reload()
    await ouvrirOnglet(page, 'paiements')
    await expect(page.locator('#paiement_especes')).not.toBeChecked()
  })
})
