/**
 * @file tests/e2e/stock-initial-valorise.spec.ts
 * @description Stock initial valorisé au coût moyen (ticket 02 `reglages-stock-boutique`).
 *
 * Un produit créé à la main avec des pièces déjà en rayon entrait par un mouvement « Stock
 * initial », mais son coût moyen restait à 0 € jusqu'à la première réception d'un bon de
 * commande : la valeur du stock au coût moyen ignorait ces pièces. Désormais le coût moyen naît
 * au prix d'achat HT saisi quand la quantité est > 0 ; à quantité 0, il reste tel quel.
 *
 * Prouvé contre la VRAIE D1 locale — la règle vit dans le SQL, et les mocks du dépôt rendent ce
 * qu'on leur configure. Boutique neuve : la valeur du stock ne compte que ces deux produits.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'

test('stock initial : valorisé au prix d\'achat, tracé « Stock initial » — quantité 0 sans effet', async ({ request }) => {
  const tenant  = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }

  const ids: Record<string, number> = {}
  for (const produit of [
    { nom: 'E2E stock initial', prix_achat_ht: 10, stock_actuel: 2 },
    { nom: 'E2E sans stock',    prix_achat_ht: 10, stock_actuel: 0 },
  ]) {
    const res = await request.post('/api/produits', { headers, data: produit })
    expect(res.status(), await res.text()).toBe(201)
    ids[produit.nom] = (await res.json()).id
  }

  // Valeur du stock au coût moyen : 2 pièces × 10 € — le produit sans stock n'y ajoute rien
  const kpis = await (await request.get('/api/produits/kpis', { headers })).json()
  expect(kpis.data.valeur_stock_cump).toBe(20)

  // Historique du produit : l'entrée « Stock initial » demeure
  const avecStock = (await (await request.get(`/api/produits/${ids['E2E stock initial']}`, { headers })).json()).data
  expect(avecStock.prix_achat_cump).toBe(10)
  expect(avecStock.mouvements.map((m: any) => [m.motif, m.quantite])).toEqual([['Stock initial', 2]])

  // Quantité 0 : coût moyen laissé tel quel, aucun mouvement
  const sansStock = (await (await request.get(`/api/produits/${ids['E2E sans stock']}`, { headers })).json()).data
  expect(sansStock.prix_achat_cump).toBe(0)
  expect(sansStock.mouvements).toEqual([])
})

test('quantité de départ négative : refusée en 422, aucun produit créé (décision du 2026-09-12)', async ({ request }) => {
  const tenant  = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }

  // Un stock négatif sans mouvement tracé est impossible : la sortie de pièces (casse, non
  // conforme) passe par un mouvement, jamais par une quantité de départ
  const refus = await request.post('/api/produits', { headers, data: { nom: 'E2E quantité négative', stock_actuel: -3 } })
  expect(refus.status(), await refus.text()).toBe(422)
  expect((await refus.json()).error).toBe('La quantité de départ doit être un entier positif ou nul.')

  const kpis = await (await request.get('/api/produits/kpis', { headers })).json()
  expect(kpis.data.nb_produits).toBe(0)
})
