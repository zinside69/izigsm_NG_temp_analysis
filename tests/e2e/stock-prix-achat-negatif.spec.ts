/**
 * @file tests/e2e/stock-prix-achat-negatif.spec.ts
 * @description Un prix d'achat ne peut pas être négatif (décision de l'exploitant, 2026-09-12).
 *
 * `POST /produits` et `PUT /produits/:id` n'en vérifiaient rien : un prix d'achat de −10 € était
 * enregistré tel quel et, depuis le ticket 02 `reglages-stock-boutique`, il valorisait même le
 * stock initial au coût moyen — la valeur du stock baissait. Désormais les deux routes refusent
 * en 422, sans rien écrire. Prouvé contre la VRAIE D1 locale, boutique neuve.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'

test('prix d\'achat négatif : refusé en création comme en modification, rien n\'est écrit', async ({ request }) => {
  const tenant  = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }

  // Création refusée : aucun produit, aucune valeur de stock
  const refus = await request.post('/api/produits', {
    headers, data: { nom: 'E2E prix négatif', prix_achat_ht: -10, stock_actuel: 2 },
  })
  expect(refus.status(), await refus.text()).toBe(422)
  const kpis = await (await request.get('/api/produits/kpis', { headers })).json()
  expect(kpis.data.nb_produits).toBe(0)

  // Modification refusée : le prix d'achat enregistré ne bouge pas
  const cree = await request.post('/api/produits', {
    headers, data: { nom: 'E2E prix positif', prix_achat_ht: 10 },
  })
  expect(cree.status(), await cree.text()).toBe(201)
  const id = (await cree.json()).id

  const refusMaj = await request.put(`/api/produits/${id}`, { headers, data: { prix_achat_ht: -5 } })
  expect(refusMaj.status(), await refusMaj.text()).toBe(422)
  const relu = (await (await request.get(`/api/produits/${id}`, { headers })).json()).data
  expect(relu.prix_achat_ht).toBe(10)
})
