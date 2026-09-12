/**
 * @file tests/e2e/reglages-stock-defauts.spec.ts
 * @description Réglages › Stock — seuil d'alerte par défaut et stock initial par défaut
 *              (ticket 01, chantier `reglages-stock-boutique`, décisions du 2026-09-12).
 *
 * Prouvé contre la VRAIE D1 locale, par l'API puis à l'écran : la règle d'écriture vit dans le
 * SQL (remplacement des deux colonnes, rien d'autre), et les mocks du dépôt rendent ce qu'on
 * leur configure. Chaque test crée sa boutique : aucun réglage ne fuit d'un test à l'autre.
 *
 * Le journal des actions de plateforme n'est pas relu ici : il est posé par un middleware
 * global sur `/api/*`, déjà couvert par ses propres tests (ADR 0001).
 */
import { test, expect, type APIRequestContext } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter, ADMIN_PLATEFORME, type Compte } from './fixtures/comptes'

/** Jeton d'un compte existant (seed), par la vraie route de connexion. */
async function jeton(request: APIRequestContext, compte: Compte): Promise<string> {
  const res = await request.post('/api/auth/login', { data: compte })
  expect(res.ok(), await res.text()).toBeTruthy()
  return (await res.json()).accessToken
}

/** Réglages de la boutique tels que la lecture d'une boutique les renvoie. */
async function reglages(request: APIRequestContext, token: string, boutiqueId: number) {
  const res = await request.get(`/api/boutiques/${boutiqueId}`, { headers: { Authorization: `Bearer ${token}` } })
  expect(res.ok(), await res.text()).toBeTruthy()
  return (await res.json()).data.settings
}

test.describe('Réglages — valeurs par défaut de stock', () => {
  test('API : enregistrées et relues, valeurs invalides et autre boutique refusées, marges et TVA intactes', async ({ request }) => {
    const tenant = await createTenantAdmin(request)
    const h = { Authorization: `Bearer ${tenant.accessToken}` }
    const url = `/api/boutiques/${tenant.boutiqueId}/stock`

    // Un réglage voisin posé d'abord : il doit survivre à l'enregistrement de l'onglet Stock
    const marges = await request.put(`/api/boutiques/${tenant.boutiqueId}/marges`, { headers: h, data: {
      marge_taux_defaut: 30, marge_taux_piece: null, marge_taux_accessoire: null,
      marge_taux_appareil: null, marge_taux_consommable: null,
    } })
    expect(marges.status(), await marges.text()).toBe(200)

    // Jamais réglé : les deux colonnes existent et valent null ; TVA et paiements notés pour
    // vérifier qu'ils survivent à l'enregistrement de l'onglet Stock
    const initial = await reglages(request, tenant.accessToken, tenant.boutiqueId)
    expect(initial).toMatchObject({ stock_seuil_defaut: null, stock_initial_defaut: null })
    const voisins = {
      tva_taux_defaut: initial.tva_taux_defaut, paiement_especes: initial.paiement_especes,
      paiement_cb: initial.paiement_cb, paiement_cheque: initial.paiement_cheque,
      paiement_virement: initial.paiement_virement, marge_taux_defaut: 30,
    }

    // Enregistrement : un champ absent vaut null (« non réglé »)
    const ok = await request.put(url, { headers: h, data: { stock_seuil_defaut: 3 } })
    expect(ok.status(), await ok.text()).toBe(200)
    expect(await reglages(request, tenant.accessToken, tenant.boutiqueId))
      .toMatchObject({ stock_seuil_defaut: 3, stock_initial_defaut: null, ...voisins })

    // Valeurs invalides : négatif, non entier, chaîne numérique — 422, rien d'écrit
    for (const invalide of [-1, 1.5, '3']) {
      const res = await request.put(url, { headers: h, data: { stock_seuil_defaut: invalide, stock_initial_defaut: 7 } })
      expect(res.status(), `stock_seuil_defaut = ${JSON.stringify(invalide)}`).toBe(422)
    }
    expect(await reglages(request, tenant.accessToken, tenant.boutiqueId))
      .toMatchObject({ stock_seuil_defaut: 3, stock_initial_defaut: null })

    // Un champ vide ("") vaut null comme un champ absent (spec : « absent ou vide → NULL »)
    const vide = await request.put(url, { headers: h, data: { stock_seuil_defaut: 3, stock_initial_defaut: '' } })
    expect(vide.status(), await vide.text()).toBe(200)
    expect((await reglages(request, tenant.accessToken, tenant.boutiqueId)).stock_initial_defaut).toBeNull()

    // Étanchéité : une autre boutique ne peut pas écrire chez celle-ci
    const autre = await createTenantAdmin(request)
    const refus = await request.put(url, { headers: { Authorization: `Bearer ${autre.accessToken}` },
      data: { stock_seuil_defaut: 9, stock_initial_defaut: 9 } })
    expect(refus.status()).toBe(403)

    // L'admin plateforme dépanne une boutique cliente (comme pour les marges)
    const admin = await jeton(request, ADMIN_PLATEFORME)
    const depannage = await request.put(url, { headers: { Authorization: `Bearer ${admin}` },
      data: { stock_seuil_defaut: 4, stock_initial_defaut: 1 } })
    expect(depannage.status(), await depannage.text()).toBe(200)
    expect(await reglages(request, tenant.accessToken, tenant.boutiqueId))
      .toMatchObject({ stock_seuil_defaut: 4, stock_initial_defaut: 1 })
  })

  test('écran : onglet Stock, saisie relue après rechargement, champ vide = non réglé', async ({ page, request }) => {
    const tenant = await createTenantAdmin(request)
    await seConnecter(page, tenant)
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })

    await page.goto('/settings')
    await page.click('[data-tab="stock"]')
    await expect(page.locator('#tab-stock')).toBeVisible()
    await page.fill('#stock_seuil_defaut', '2')
    await page.fill('#stock_initial_defaut', '')
    await page.click('#form-stock button[type="submit"]')
    await expect(page.locator('.toast').last()).toContainText('Réglages de stock mis à jour')

    await page.reload()
    await page.click('[data-tab="stock"]')
    await expect(page.locator('#stock_seuil_defaut')).toHaveValue('2')
    await expect(page.locator('#stock_initial_defaut'), 'un champ vide reste vide : non réglé, pas 0').toHaveValue('')
    expect((await reglages(request, tenant.accessToken, tenant.boutiqueId)).stock_initial_defaut).toBeNull()
  })
})
