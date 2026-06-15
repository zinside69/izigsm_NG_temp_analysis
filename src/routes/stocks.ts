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
  type MouvementData,
} from '../services/stockService'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const stocks = new Hono<{ Bindings: Bindings; Variables: Variables }>()
stocks.use('*', authMiddleware)

// ─── Helper context ───────────────────────────────────────────────────────────

/**
 * Extrait les éléments récurrents du contexte Hono.
 * @param c — Contexte Hono
 * @returns { user, db, queryBoutiqueId }
 */
function ctx(c: any) {
  return {
    user:            c.get('user'),
    db:              c.env.DB as D1Database,
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
  const { user, db, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const data = await getKpisStock(db, boutiqueId)
  return c.json({ success: true, data })
})

// ── GET /api/produits ─────────────────────────────────────────────────────────
/**
 * Liste paginée des produits avec filtres et indicateurs de stock.
 * @query boutique_id, categorie_id?, stock_bas?, search?, page?, limit?
 * @returns { success, data, pagination }
 */
stocks.get('/produits', async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const query      = c.req.query()
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listProduits(db, boutiqueId, {
    categorie_id: query.categorie_id ? parseInt(query.categorie_id, 10) : undefined,
    stock_bas:    query.stock_bas === 'true',
    search:       query.search    ?? undefined,
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
  const { db } = ctx(c)
  const id = parseInt(c.req.param('id'), 10)

  const data = await getProduitById(db, id)
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
  const { user, db } = ctx(c)
  const produitId = parseInt(c.req.param('id'), 10)
  const body      = await c.req.json()

  if (!body.type_mouvement || body.quantite === undefined)
    return c.json({ success: false, error: 'type_mouvement et quantite obligatoires.' }, 400)

  try {
    const result = await enregistrerMouvement(db, produitId, user.sub, body as MouvementData)
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
  const { user, db, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const data = await listCategories(db, boutiqueId)
  return c.json({ success: true, data })
})

// ── POST /api/categories ──────────────────────────────────────────────────────
/**
 * Crée une nouvelle catégorie de produits.
 * @body nom (obligatoire), parent_id? (null pour catégorie racine)
 * @returns { success, id, message }
 */
stocks.post('/categories', requireRole('admin', 'manager'), async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const body = await c.req.json()

  if (!body.nom) return c.json({ success: false, error: 'Nom obligatoire.' }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString() ?? queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const created = await createCategorie(db, boutiqueId, { nom: body.nom, parent_id: body.parent_id })
  return c.json({ success: true, id: created.id, message: 'Catégorie créée.' }, 201)
})

export default stocks
