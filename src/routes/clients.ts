/**
 * routes/clients.ts — CRUD Clients & Appareils
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import { parsePagination, validateEmail, auditLog } from '../lib/db'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const clients = new Hono<{ Bindings: Bindings; Variables: Variables }>()
clients.use('*', authMiddleware)

// ── GET /api/clients ──────────────────────────────────────────────────────────
clients.get('/', async (c) => {
  const user      = c.get('user')
  const query     = c.req.query()
  const { limit, offset, page } = parsePagination(query)
  const boutiqueId = getBoutiqueId(user, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const search = query.search ? `%${query.search}%` : null

  const whereClause = search
    ? 'WHERE c.boutique_id = ? AND (c.nom LIKE ? OR c.prenom LIKE ? OR c.email LIKE ? OR c.telephone LIKE ?) AND c.actif = 1'
    : 'WHERE c.boutique_id = ? AND c.actif = 1'

  const bindings = search
    ? [boutiqueId, search, search, search, search]
    : [boutiqueId]

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM clients c ${whereClause}`
  ).bind(...bindings).first<{ cnt: number }>()

  const rows = await c.env.DB.prepare(`
    SELECT c.id, c.prenom, c.nom, c.email, c.telephone, c.ville, c.created_at,
           COUNT(t.id) as nb_tickets
    FROM   clients c
    LEFT JOIN tickets t ON t.client_id = c.id AND t.actif = 1
    ${whereClause}
    GROUP BY c.id
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...bindings, limit, offset).all()

  return c.json({
    success: true,
    data: rows.results,
    pagination: { page, limit, total: total?.cnt ?? 0, pages: Math.ceil((total?.cnt ?? 0) / limit) }
  })
})

// ── GET /api/clients/:id ──────────────────────────────────────────────────────
clients.get('/:id', async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  const client = await c.env.DB.prepare(`
    SELECT c.*, b.nom as boutique_nom
    FROM   clients c
    JOIN   boutiques b ON b.id = c.boutique_id
    WHERE  c.id = ? AND c.actif = 1
  `).bind(id).first()

  if (!client) return c.json({ success: false, error: 'Client introuvable.' }, 404)

  const boutiqueId = getBoutiqueId(user, undefined)
  if (user.role !== 'admin' && (client as any).boutique_id !== boutiqueId)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  const appareils = await c.env.DB.prepare(
    'SELECT * FROM appareils WHERE client_id = ? ORDER BY created_at DESC'
  ).bind(id).all()

  const tickets = await c.env.DB.prepare(`
    SELECT t.id, t.numero, t.statut, t.description_panne, t.appareil_marque, t.appareil_modele,
           t.prix_final, t.created_at
    FROM   tickets t
    WHERE  t.client_id = ? AND t.actif = 1
    ORDER  BY t.created_at DESC
    LIMIT  10
  `).bind(id).all()

  return c.json({ success: true, data: { ...client, appareils: appareils.results, tickets: tickets.results } })
})

// ── POST /api/clients ─────────────────────────────────────────────────────────
clients.post('/', requireRole('admin', 'manager', 'technicien'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const { prenom, nom, email, telephone, adresse, code_postal, ville, pays, notes } = body

  if (!prenom || !nom) return c.json({ success: false, error: 'Prénom et nom obligatoires.' }, 400)
  if (email && !validateEmail(email)) return c.json({ success: false, error: 'Email invalide.' }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await c.env.DB.prepare(`
    INSERT INTO clients (boutique_id, prenom, nom, email, telephone, adresse, code_postal, ville, pays, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(boutiqueId, prenom, nom, email ?? null, telephone ?? null,
          adresse ?? null, code_postal ?? null, ville ?? null,
          pays ?? 'France', notes ?? null).first<{ id: number }>()

  await auditLog(c.env.DB, { boutique_id: boutiqueId, user_id: user.sub, action: 'CREATE_CLIENT', entite_type: 'client', entite_id: result?.id, apres: body })

  return c.json({ success: true, id: result?.id, message: 'Client créé.' }, 201)
})

// ── PUT /api/clients/:id ──────────────────────────────────────────────────────
clients.put('/:id', requireRole('admin', 'manager', 'technicien'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()
  const { prenom, nom, email, telephone, adresse, code_postal, ville, pays, notes } = body

  if (!prenom || !nom) return c.json({ success: false, error: 'Prénom et nom obligatoires.' }, 400)
  if (email && !validateEmail(email)) return c.json({ success: false, error: 'Email invalide.' }, 400)

  const existing = await c.env.DB.prepare('SELECT id, boutique_id FROM clients WHERE id = ? AND actif = 1').bind(id).first<any>()
  if (!existing) return c.json({ success: false, error: 'Client introuvable.' }, 404)
  const boutiqueId = getBoutiqueId(user, undefined)
  if (user.role !== 'admin' && existing.boutique_id !== boutiqueId)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  await c.env.DB.prepare(`
    UPDATE clients SET prenom=?, nom=?, email=?, telephone=?, adresse=?, code_postal=?, ville=?, pays=?, notes=?, updated_at=CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(prenom, nom, email ?? null, telephone ?? null, adresse ?? null, code_postal ?? null, ville ?? null, pays ?? 'France', notes ?? null, id).run()

  await auditLog(c.env.DB, { boutique_id: existing.boutique_id, user_id: user.sub, action: 'UPDATE_CLIENT', entite_type: 'client', entite_id: id, apres: body })
  return c.json({ success: true, message: 'Client mis à jour.' })
})

// ── DELETE /api/clients/:id ───────────────────────────────────────────────────
clients.delete('/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  const existing = await c.env.DB.prepare('SELECT id, boutique_id FROM clients WHERE id = ? AND actif = 1').bind(id).first<any>()
  if (!existing) return c.json({ success: false, error: 'Client introuvable.' }, 404)
  const boutiqueId = getBoutiqueId(user, undefined)
  if (user.role !== 'admin' && existing.boutique_id !== boutiqueId)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  await c.env.DB.prepare('UPDATE clients SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run()
  await auditLog(c.env.DB, { boutique_id: existing.boutique_id, user_id: user.sub, action: 'DELETE_CLIENT', entite_type: 'client', entite_id: id })
  return c.json({ success: true, message: 'Client supprimé.' })
})

// ── POST /api/clients/:id/appareils ───────────────────────────────────────────
clients.post('/:id/appareils', requireRole('admin', 'manager', 'technicien'), async (c) => {
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()
  const { marque, modele, type, imei, numero_serie, couleur, notes } = body

  if (!marque || !modele) return c.json({ success: false, error: 'Marque et modèle obligatoires.' }, 400)

  const client = await c.env.DB.prepare('SELECT id FROM clients WHERE id = ? AND actif = 1').bind(id).first()
  if (!client) return c.json({ success: false, error: 'Client introuvable.' }, 404)

  const result = await c.env.DB.prepare(`
    INSERT INTO appareils (client_id, marque, modele, type, imei, numero_serie, couleur, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(id, marque, modele, type ?? 'smartphone', imei ?? null, numero_serie ?? null, couleur ?? null, notes ?? null).first<{ id: number }>()

  return c.json({ success: true, id: result?.id, message: 'Appareil ajouté.' }, 201)
})

export default clients
