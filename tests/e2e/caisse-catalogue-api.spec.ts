/**
 * @file tests/e2e/caisse-catalogue-api.spec.ts
 * @description La vente lit le catalogue — niveau API (ticket 02 du chantier
 * `vente-lit-catalogue`, stories 2, 4, 5, 6, 16-19).
 *
 * Deux contrats, prouvés contre la VRAIE D1 locale (boutique neuve à chaque test) :
 *  - `GET /api/catalogue/recherche?q=` trouve un produit par nom, SKU **et code-barres**, rend des
 *    résultats typés, plafonnés, limités à la boutique consultée ;
 *  - `POST /api/caisse/vente` avec `produit_id` fait baisser le stock et écrit un mouvement
 *    « Vente POS » ; un stock insuffisant est ramené à 0 et **signalé** dans la réponse.
 *
 * Une règle portée par le SQL ne se prouve jamais sur les bases simulées du dépôt (`CLAUDE.md`).
 */
import { test, expect, type APIRequestContext } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'

// ═══════════════════════════════════════════════════════════════════════════════
// Aides
// ═══════════════════════════════════════════════════════════════════════════════

/** Crée un produit dans la boutique du jeton et rend son identifiant. */
async function creerProduit(
  request: APIRequestContext,
  headers: Record<string, string>,
  data:    Record<string, unknown>,
): Promise<number> {
  const res = await request.post('/api/produits', { headers, data: { stock_minimum: 0, ...data } })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id
}

/** Lance une recherche catalogue et rend le corps JSON. */
async function chercher(request: APIRequestContext, headers: Record<string, string>, q: string) {
  const res = await request.get(`/api/catalogue/recherche?q=${encodeURIComponent(q)}`, { headers })
  expect(res.status(), await res.text()).toBe(200)
  return res.json()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Recherche catalogue
// ═══════════════════════════════════════════════════════════════════════════════

test('recherche catalogue : un produit se trouve par nom, SKU et code-barres, résultat typé', async ({ request }) => {
  const tenant  = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }

  const id = await creerProduit(request, headers, {
    nom: 'E2E Coque silicone iPhone 12', sku: 'E2E-CQ-IP12', code_barre: '3700275470016',
    prix_vente_ht: 24.92, tva_taux: 20, stock_actuel: 4,
  })

  for (const q of ['silicone', 'E2E-CQ-IP12', '3700275470016']) {
    const corps = await chercher(request, headers, q)
    expect(corps.success, q).toBe(true)
    expect(corps.data, q).toEqual([{
      type:          'produit',
      id,
      nom:           'E2E Coque silicone iPhone 12',
      sku:           'E2E-CQ-IP12',
      code_barre:    '3700275470016',
      prix_vente_ht: 24.92,
      tva_taux:      20,
      stock_actuel:  4,
    }])
  }
})

test('recherche catalogue : « _ » et « % » sont cherchés tels quels, pas comme des jokers', async ({ request }) => {
  const tenant  = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }
  await creerProduit(request, headers, { nom: 'E2E Joker A', sku: 'E2E_JK_1' })
  await creerProduit(request, headers, { nom: 'E2E Joker B', sku: 'E2EXJKX1' })
  await creerProduit(request, headers, { nom: 'E2E Remise 10% nappe' })

  expect((await chercher(request, headers, 'E2E_JK')).data.map((p: { nom: string }) => p.nom)).toEqual(['E2E Joker A'])
  expect((await chercher(request, headers, '10%')).data.map((p: { nom: string }) => p.nom)).toEqual(['E2E Remise 10% nappe'])
  expect((await chercher(request, headers, 'E2E%B')).data).toEqual([])
})

test('recherche catalogue : plafonnée, limitée à la boutique consultée, refusée sans jeton', async ({ request }) => {
  const tenant  = await createTenantAdmin(request)
  const autre   = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }

  // 25 produits trouvables : la réponse s'arrête au plafond de 20
  for (let i = 0; i < 25; i++) {
    await creerProduit(request, headers, { nom: `E2E Verre plafond ${i}` })
  }
  expect((await chercher(request, headers, 'Verre plafond')).data).toHaveLength(20)

  // Un produit d'une autre boutique n'apparaît jamais
  await creerProduit(request, { Authorization: `Bearer ${autre.accessToken}` }, { nom: 'E2E Produit voisin unique' })
  expect((await chercher(request, headers, 'voisin unique')).data).toEqual([])

  // Sans jeton : refus
  const sansJeton = await request.get('/api/catalogue/recherche?q=verre')
  expect(sansJeton.status()).toBe(401)
})

// ═══════════════════════════════════════════════════════════════════════════════
// Vente d'un produit du catalogue
// ═══════════════════════════════════════════════════════════════════════════════

/** Encaisse une vente en espèces et rend le corps JSON (statut 201 exigé). */
async function vendre(
  request: APIRequestContext,
  headers: Record<string, string>,
  lignes:  Record<string, unknown>[],
) {
  const res = await request.post('/api/caisse/vente', { headers, data: { mode_paiement: 'especes', lignes } })
  expect(res.status(), await res.text()).toBe(201)
  return res.json()
}

/** Relit la fiche d'un produit (stock et derniers mouvements). */
async function relireProduit(request: APIRequestContext, headers: Record<string, string>, id: number) {
  return (await (await request.get(`/api/produits/${id}`, { headers })).json()).data
}

/** Mouvements « Vente POS » d'une fiche — l'ordre des mouvements d'une même seconde n'est pas garanti. */
function ventesPos(produit: { mouvements: { motif: string }[] }) {
  return produit.mouvements.filter(m => m.motif === 'Vente POS')
}

test('vente : le produit vendu sort du stock, avec un mouvement « Vente POS »', async ({ request }) => {
  const tenant  = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }
  const id = await creerProduit(request, headers, { nom: 'E2E Chargeur USB-C', prix_vente_ht: 15, stock_actuel: 5 })

  const corps = await vendre(request, headers, [
    { produit_id: id, designation: 'E2E Chargeur USB-C', quantite: 2, prix_unitaire_ht: 12.5, tva_taux: 20 },
  ])
  expect(corps.data.stock_insuffisant).toEqual([])

  const produit = await relireProduit(request, headers, id)
  expect(produit.stock_actuel).toBe(3)
  expect(ventesPos(produit)).toEqual([expect.objectContaining({
    type_mouvement: 'sortie', quantite: 2, stock_avant: 5, stock_apres: 3,
  })])
})

test('vente : stock insuffisant ramené à 0, ligne signalée ; une ligne libre se vend comme avant', async ({ request }) => {
  const tenant  = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }
  const id = await creerProduit(request, headers, { nom: 'E2E Batterie iPhone 11', prix_vente_ht: 30, stock_actuel: 1 })

  const corps = await vendre(request, headers, [
    { designation: 'E2E Main d\'œuvre libre', quantite: 1, prix_unitaire_ht: 40, tva_taux: 20 },
    { produit_id: id, designation: 'E2E Batterie iPhone 11', quantite: 3, prix_unitaire_ht: 30, tva_taux: 20 },
  ])
  expect(corps.data.facture.total_ttc).toBe(156)
  expect(corps.data.stock_insuffisant).toEqual([{
    ligne: 2, produit_id: id, designation: 'E2E Batterie iPhone 11', stock_avant: 1, quantite: 3,
  }])

  const produit = await relireProduit(request, headers, id)
  expect(produit.stock_actuel).toBe(0)
  expect(ventesPos(produit)).toEqual([expect.objectContaining({ quantite: 3, stock_avant: 1, stock_apres: 0 })])
})
