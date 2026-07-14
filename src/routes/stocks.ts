/**
 * routes/stocks.ts — Controller Produits, Catégories & Mouvements de stock
 * Sprint 2.17 — Refactoring P1 : tout le SQL délégué à stockService.ts
 *
 * Ce fichier ne contient AUCUN SQL. Il orchestre uniquement :
 *   - Extraction des paramètres de la requête HTTP
 *   - Appel du service approprié
 *   - Formatage de la réponse P5 { success, data?, error?, message? }
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import type { Database } from '../ports/database'
import {
  listProduits,
  getProduitById,
  createProduit,
  updateProduit,
  deleteProduit,
  enregistrerMouvement,
  listCategories,
  createCategorie,
  getKpisStock,
  importCatalogueCsv,
  type MouvementData,
  type FamilleProduit,
} from '../services/stockService'

type Bindings = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string }
type Variables = { user: any; db: Database }

const stocks = new Hono<{ Bindings: Bindings; Variables: Variables }>()
stocks.use('*', authMiddleware)

// ─── Helper context ───────────────────────────────────────────────────────────

/**
 * Extrait les éléments récurrents du contexte Hono.
 * `db` (D1Database brut) reste pour les fonctions non migrées (dépendantes d'`auditLog`) ;
 * `dbPort` (port Database) pour les fonctions migrées.
 * @param c — Contexte Hono
 * @returns { user, db, dbPort, queryBoutiqueId }
 */
function ctx(c: any) {
  return {
    user:            c.get('user'),
    db:              c.env.DB as D1Database,
    dbPort:          c.get('db') as Database,
    queryBoutiqueId: c.req.query('boutique_id') ?? undefined,
  }
}

// ── GET /api/produits/kpis ── (segment fixe AVANT /produits/:id) ─────────────
/**
 * KPIs stock d'une boutique : nb produits, ruptures, alertes, valeur stock HT et CUMP.
 * @query boutique_id — obligatoire
 * @returns { success, data: KpisStock }
 */
stocks.get('/produits/kpis', async (c) => {
  const { user, dbPort, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const data = await getKpisStock(dbPort, boutiqueId)
  return c.json({ success: true, data })
})

// ── GET /api/produits ─────────────────────────────────────────────────────────
/**
 * Liste paginée des produits avec filtres et indicateurs de stock.
 * @query boutique_id, categorie_id?, stock_bas?, search?, page?, limit?
 * @returns { success, data, pagination }
 */
stocks.get('/produits', async (c) => {
  const { user, dbPort, queryBoutiqueId } = ctx(c)
  const query      = c.req.query()
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listProduits(dbPort, boutiqueId, {
    categorie_id: query.categorie_id ? parseInt(query.categorie_id, 10) : undefined,
    stock_bas:    query.stock_bas === 'true',
    search:       query.search    ?? undefined,
    famille:      query.famille   ?? undefined,
    page:         query.page      ? parseInt(query.page,  10) : undefined,
    limit:        query.limit     ? parseInt(query.limit, 10) : undefined,
  })

  return c.json({ success: true, ...result })
})

// ── GET /api/produits/:id ─────────────────────────────────────────────────────
/**
 * Fiche complète d'un produit avec ses 20 derniers mouvements de stock.
 * @param id — ID du produit
 * @returns { success, data }
 */
stocks.get('/produits/:id', async (c) => {
  const { dbPort } = ctx(c)
  const id = parseInt(c.req.param('id'), 10)

  const data = await getProduitById(dbPort, id)
  if (!data) return c.json({ success: false, error: 'Produit introuvable.' }, 404)

  return c.json({ success: true, data })
})

// ── POST /api/produits ────────────────────────────────────────────────────────
/**
 * Crée un nouveau produit. Si stock_actuel > 0, enregistre un mouvement 'entree'.
 * @body nom (obligatoire), sku?, marque?, categorie_id?, prix_achat_ht?, prix_vente_ht?,
 *       tva_taux?, stock_actuel?, stock_minimum?, fournisseur?, reference_fournisseur?, code_barre?
 * @returns { success, id, message }
 */
stocks.post('/produits', requireRole('admin', 'manager'), async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const body = await c.req.json()

  if (!body.nom) return c.json({ success: false, error: 'Nom du produit obligatoire.' }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString() ?? queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const created = await createProduit(db, boutiqueId, user.sub, body)
  return c.json({ success: true, id: created.id, message: 'Produit créé.' }, 201)
})

// ── POST /api/produits/import-csv ────────────────────────────────────────────
/**
 * Importe un catalogue fournisseur au format CSV (RFC 4180, sep , ou ;).
 * UPSERT sur SKU : crée le produit si absent, met à jour sinon.
 * Limite 500 lignes par import. Colonnes attendues : sku, nom, marque,
 * famille, prix_achat_ht, prix_vente_ht, tva_taux, stock_actuel, stock_minimum,
 * fournisseur, reference_fournisseur, code_barre.
 * @body { csvContent: string } — JSON avec le texte CSV brut
 *   OU Content-Type: text/csv avec le CSV directement dans le body
 * @returns { success, imported, updated, skipped, errors }
 */
stocks.post('/produits/import-csv', requireRole('admin', 'manager'), async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  let csvText: string
  const ct = c.req.header('content-type') ?? ''
  if (ct.includes('text/csv') || ct.includes('text/plain')) {
    csvText = await c.req.text()
  } else {
    // JSON body { csvContent: '...' }
    const body = await c.req.json().catch(() => ({}))
    if (!body.csvContent || typeof body.csvContent !== 'string')
      return c.json({ success: false, error: 'csvContent (string) obligatoire dans le body JSON, ou envoyer en text/csv.' }, 400)
    csvText = body.csvContent
  }

  if (!csvText.trim())
    return c.json({ success: false, error: 'Fichier CSV vide.' }, 400)

  const result = await importCatalogueCsv(db, boutiqueId, user.sub, csvText)
  const status = result.errors.length > 0 && result.imported === 0 && result.updated === 0 ? 422 : 200
  return c.json({ success: true, ...result }, status)
})

