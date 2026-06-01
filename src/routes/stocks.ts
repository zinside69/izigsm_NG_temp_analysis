/**
 * routes/stocks.ts — CRUD Produits, Catégories & Mouvements de stock
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import { parsePagination, auditLog } from '../lib/db'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const stocks = new Hono<{ Bindings: Bindings; Variables: Variables }>()
stocks.use('*', authMiddleware)

// ── GET /api/produits ─────────────────────────────────────────────────────────
stocks.get('/produits', async (c) => {
  const user       = c.get('user')
  const query      = c.req.query()
  const { limit, offset, page } = parsePagination(query)
  const boutiqueId = getBoutiqueId(user, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const conditions = ['p.boutique_id = ?', 'p.actif = 1']
  const bindings: any[] = [boutiqueId]

  if (query.categorie_id) { conditions.push('p.categorie_id = ?');             bindings.push(parseInt(query.categorie_id, 10)) }
  if (query.stock_bas)    { conditions.push('p.stock_actuel <= p.stock_minimum'); }
  if (query.search)       { conditions.push('(p.nom LIKE ? OR p.sku LIKE ? OR p.marque LIKE ?)'); const s = `%${query.search}%`; bindings.push(s, s, s) }

  const where = 'WHERE ' + conditions.join(' AND ')

  const total = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM produits p ${where}`)
    .bind(...bindings).first<{ cnt: number }>()

  const rows = await c.env.DB.prepare(`
    SELECT p.*, c.nom as categorie_nom,
           ROUND((p.prix_vente_ht - p.prix_achat_ht) / NULLIF(p.prix_vente_ht, 0) * 100, 1) as marge_pct,
           CASE WHEN p.stock_actuel = 0 THEN 'rupture'
                WHEN p.stock_actuel <= p.stock_minimum THEN 'bas'
                ELSE 'ok' END as alerte_stock
    FROM   produits p
    LEFT JOIN categories c ON c.id = p.categorie_id
    ${where}
    ORDER  BY p.nom ASC
    LIMIT ? OFFSET ?
  `).bind(...bindings, limit, offset).all()

  return c.json({
    success: true,
    data: rows.results,
    pagination: { page, limit, total: total?.cnt ?? 0, pages: Math.ceil((total?.cnt ?? 0) / limit) }
  })
})

// ── POST /api/produits ────────────────────────────────────────────────────────
stocks.post('/produits', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const { nom, sku, marque, categorie_id, prix_achat_ht, prix_vente_ht, tva_taux,
          stock_actuel, stock_minimum, fournisseur, reference_fournisseur, code_barre } = body

  if (!nom) return c.json({ success: false, error: 'Nom du produit obligatoire.' }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await c.env.DB.prepare(`
    INSERT INTO produits
      (boutique_id, categorie_id, sku, nom, marque, prix_achat_ht, prix_vente_ht, tva_taux,
       stock_actuel, stock_minimum, fournisseur, reference_fournisseur, code_barre)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(boutiqueId, categorie_id ?? null, sku ?? null, nom, marque ?? null,
          prix_achat_ht ?? 0, prix_vente_ht ?? 0, tva_taux ?? 20,
          stock_actuel ?? 0, stock_minimum ?? 5,
          fournisseur ?? null, reference_fournisseur ?? null, code_barre ?? null)
    .first<{ id: number }>()

  // Si stock initial > 0, enregistrer le mouvement d'entrée
  if (stock_actuel > 0 && result?.id) {
    await c.env.DB.prepare(`
      INSERT INTO mouvements_stock (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, user_id, motif)
      VALUES (?, ?, 'entree', ?, 0, ?, ?, 'Stock initial')
    `).bind(result.id, boutiqueId, stock_actuel, stock_actuel, user.sub).run()
  }

  await auditLog(c.env.DB, { boutique_id: boutiqueId, user_id: user.sub, action: 'CREATE_PRODUIT', entite_type: 'produit', entite_id: result?.id })
  return c.json({ success: true, id: result?.id, message: 'Produit créé.' }, 201)
})

// ── PUT /api/produits/:id ─────────────────────────────────────────────────────
stocks.put('/produits/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()
  const { nom, sku, marque, categorie_id, prix_achat_ht, prix_vente_ht, tva_taux, stock_minimum, fournisseur, code_barre } = body

  await c.env.DB.prepare(`
    UPDATE produits SET
      nom=?, sku=?, marque=?, categorie_id=?, prix_achat_ht=?, prix_vente_ht=?,
      tva_taux=?, stock_minimum=?, fournisseur=?, code_barre=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(nom, sku ?? null, marque ?? null, categorie_id ?? null, prix_achat_ht ?? 0,
          prix_vente_ht ?? 0, tva_taux ?? 20, stock_minimum ?? 5,
          fournisseur ?? null, code_barre ?? null, id).run()

  return c.json({ success: true, message: 'Produit mis à jour.' })
})

// ── DELETE /api/produits/:id ──────────────────────────────────────────────────
stocks.delete('/produits/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  await c.env.DB.prepare('UPDATE produits SET actif = 0 WHERE id = ?').bind(id).run()
  await auditLog(c.env.DB, { user_id: user.sub, action: 'DELETE_PRODUIT', entite_type: 'produit', entite_id: id })
  return c.json({ success: true, message: 'Produit désactivé.' })
})

// ── POST /api/produits/:id/mouvement ──────────────────────────────────────────
stocks.post('/produits/:id/mouvement', async (c) => {
  const user      = c.get('user')
  const produitId = parseInt(c.req.param('id'), 10)
  const { type_mouvement, quantite, motif, ticket_id } = await c.req.json()

  if (!type_mouvement || quantite === undefined || quantite === 0)
    return c.json({ success: false, error: 'type_mouvement et quantite (≠0) obligatoires.' }, 400)

  const types_valides = ['entree', 'sortie', 'ajustement', 'inventaire']
  if (!types_valides.includes(type_mouvement))
    return c.json({ success: false, error: `type_mouvement invalide. Valeurs : ${types_valides.join(', ')}` }, 400)

  const produit = await c.env.DB.prepare('SELECT id, stock_actuel, boutique_id FROM produits WHERE id = ? AND actif = 1')
    .bind(produitId).first<{ id: number; stock_actuel: number; boutique_id: number }>()
  if (!produit) return c.json({ success: false, error: 'Produit introuvable.' }, 404)

  // Calculer le nouveau stock
  const delta = type_mouvement === 'sortie' ? -Math.abs(quantite) : Math.abs(quantite)
  const stockApres = type_mouvement === 'ajustement' || type_mouvement === 'inventaire'
    ? quantite   // pour ajustement : quantite = valeur absolue cible
    : produit.stock_actuel + delta

  if (stockApres < 0)
    return c.json({ success: false, error: `Stock insuffisant. Stock actuel : ${produit.stock_actuel}.` }, 422)

  const mouvQuantite = type_mouvement === 'ajustement' || type_mouvement === 'inventaire'
    ? stockApres - produit.stock_actuel
    : delta

  // Mettre à jour le stock
  await c.env.DB.prepare('UPDATE produits SET stock_actuel = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(stockApres, produitId).run()

  // Enregistrer le mouvement
  await c.env.DB.prepare(`
    INSERT INTO mouvements_stock (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, ticket_id, user_id, motif)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(produitId, produit.boutique_id, type_mouvement, mouvQuantite, produit.stock_actuel, stockApres, ticket_id ?? null, user.sub, motif ?? null).run()

  return c.json({ success: true, stock_avant: produit.stock_actuel, stock_apres: stockApres, message: 'Stock mis à jour.' })
})

// ── GET /api/categories ───────────────────────────────────────────────────────
stocks.get('/categories', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const rows = await c.env.DB.prepare(`
    SELECT c.*, COUNT(p.id) as nb_produits
    FROM   categories c
    LEFT JOIN produits p ON p.categorie_id = c.id AND p.actif = 1
    WHERE  c.boutique_id = ? AND c.actif = 1
    GROUP  BY c.id
    ORDER  BY c.parent_id NULLS FIRST, c.nom
  `).bind(boutiqueId).all()

  return c.json({ success: true, data: rows.results })
})

// ── POST /api/categories ──────────────────────────────────────────────────────
stocks.post('/categories', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const { nom, parent_id, boutique_id: bodyBoutiqueId } = await c.req.json()
  if (!nom) return c.json({ success: false, error: 'Nom obligatoire.' }, 400)
  const boutiqueId = getBoutiqueId(user, bodyBoutiqueId?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await c.env.DB.prepare(
    'INSERT INTO categories (boutique_id, nom, parent_id) VALUES (?, ?, ?) RETURNING id'
  ).bind(boutiqueId, nom, parent_id ?? null).first<{ id: number }>()
  return c.json({ success: true, id: result?.id, message: 'Catégorie créée.' }, 201)
})

export default stocks
