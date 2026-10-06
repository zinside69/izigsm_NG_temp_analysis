/**
 * @file tests/e2e/prise-en-charge-services-suggeres.spec.ts
 * @description Dans « Nouvelle prise en charge », choisir le modèle de l'appareil affiche les services
 * liés à ce modèle, avec leur prix TTC effectif (prix spécifique s'il existe).
 *
 * Défaut trouvé en recette du ticket 04 prix TTC (2026-10-06, en production) : `tickets.js` lisait
 * `res.data?.services` sur l'enveloppe d'`apiGet`, au lieu du corps déballé — la liste valait toujours
 * `undefined` et la boîte « Services suggérés » restait masquée, pour tout modèle et depuis toujours.
 *
 * Contre la VRAIE D1 locale, boutique neuve. Le modèle est créé par l'admin plateforme (référentiel
 * global), lié par le manager de la boutique neuve. Le modèle est choisi par la fonction de la page
 * (`selectModeleFromSuggestion`, exposée sur `window`) : la liste des modèles de la page est plafonnée
 * à 500, et la base locale accumule les modèles des autres E2E — le taper au clavier pourrait ne pas
 * le trouver, sans rapport avec ce qui est testé ici.
 */
import { test, expect, type APIRequestContext } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter, obtenirToken, ADMIN_PLATEFORME } from './fixtures/comptes'

const entete = (jeton: string) => ({ Authorization: `Bearer ${jeton}` })

/** Un modèle d'appareil neuf (marque et modèle uniques), créé par l'admin plateforme ; rend son id et son nom. */
async function creerModele(request: APIRequestContext): Promise<{ id: number; nom: string }> {
  const jeton = await obtenirToken(request, ADMIN_PLATEFORME)
  const suffixe = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const marque = await request.post('/api/services/marques', { headers: entete(jeton), data: { nom: `E2E Marque ${suffixe}` } })
  expect(marque.status(), await marque.text()).toBe(201)
  const nom = `E2E Modèle ${suffixe}`
  const modele = await request.post('/api/services/modeles', {
    headers: entete(jeton),
    data:    { nom, marque_id: (await marque.json()).id },
  })
  expect(modele.status(), await modele.text()).toBe(201)
  return { id: (await modele.json()).id as number, nom }
}

test('prise en charge : le modèle choisi affiche ses services suggérés, au prix TTC spécifique', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const modele = await creerModele(request)

  // Service à 49,90 € TTC, lié au modèle avec un prix spécifique de 59,90 € TTC
  const service = await request.post('/api/services', {
    headers: entete(tenant.accessToken),
    data:    { nom: 'E2E Installation OS', prix_ttc: 49.9, tva_taux: 20 },
  })
  expect(service.status(), await service.text()).toBe(201)
  const lien = await request.post(`/api/services/modeles/${modele.id}/services`, {
    headers: entete(tenant.accessToken),
    data:    { service_id: (await service.json()).id, prix_ttc_specifique: 59.9 },
  })
  expect(lien.ok(), await lien.text()).toBe(true)

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/tickets')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: '+ Nouvelle prise en charge' }).click()

  const reponse = page.waitForResponse(r => r.url().includes(`/api/services/modeles/${modele.id}/services`))
  await page.evaluate(
    ({ id, nom }) => (globalThis as any).selectModeleFromSuggestion(id, nom),
    { id: modele.id, nom: modele.nom },
  )
  await reponse

  const boite = page.locator('#services-suggestion-box')
  await expect(boite).toBeVisible()
  await expect(boite).toContainText('E2E Installation OS')
  await expect(boite).toContainText('59.90 €')
  await expect(boite).toContainText('prix spé.')
})
