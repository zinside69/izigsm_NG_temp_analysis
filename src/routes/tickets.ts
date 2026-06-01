/**
 * routes/tickets.ts — CRUD Tickets de réparation + machine à états
 *
 * Machine à états des statuts :
 * recu → diagnostic → en_reparation → termine → livre
 *                                              → annule (depuis n'importe quel état sauf livre)
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import { parsePagination, nextNumero, auditLog } from '../lib/db'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

// Transitions autorisées (statut_avant → [statuts_suivants_possibles])
const TRANSITIONS: Record<string, string[]> = {
  recu:          ['diagnostic', 'en_reparation', 'annule'],
  diagnostic:    ['en_reparation', 'annule'],
  en_reparation: ['termine', 'annule'],
  termine:       ['livre'],
  livre:         [],      // état terminal
  annule:        [],      // état terminal
}

const tickets = new Hono<{ Bindings: Bindings; Variables: Variables }>()
tickets.use('*', authMiddleware)

// ── GET /api/tickets ──────────────────────────────────────────────────────────
tickets.get('/', async (c) => {
  const user   = c.get('user')
  const query  = c.req.query()
  const { limit, offset, page } = parsePagination(query)
  const boutiqueId = getBoutiqueId(user, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const conditions = ['t.boutique_id = ?', 't.actif = 1']
  const bindings: any[] = [boutiqueId]

  if (query.statut)       { conditions.push('t.statut = ?');            bindings.push(query.statut) }
  if (query.technicien)   { conditions.push('t.technicien_id = ?');     bindings.push(parseInt(query.technicien, 10)) }
  if (query.search)       { conditions.push('(t.numero LIKE ? OR t.appareil_marque LIKE ? OR t.appareil_modele LIKE ?)'); const s = `%${query.search}%`; bindings.push(s, s, s) }
  if (query.client_id)    { conditions.push('t.client_id = ?');         bindings.push(parseInt(query.client_id, 10)) }

  const where = 'WHERE ' + conditions.join(' AND ')

  const total = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM tickets t ${where}`)
    .bind(...bindings).first<{ cnt: number }>()

  const rows = await c.env.DB.prepare(`
    SELECT t.id, t.numero, t.statut, t.description_panne,
           t.appareil_marque, t.appareil_modele,
           t.prix_estime, t.prix_final, t.date_reception, t.date_promesse,
           c.prenom || ' ' || c.nom as client_nom, c.telephone as client_telephone,
           u.prenom || ' ' || u.nom as technicien_nom
    FROM   tickets t
    JOIN   clients c ON c.id = t.client_id
    LEFT JOIN users u ON u.id = t.technicien_id
    ${where}
    ORDER  BY t.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...bindings, limit, offset).all()

  return c.json({
    success: true,
    data: rows.results,
    pagination: { page, limit, total: total?.cnt ?? 0, pages: Math.ceil((total?.cnt ?? 0) / limit) }
  })
})

// ── GET /api/tickets/:id ──────────────────────────────────────────────────────
tickets.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)

  const ticket = await c.env.DB.prepare(`
    SELECT t.*,
           c.prenom || ' ' || c.nom as client_nom, c.email as client_email, c.telephone as client_telephone,
           u.prenom || ' ' || u.nom as technicien_nom
    FROM   tickets t
    JOIN   clients c ON c.id = t.client_id
    LEFT JOIN users u ON u.id = t.technicien_id
    WHERE  t.id = ? AND t.actif = 1
  `).bind(id).first()
  if (!ticket) return c.json({ success: false, error: 'Ticket introuvable.' }, 404)

  const historique = await c.env.DB.prepare(`
    SELECT h.*, u.prenom || ' ' || u.nom as user_nom
    FROM   tickets_statuts_historique h
    JOIN   users u ON u.id = h.user_id
    WHERE  h.ticket_id = ?
    ORDER  BY h.created_at ASC
  `).bind(id).all()

  const photos = await c.env.DB.prepare(
    'SELECT * FROM tickets_photos WHERE ticket_id = ? ORDER BY created_at'
  ).bind(id).all()

  return c.json({ success: true, data: { ...ticket, historique: historique.results, photos: photos.results } })
})

// ── POST /api/tickets ─────────────────────────────────────────────────────────
tickets.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const { client_id, appareil_id, appareil_marque, appareil_modele, description_panne,
          technicien_id, prix_estime, date_promesse, notes_internes } = body

  if (!client_id || !appareil_marque || !appareil_modele || !description_panne)
    return c.json({ success: false, error: 'Champs obligatoires manquants.' }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const numero = await nextNumero(c.env.DB, boutiqueId, 'ticket')

  const result = await c.env.DB.prepare(`
    INSERT INTO tickets
      (boutique_id, numero, client_id, appareil_id, appareil_marque, appareil_modele,
       description_panne, technicien_id, prix_estime, date_promesse, notes_internes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(boutiqueId, numero, client_id, appareil_id ?? null, appareil_marque, appareil_modele,
          description_panne, technicien_id ?? null, prix_estime ?? null,
          date_promesse ?? null, notes_internes ?? null).first<{ id: number }>()

  // Enregistrer la création dans l'historique
  await c.env.DB.prepare(`
    INSERT INTO tickets_statuts_historique (ticket_id, statut_ancien, statut_nouveau, user_id, commentaire)
    VALUES (?, ?, ?, ?, ?)
  `).bind(result?.id, 'creation', 'recu', user.sub, 'Ticket créé').run()

  await auditLog(c.env.DB, { boutique_id: boutiqueId, user_id: user.sub, action: 'CREATE_TICKET', entite_type: 'ticket', entite_id: result?.id })

  return c.json({ success: true, id: result?.id, numero, message: 'Ticket créé.' }, 201)
})

// ── PUT /api/tickets/:id ──────────────────────────────────────────────────────
tickets.put('/:id', async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()
  const { description_panne, diagnostic, technicien_id, prix_estime, prix_final, date_promesse, notes_internes } = body

  const existing = await c.env.DB.prepare('SELECT id FROM tickets WHERE id = ? AND actif = 1').bind(id).first()
  if (!existing) return c.json({ success: false, error: 'Ticket introuvable.' }, 404)

  await c.env.DB.prepare(`
    UPDATE tickets SET
      description_panne = COALESCE(?, description_panne),
      diagnostic        = COALESCE(?, diagnostic),
      technicien_id     = COALESCE(?, technicien_id),
      prix_estime       = COALESCE(?, prix_estime),
      prix_final        = COALESCE(?, prix_final),
      date_promesse     = COALESCE(?, date_promesse),
      notes_internes    = COALESCE(?, notes_internes),
      updated_at        = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(description_panne ?? null, diagnostic ?? null, technicien_id ?? null,
          prix_estime ?? null, prix_final ?? null, date_promesse ?? null,
          notes_internes ?? null, id).run()

  await auditLog(c.env.DB, { user_id: user.sub, action: 'UPDATE_TICKET', entite_type: 'ticket', entite_id: id })
  return c.json({ success: true, message: 'Ticket mis à jour.' })
})

// ── PUT /api/tickets/:id/statut ── Machine à états ─────────────────────────────
tickets.put('/:id/statut', async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const { statut, commentaire } = await c.req.json()

  const ticket = await c.env.DB.prepare('SELECT id, statut FROM tickets WHERE id = ? AND actif = 1').bind(id).first<{ id: number; statut: string }>()
  if (!ticket) return c.json({ success: false, error: 'Ticket introuvable.' }, 404)

  // Vérifier la transition
  const transitions = TRANSITIONS[ticket.statut] ?? []
  if (!transitions.includes(statut)) {
    return c.json({
      success: false,
      error: `Transition invalide : ${ticket.statut} → ${statut}. Transitions autorisées : ${transitions.join(', ') || 'aucune'}.`
    }, 422)
  }

  // Mettre à jour le statut
  const extraFields: string[] = []
  const extraValues: any[]    = []
  if (statut === 'termine')  { extraFields.push('date_cloture = CURRENT_TIMESTAMP') }
  if (statut === 'livre')    { extraFields.push('date_livraison = CURRENT_TIMESTAMP') }

  await c.env.DB.prepare(`
    UPDATE tickets SET statut = ?, updated_at = CURRENT_TIMESTAMP ${extraFields.map(f => ', ' + f).join('')}
    WHERE  id = ?
  `).bind(statut, id).run()

  // Enregistrer dans l'historique
  await c.env.DB.prepare(`
    INSERT INTO tickets_statuts_historique (ticket_id, statut_ancien, statut_nouveau, user_id, commentaire)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, ticket.statut, statut, user.sub, commentaire ?? null).run()

  await auditLog(c.env.DB, { user_id: user.sub, action: 'CHANGE_STATUT_TICKET', entite_type: 'ticket', entite_id: id, avant: { statut: ticket.statut }, apres: { statut } })

  return c.json({ success: true, message: `Statut changé : ${ticket.statut} → ${statut}.`, statut })
})

// ── DELETE /api/tickets/:id ───────────────────────────────────────────────────
tickets.delete('/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  await c.env.DB.prepare('UPDATE tickets SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run()
  await auditLog(c.env.DB, { user_id: user.sub, action: 'DELETE_TICKET', entite_type: 'ticket', entite_id: id })
  return c.json({ success: true, message: 'Ticket supprimé.' })
})

export default tickets
