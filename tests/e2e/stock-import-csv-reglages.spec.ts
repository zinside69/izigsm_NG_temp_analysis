/**
 * @file tests/e2e/stock-import-csv-reglages.spec.ts
 * @description Import CSV : réglages de stock appliqués et stock initial valorisé
 *              (ticket 04, chantier `reglages-stock-boutique`, décisions du 2026-09-12).
 *
 * L'import écrivait un seuil de 5 en dur sur chaque produit créé — la colonne `stock_minimum`
 * annoncée par l'écran n'était même pas lue — et laissait le coût moyen à 0 € malgré les pièces
 * déclarées. Désormais : colonne seuil vide → seuil d'alerte par défaut de la boutique ; remplie →
 * sa valeur, même 0 ; quantité vide → 0 sans mouvement ; quantité > 0 → mouvement d'entrée et coût
 * moyen au prix d'achat de la ligne.
 *
 * Prouvé contre la VRAIE D1 locale, boutique neuve : les règles vivent dans le SQL, et les mocks
 * du dépôt rendent ce qu'on leur configure.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'

test('import CSV : seuil vide → réglage, rempli → sa valeur ; quantité valorisée au prix de la ligne', async ({ request }) => {
  const tenant  = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }

  const reglage = await request.put(`/api/boutiques/${tenant.boutiqueId}/stock`, { headers, data: { stock_seuil_defaut: 3 } })
  expect(reglage.status(), await reglage.text()).toBe(200)

  const csvContent = [
    'nom,prix_achat_ht,stock_actuel,stock_minimum',
    'E2E CSV seuil vide qte vide,10,,',
    'E2E CSV seuil rempli qte vide,10,,1',
    'E2E CSV seuil vide qte 2,10,2,',
    'E2E CSV seuil zero qte 3,5,3,0',
  ].join('\n')
  const res = await request.post('/api/produits/import-csv', { headers, data: { csvContent } })
  expect(res.status(), await res.text()).toBe(200)
  expect(await res.json()).toMatchObject({ imported: 4, skipped: 0 })

  // Relecture : seuil, stock et coût moyen de chaque produit
  const liste = await (await request.get('/api/produits?search=E2E%20CSV&limit=50', { headers })).json()
  const produits = Object.fromEntries(liste.data.map((p: any) => [p.nom, p]))
  const attendu = (nom: string) => {
    const p = produits[nom]
    expect(p, nom).toBeDefined()
    return { seuil: p.stock_minimum, stock: p.stock_actuel, cump: p.prix_achat_cump }
  }
  expect(attendu('E2E CSV seuil vide qte vide')).toEqual({ seuil: 3, stock: 0, cump: 0 })
  expect(attendu('E2E CSV seuil rempli qte vide')).toEqual({ seuil: 1, stock: 0, cump: 0 })
  expect(attendu('E2E CSV seuil vide qte 2')).toEqual({ seuil: 3, stock: 2, cump: 10 })
  expect(attendu('E2E CSV seuil zero qte 3')).toEqual({ seuil: 0, stock: 3, cump: 5 })

  // Valeur du stock au coût moyen : 2 × 10 € + 3 × 5 €
  const kpis = await (await request.get('/api/produits/kpis', { headers })).json()
  expect(kpis.data.valeur_stock_cump).toBe(35)

  // Quantité > 0 : l'entrée reste tracée, sous le motif commun à tous les chemins de création
  // (« Stock initial », decisions.md) ; quantité vide : aucun mouvement
  const fiche = async (nom: string) =>
    (await (await request.get(`/api/produits/${produits[nom].id}`, { headers })).json()).data
  expect((await fiche('E2E CSV seuil vide qte 2')).mouvements.map((m: any) => [m.type_mouvement, m.quantite, m.motif]))
    .toEqual([['entree', 2, 'Stock initial']])
  expect((await fiche('E2E CSV seuil vide qte vide')).mouvements).toEqual([])
})

test('import CSV à la française : décimales à virgule valorisées exactement, quantité négative refusée', async ({ request }) => {
  const tenant  = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }

  // Export tableur français : séparateur « ; », virgule décimale
  const csvContent = [
    'nom;prix_achat_ht;stock_actuel',
    'E2E CSV prix décimal;12,50;2',
    'E2E CSV quantité négative;10;-3',
  ].join('\n')
  const res = await (await request.post('/api/produits/import-csv', { headers, data: { csvContent } })).json()
  expect(res).toMatchObject({ imported: 1, skipped: 1, errors: ['Ligne 3 : quantité invalide — ignorée.'] })

  // Seul le produit valide existe, valorisé 2 × 12,50 € — aucune pièce fictive à −3
  const liste = await (await request.get('/api/produits?search=E2E%20CSV', { headers })).json()
  expect(liste.data.map((p: any) => [p.nom, p.prix_achat_ht, p.prix_achat_cump]))
    .toEqual([['E2E CSV prix décimal', 12.5, 12.5]])
  const kpis = await (await request.get('/api/produits/kpis', { headers })).json()
  expect(kpis.data.valeur_stock_cump).toBe(25)
})
