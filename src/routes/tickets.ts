/**
 * routes/tickets.ts — Controller Tickets de réparation
 * Sprint 2.17 — Refactoring P1 : tout le SQL délégué à ticketService.ts
 *
 * Ce fichier ne contient AUCUN SQL. Il orchestre uniquement :
 *   - Extraction des paramètres de la requête HTTP
 *   - Appel du service approprié
 *   - Formatage de la réponse P5 { success, data?, error?, message? }
 *
 * Hooks cross-services conservés ici (non bloquants) :
 *   - createGarantieFromTicket (savService) au passage en statut 'termine'
 *   - sendTicketCree / sendTicketTermine (emailService) à la création et clôture
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import {
  listTickets,
  getKanban,
  getTicketById,
  createTicket,
  updateTicket,
  updateStatutTicket,
  deleteTicket,
  getTicketBoutiqueId,
  getTicketAvecClient,
  type StatutTicket,
} from '../services/ticketService'
import { getClientEmailPrenom } from '../services/clientService'
import { createGarantieFromTicket } from '../services/garantiesService'
import { sendTicketCree, sendTicketTermine, sendTicketLivre } from '../services/emailService'

type Bindings = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const tickets = new Hono<{ Bindings: Bindings; Variables: Variables }>()
tickets.use('*', authMiddleware)

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

// ── GET /api/tickets/kanban ── (déclaré AVANT /:id pour éviter collision) ────
/**
 * Vue Kanban : tickets groupés par statut avec indicateurs d'ancienneté.
 * @query boutique_id — obligatoire
 * @returns { success, colonnes, stats }
 */
tickets.get('/kanban', async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await getKanban(db, boutiqueId)
  return c.json({ success: true, ...result })
})

// ── GET /api/tickets ──────────────────────────────────────────────────────────
/**
 * Liste paginée des tickets avec filtres.
 * @query boutique_id, statut?, technicien?, client_id?, search?, page?, limit?
 * @returns { success, data, pagination }
 */
tickets.get('/', async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const query      = c.req.query()
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listTickets(db, boutiqueId, {
    statut:     query.statut     ?? undefined,
    technicien: query.technicien ? parseInt(query.technicien, 10) : undefined,
    client_id:  query.client_id  ? parseInt(query.client_id,  10) : undefined,
    search:     query.search     ?? undefined,
    page:       query.page       ? parseInt(query.page,       10) : undefined,
    limit:      query.limit      ? parseInt(query.limit,      10) : undefined,
  })

  return c.json({ success: true, ...result })
})

// ── GET /api/tickets/:id ──────────────────────────────────────────────────────
/**
 * Fiche complète d'un ticket (+ historique statuts + photos).
 * @param id — ID du ticket
 * @returns { success, data }
 */
tickets.get('/:id', async (c) => {
  const { db } = ctx(c)
  const id = parseInt(c.req.param('id'), 10)

  const data = await getTicketById(db, id)
  if (!data) return c.json({ success: false, error: 'Ticket introuvable.' }, 404)

  return c.json({ success: true, data })
})

// ── POST /api/tickets ─────────────────────────────────────────────────────────
/**
 * Crée un nouveau ticket.
 * Hook email non bloquant : envoi confirmation de dépôt au client.
 * @body client_id, appareil_marque, appareil_modele, description_panne (obligatoires)
 * @body boutique_id, technicien_id?, prix_estime?, date_promesse?, notes_internes? (optionnels)
 * @returns { success, id, numero, tracking_token }
 */