// ── PUT /api/produits/:id ─────────────────────────────────────────────────────
/**
 * Met à jour les champs éditables d'un produit (hors stock_actuel).
 * Pour modifier le stock, utiliser POST /produits/:id/mouvement.
 * @param id — ID du produit
 * @body nom?, sku?, marque?, categorie_id?, prix_achat_ht?, prix_vente_ht?,
 *       tva_taux?, stock_minimum?, fournisseur?, code_barre?
 * @returns { success, message }
 */
stocks.put('/produits/:id', requireRole('admin', 'manager'), async (c) => {
  const { user, db } = ctx(c)
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  try {
    await updateProduit(db, id, user.sub, body)
    return c.json({ success: true, message: 'Produit mis à jour.' })
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

// ── DELETE /api/produits/:id ──────────────────────────────────────────────────
/**
 * Soft-delete un produit (actif = 0). Réservé admin/manager.
 * @param id — ID du produit
 * @returns { success, message }
 */
stocks.delete('/produits/:id', requireRole('admin', 'manager'), async (c) => {
  const { user, db } = ctx(c)
  const id = parseInt(c.req.param('id'), 10)

  await deleteProduit(db, id, user.sub)
  return c.json({ success: true, message: 'Produit désactivé.' })
})

// ── POST /api/produits/:id/mouvement ──────────────────────────────────────────
/**
 * Enregistre un mouvement de stock et met à jour stock_actuel.
 * @param id — ID du produit
 * @body type_mouvement ('entree'|'sortie'|'ajustement'|'inventaire'), quantite, motif?, ticket_id?
 * @returns { success, stock_avant, stock_apres, message }
 */
stocks.post('/produits/:id/mouvement', async (c) => {
  const { user, dbPort } = ctx(c)
  const produitId = parseInt(c.req.param('id'), 10)
  const body      = await c.req.json()

  if (!body.type_mouvement || body.quantite === undefined)
    return c.json({ success: false, error: 'type_mouvement et quantite obligatoires.' }, 400)

  try {
    const result = await enregistrerMouvement(dbPort, produitId, user.sub, body as MouvementData)
    return c.json({ success: true, ...result, message: 'Stock mis à jour.' })
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

// ── GET /api/categories ───────────────────────────────────────────────────────
/**
 * Liste les catégories de produits d'une boutique avec le nb de produits.
 * @query boutique_id — obligatoire
 * @returns { success, data }
 */
stocks.get('/categories', async (c) => {
  const { user, dbPort, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const data = await listCategories(dbPort, boutiqueId)
  return c.json({ success: true, data })
})

// ── POST /api/categories ──────────────────────────────────────────────────────
/**
 * Crée une nouvelle catégorie de produits.
 * @body nom (obligatoire), parent_id? (null pour catégorie racine)
 * @returns { success, id, message }
 */
stocks.post('/categories', requireRole('admin', 'manager'), async (c) => {
  const { user, dbPort, queryBoutiqueId } = ctx(c)
  const body = await c.req.json()

  if (!body.nom) return c.json({ success: false, error: 'Nom obligatoire.' }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString() ?? queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const created = await createCategorie(dbPort, boutiqueId, { nom: body.nom, parent_id: body.parent_id })
  return c.json({ success: true, id: created.id, message: 'Catégorie créée.' }, 201)
})

export default stocks
