/**
 * routes/tickets.ts — CRUD Tickets de réparation + machine à états
 *
 * Machine à états des statuts (Sprint 2.8) :
 * recu → en_diagnostic → attente_accord → a_commander → commande → pieces_recues → en_reparation → termine → livre
 *                       ↘ en_reparation (réparation directe sans pièces)
 *                                                                                ↗
 *  Depuis tout état sauf livre/annule → annule
 *
 * Kanban 8 colonnes actives :
 *   recu | en_diagnostic | attente_accord | a_commander | commande | pieces_recues | en_reparation | termine
 * + colonnes terminales : livre | annule
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import { parsePagination, nextNumero, auditLog } from '../lib/db'
import { createGarantieFromTicket } from '../services/garantiesService'
import { sendTicketCree, sendTicketTermine } from '../services/emailService'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

// Transitions autorisées (statut_avant → [statuts_suivants_possibles])
const TRANSITIONS: Record<string, string[]> = {
  recu:           ['en_diagnostic', 'attente_accord', 'en_reparation', 'annule'],
  en_diagnostic:  ['attente_accord', 'a_commander', 'en_reparation', 'annule'],
  attente_accord: ['a_commander', 'en_reparation', 'annule'],
  a_commander:    ['commande', 'en_reparation', 'annule'],
  commande:       ['pieces_recues', 'annule'],
  pieces_recues:  ['en_reparation', 'annule'],
  en_reparation:  ['termine', 'annule'],
  termine:        ['livre'],
  livre:          [],      // état terminal
  annule:         [],      // état terminal
}

// Labels affichés dans le Kanban
const STATUT_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  recu:           { label: 'Reçu',               emoji: '📋', color: 'blue' },
  en_diagnostic:  { label: 'En diagnostic',      emoji: '🔍', color: 'purple' },
  attente_accord: { label: 'Attente accord',     emoji: '⏳', color: 'yellow' },
  a_commander:    { label: 'À commander',        emoji: '🛒', color: 'orange' },
  commande:       { label: 'Commandé',           emoji: '📦', color: 'indigo' },
  pieces_recues:  { label: 'Pièces reçues',      emoji: '✅', color: 'teal' },
  en_reparation:  { label: 'En réparation',      emoji: '🔧', color: 'cyan' },
  termine:        { label: 'Terminé',            emoji: '🎉', color: 'green' },
  livre:          { label: 'Livré',              emoji: '🚀', color: 'gray' },
  annule:         { label: 'Annulé',             emoji: '❌', color: 'red' },
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

// ── GET /api/tickets/kanban ─────────────────────────────────────────────────
// Retourne les tickets groupés par statut, avec ancienneté et indicateurs couleur
tickets.get('/kanban', async (c) => {
  const user      = c.get('user')
  const query     = c.req.query()
  const boutiqueId = getBoutiqueId(user, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  // Tous les tickets actifs hors terminaux (livre/annule) + terminaux récents (7j)
  const rows = await c.env.DB.prepare(`
    SELECT t.id, t.numero, t.statut, t.priorite,
           t.appareil_marque, t.appareil_modele, t.description_panne,
           t.prix_estime, t.prix_final,
           t.date_reception, t.date_promesse, t.date_commande_pieces, t.date_reception_pieces,
           t.technicien_id,
           c.prenom || ' ' || c.nom   AS client_nom,
           c.telephone                AS client_telephone,
           u.prenom || ' ' || u.nom   AS technicien_nom,
           CAST((
             julianday('now') - julianday(t.date_reception)
           ) AS INTEGER)              AS jours_anciennete
    FROM   tickets t
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN users   u ON u.id = t.technicien_id
    WHERE  t.boutique_id = ? AND t.actif = 1
      AND (t.statut NOT IN ('livre','annule')
        OR (t.statut IN ('livre','annule')
            AND t.updated_at >= datetime('now', '-7 days')))
    ORDER  BY
      CASE t.priorite WHEN 'urgente' THEN 1 WHEN 'haute' THEN 2 WHEN 'normale' THEN 3 ELSE 4 END,
      t.date_reception ASC
  `).bind(boutiqueId).all<any>()

  // Colonnes Kanban ordonnées
  const COLONNES = [
    'recu', 'en_diagnostic', 'attente_accord',
    'a_commander', 'commande', 'pieces_recues',
    'en_reparation', 'termine', 'livre', 'annule'
  ]

  // Grouper par statut
  const colonnes: Record<string, any> = {}
  for (const col of COLONNES) {
    colonnes[col] = {
      statut:  col,
      ...STATUT_LABELS[col],
      tickets: [] as any[]
    }
  }

  const now = Date.now()
  for (const t of rows.results ?? []) {
    const jours = t.jours_anciennete ?? 0
    // Indicateur couleur ancienneté : vert <3j, orange 3-7j, rouge >7j, alerte >14j
    const anciennete_couleur =
      jours <= 2  ? 'green' :
      jours <= 6  ? 'orange' :
      jours <= 13 ? 'red' : 'black'

    const ticket = {
      ...t,
      anciennete_couleur,
      transitions_possibles: TRANSITIONS[t.statut] ?? [],
    }
    if (colonnes[t.statut]) {
      colonnes[t.statut].tickets.push(ticket)
    }
  }

  // Statistiques globales
  const stats = {
    total_actifs: (rows.results ?? []).filter((t: any) => !['livre','annule'].includes(t.statut)).length,
    urgents:      (rows.results ?? []).filter((t: any) => t.priorite === 'urgente').length,
    en_retard:    (rows.results ?? []).filter((t: any) => t.date_promesse && new Date(t.date_promesse) < new Date() && !['livre','annule','termine'].includes(t.statut)).length,
  }

  return c.json({
    success: true,
    colonnes: Object.values(colonnes),
    stats,
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

  // Générer un tracking_token unique (32 hex chars) pour le suivi public client
  const trackingBytes = crypto.getRandomValues(new Uint8Array(16))
  const trackingToken = Array.from(trackingBytes).map(b => b.toString(16).padStart(2, '0')).join('')

  const result = await c.env.DB.prepare(`
    INSERT INTO tickets
      (boutique_id, numero, client_id, appareil_id, appareil_marque, appareil_modele,
       description_panne, technicien_id, prix_estime, date_promesse, notes_internes, tracking_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(boutiqueId, numero, client_id, appareil_id ?? null, appareil_marque, appareil_modele,
          description_panne, technicien_id ?? null, prix_estime ?? null,
          date_promesse ?? null, notes_internes ?? null, trackingToken).first<{ id: number }>()

  // Enregistrer la création dans l'historique
  await c.env.DB.prepare(`
    INSERT INTO tickets_statuts_historique (ticket_id, statut_ancien, statut_nouveau, user_id, commentaire)
    VALUES (?, ?, ?, ?, ?)
  `).bind(result?.id, 'creation', 'recu', user.sub, 'Ticket créé').run()

  await auditLog(c.env.DB, { boutique_id: boutiqueId, user_id: user.sub, action: 'CREATE_TICKET', entite_type: 'ticket', entite_id: result?.id })

  // ── Hook Sprint 2.11 : email de confirmation de dépôt ───────────────────────
  if (result?.id) {
    const frontendUrl = (c.env as any).FRONTEND_URL ?? 'http://localhost:3000'
    const clientRow = await c.env.DB.prepare(
      'SELECT email, prenom FROM clients WHERE id = ? LIMIT 1'
    ).bind(client_id).first<{ email: string | null; prenom: string }>()
    if (clientRow?.email) {
      sendTicketCree(c.env.DB, boutiqueId, {
        id: result.id, numero, tracking_token: trackingToken,
        client_email:    clientRow.email,
        client_prenom:   clientRow.prenom ?? 'Client',
        appareil_marque, appareil_modele, description_panne,
      }, frontendUrl).catch(() => {})   // non bloquant
    }
  }

  return c.json({ success: true, id: result?.id, numero, tracking_token: trackingToken, message: 'Ticket créé.' }, 201)
})

// ── PUT /api/tickets/:id ──────────────────────────────────────────────────────
tickets.put('/:id', async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()
  const { description_panne, diagnostic, technicien_id, prix_estime, prix_final,
          date_promesse, notes_internes, priorite } = body

  const existing = await c.env.DB.prepare('SELECT id FROM tickets WHERE id = ? AND actif = 1').bind(id).first()
  if (!existing) return c.json({ success: false, error: 'Ticket introuvable.' }, 404)

  const PRIORITES_VALIDES = ['basse', 'normale', 'haute', 'urgente']
  if (priorite && !PRIORITES_VALIDES.includes(priorite))
    return c.json({ success: false, error: `Priorité invalide. Valeurs : ${PRIORITES_VALIDES.join(', ')}.` }, 422)

  await c.env.DB.prepare(`
    UPDATE tickets SET
      description_panne = COALESCE(?, description_panne),
      diagnostic        = COALESCE(?, diagnostic),
      technicien_id     = COALESCE(?, technicien_id),
      prix_estime       = COALESCE(?, prix_estime),
      prix_final        = COALESCE(?, prix_final),
      date_promesse     = COALESCE(?, date_promesse),
      notes_internes    = COALESCE(?, notes_internes),
      priorite          = COALESCE(?, priorite),
      updated_at        = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(description_panne ?? null, diagnostic ?? null, technicien_id ?? null,
          prix_estime ?? null, prix_final ?? null, date_promesse ?? null,
          notes_internes ?? null, priorite ?? null, id).run()

  await auditLog(c.env.DB, { user_id: user.sub, action: 'UPDATE_TICKET', entite_type: 'ticket', entite_id: id })
  return c.json({ success: true, message: 'Ticket mis à jour.' })
})

// ── PUT /api/tickets/:id/statut ── Machine à états ─────────────────────────────
tickets.put('/:id/statut', async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const { statut, commentaire } = await c.req.json()

  const ticket = await c.env.DB.prepare('SELECT id, statut, boutique_id FROM tickets WHERE id = ? AND actif = 1').bind(id).first<{ id: number; statut: string; boutique_id: number }>()
  if (!ticket) return c.json({ success: false, error: 'Ticket introuvable.' }, 404)

  // Vérifier la transition
  const transitions = TRANSITIONS[ticket.statut] ?? []
  if (!transitions.includes(statut)) {
    return c.json({
      success: false,
      error: `Transition invalide : ${ticket.statut} → ${statut}. Transitions autorisées : ${transitions.join(', ') || 'aucune'}.`
    }, 422)
  }

  // Mettre à jour le statut + colonnes de date associées
  const extraFields: string[] = []
  if (statut === 'a_commander')   { extraFields.push('date_commande_pieces = CURRENT_TIMESTAMP') }
  if (statut === 'commande')      { extraFields.push('date_commande_pieces = COALESCE(date_commande_pieces, CURRENT_TIMESTAMP)') }
  if (statut === 'pieces_recues') { extraFields.push('date_reception_pieces = CURRENT_TIMESTAMP') }
  if (statut === 'termine')       { extraFields.push('date_cloture = CURRENT_TIMESTAMP') }
  if (statut === 'livre')         { extraFields.push('date_livraison = CURRENT_TIMESTAMP') }

  await c.env.DB.prepare(`
    UPDATE tickets SET statut = ?, updated_at = CURRENT_TIMESTAMP ${extraFields.map(f => ', ' + f).join('')}
    WHERE  id = ?
  `).bind(statut, id).run()

  // ── Hooks Sprint 2.10/2.11 : garantie + email à la clôture ─────────────────
  let garantieCreee: any = null
  if (statut === 'termine') {
    const boutiqueHook = getBoutiqueId(user, ticket.boutique_id?.toString())
    if (boutiqueHook) {
      try {
        garantieCreee = await createGarantieFromTicket(c.env.DB, id, boutiqueHook)
      } catch { /* non bloquant */ }

      // Email notification Sprint 2.11
      try {
        const frontendUrl = (c.env as any).FRONTEND_URL ?? 'http://localhost:3000'
        const tFull = await c.env.DB.prepare(`
          SELECT t.numero, t.tracking_token, t.prix_final, t.diagnostic,
                 t.appareil_marque, t.appareil_modele,
                 c.email AS client_email, c.prenom AS client_prenom
          FROM tickets t JOIN clients c ON c.id = t.client_id
          WHERE t.id = ? LIMIT 1
        `).bind(id).first<any>()
        if (tFull?.client_email) {
          sendTicketTermine(c.env.DB, boutiqueHook, tFull, garantieCreee, frontendUrl).catch(() => {})
        }
      } catch { /* non bloquant */ }
    }
  }

  // Enregistrer dans l'historique
  await c.env.DB.prepare(`
    INSERT INTO tickets_statuts_historique (ticket_id, statut_ancien, statut_nouveau, user_id, commentaire)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, ticket.statut, statut, user.sub, commentaire ?? null).run()

  await auditLog(c.env.DB, { user_id: user.sub, action: 'CHANGE_STATUT_TICKET', entite_type: 'ticket', entite_id: id, avant: { statut: ticket.statut }, apres: { statut } })

  return c.json({
    success: true,
    message: `Statut changé : ${ticket.statut} → ${statut}.`,
    statut,
    ...(garantieCreee ? { garantie: { id: garantieCreee.id, date_fin: garantieCreee.date_fin, garantie_jours: garantieCreee.garantie_jours } } : {}),
  })
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