tickets.post('/', async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const body = await c.req.json()
  const { client_id, appareil_id, appareil_marque, appareil_modele,
          description_panne, technicien_id, prix_estime, date_promesse, notes_internes } = body

  if (!client_id || !appareil_marque || !appareil_modele || !description_panne)
    return c.json({ success: false, error: 'Champs obligatoires manquants (client_id, appareil_marque, appareil_modele, description_panne).' }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString() ?? queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const created = await createTicket(db, boutiqueId, user.sub, {
    client_id, appareil_id, appareil_marque, appareil_modele,
    description_panne, technicien_id, prix_estime, date_promesse, notes_internes,
  })

  // ── Hook email création (non bloquant) ──────────────────────────────────────
  const frontendUrl  = (c.env as any).FRONTEND_URL ?? 'http://localhost:3000'
  const clientRow = await getClientEmailPrenom(db, client_id)

  if (clientRow?.email) {
    sendTicketCree(db, boutiqueId, {
      id:              created.id,
      numero:          created.numero,
      tracking_token:  created.tracking_token,
      client_email:    clientRow.email,
      client_prenom:   clientRow.prenom ?? 'Client',
      appareil_marque, appareil_modele, description_panne,
    }, frontendUrl).catch(() => {})
  }

  return c.json({
    success:        true,
    id:             created.id,
    numero:         created.numero,
    tracking_token: created.tracking_token,
    message:        'Ticket créé.',
  }, 201)
})

// ── PUT /api/tickets/:id ──────────────────────────────────────────────────────
/**
 * Met à jour les champs éditables d'un ticket (hors statut).
 * @param id — ID du ticket
 * @body description_panne?, diagnostic?, technicien_id?, prix_estime?, prix_final?,
 *       date_promesse?, notes_internes?, priorite?
 * @returns { success, message }
 */
tickets.put('/:id', async (c) => {
  const { user, db } = ctx(c)
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  try {
    await updateTicket(db, id, user.sub, body)
    return c.json({ success: true, message: 'Ticket mis à jour.' })
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

// ── PUT /api/tickets/:id/statut — Machine à états ─────────────────────────────
/**
 * Applique une transition de statut sur un ticket.
 * Hook garantie (savService) et email (emailService) au passage en 'termine'.
 * @param id — ID du ticket
 * @body statut (nouveau statut cible), commentaire?
 * @returns { success, message, statut, garantie? }
 */
tickets.put('/:id/statut', async (c) => {
  const { user, db } = ctx(c)
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()
  const { statut, commentaire } = body

  try {
    const { statut_avant, statut_apres } = await updateStatutTicket(
      db, id, user.sub, statut as StatutTicket, commentaire
    )

    // ── Hooks à la clôture (statut 'termine' ou 'livre') — non bloquants ────
    let garantieCreee: any = null
    if (statut_apres === 'termine' || statut_apres === 'livre') {
      const ticketRow = await getTicketBoutiqueId(db, id)

      if (ticketRow) {
        if (statut_apres === 'termine') {
          // Garantie automatique uniquement à la clôture 'termine'
          try {
            garantieCreee = await createGarantieFromTicket(db, id, ticketRow.boutique_id)
          } catch { /* non bloquant */ }
        }

        // Email notification (termine ou livre)
        try {
          const frontendUrl = (c.env as any).FRONTEND_URL ?? 'http://localhost:3000'
          const tFull = await getTicketAvecClient(db, id)

          if (tFull?.client_email) {
            if (statut_apres === 'termine') {
              sendTicketTermine(db, ticketRow.boutique_id, tFull, garantieCreee, frontendUrl).catch(() => {})
            } else {
              sendTicketLivre(db, ticketRow.boutique_id, tFull, frontendUrl).catch(() => {})
            }
          }
        } catch { /* non bloquant */ }
      }
    }

    return c.json({
      success: true,
      message: `Statut changé : ${statut_avant} → ${statut_apres}.`,
      statut:  statut_apres,
      ...(garantieCreee
        ? { garantie: { id: garantieCreee.id, date_fin: garantieCreee.date_fin, garantie_jours: garantieCreee.garantie_jours } }
        : {}),
    })
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

// ── DELETE /api/tickets/:id ───────────────────────────────────────────────────
/**
 * Soft-delete un ticket (actif = 0). Réservé admin/manager.
 * @param id — ID du ticket
 * @returns { success, message }
 */
tickets.delete('/:id', requireRole('admin', 'manager'), async (c) => {
  const { user, db } = ctx(c)
  const id = parseInt(c.req.param('id'), 10)

  await deleteTicket(db, id, user.sub)
  return c.json({ success: true, message: 'Ticket supprimé.' })
})

export default tickets
