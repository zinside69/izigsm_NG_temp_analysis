/**
 * routes/agenda.ts — Controller Agenda / Rendez-vous + iCal
 * Rôle architectural : Controller pur — 0 SQL ici, tout délégué à agendaService.
 * Sprint 2.6 — MOD-08 Agenda
 *
 * Endpoints :
 *   GET    /api/agenda/kpis                   → KPIs agenda boutique
 *   GET    /api/agenda/view                   → Vue calendrier (groupé par date)
 *   GET    /api/agenda/ical-token             → Récupère/génère le token iCal
 *   GET    /api/agenda                        → Liste RDV (paginée + filtres)
 *   POST   /api/agenda                        → Créer RDV
 *   GET    /api/agenda/:id                    → Détail RDV
 *   PUT    /api/agenda/:id                    → Modifier RDV
 *   PATCH  /api/agenda/:id/statut             → Changer statut
 *   DELETE /api/agenda/:id                    → Supprimer RDV (soft)
 *   GET    /api/calendar/:token.ics           → Export iCal public (sans auth)
 */

import { Hono } from 'hono'
import { authMiddleware } from '../lib/middleware'
import { validateRendezVous } from '../lib/validators'
import {
  listRendezVous,
  getRendezVous,
  createRendezVous,
  updateRendezVous,
  updateStatutRdv,
  deleteRendezVous,
  getAgendaView,
  getKpisAgenda,
  getOrCreateIcalToken,
  generateIcal,
  STATUTS_RDV,
} from '../services/agendaService'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const agenda = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── Routes protégées (JWT requis) ────────────────────────────────────────────

// KPIs — avant :id
agenda.get('/agenda/kpis', authMiddleware, async (c) => {
  try {
    const { boutique_id } = c.req.query()
    if (!boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
    const data = await getKpisAgenda(c.env.DB, Number(boutique_id))
    return c.json({ success: true, data })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// Vue calendrier (groupé par date)
agenda.get('/agenda/view', authMiddleware, async (c) => {
  try {
    const { boutique_id, date_debut, date_fin, user_id } = c.req.query()
    if (!boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

    // Par défaut : semaine courante
    const now       = new Date()
    const monday    = new Date(now)
    monday.setDate(now.getDate() - (now.getDay() || 7) + 1)
    monday.setHours(0, 0, 0, 0)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    sunday.setHours(23, 59, 59, 0)

    const debut = date_debut || monday.toISOString().replace('T', ' ').slice(0, 19)
    const fin   = date_fin   || sunday.toISOString().replace('T', ' ').slice(0, 19)

    const data = await getAgendaView(
      c.env.DB,
      Number(boutique_id),
      debut,
      fin,
      user_id ? Number(user_id) : undefined
    )
    return c.json({ success: true, data })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// Token iCal boutique
agenda.get('/agenda/ical-token', authMiddleware, async (c) => {
  try {
    const { boutique_id } = c.req.query()
    if (!boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
    const token = await getOrCreateIcalToken(c.env.DB, Number(boutique_id))
    const url   = `/api/calendar/${token}.ics`
    return c.json({ success: true, token, url })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// Liste RDV
agenda.get('/agenda', authMiddleware, async (c) => {
  try {
    const query = c.req.query()
    if (!query.boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
    const result = await listRendezVous(c.env.DB, Number(query.boutique_id), query)
    return c.json({ success: true, ...result })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// Créer RDV
agenda.post('/agenda', authMiddleware, async (c) => {
  try {
    const body = await c.req.json()
    if (!body.boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

    const err = validateRendezVous(body)
    if (err) return c.json({ success: false, error: err }, 400)

    const user = c.get('user')
    const { id } = await createRendezVous(c.env.DB, Number(body.boutique_id), body, user.sub)
    return c.json({ success: true, id, message: 'Rendez-vous créé.' }, 201)
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// Détail RDV
agenda.get('/agenda/:id', authMiddleware, async (c) => {
  try {
    const { boutique_id } = c.req.query()
    if (!boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
    const rdv = await getRendezVous(c.env.DB, Number(c.req.param('id')), Number(boutique_id))
    if (!rdv) return c.json({ success: false, error: 'RDV introuvable.' }, 404)
    return c.json({ success: true, data: rdv })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// Modifier RDV
agenda.put('/agenda/:id', authMiddleware, async (c) => {
  try {
    const body = await c.req.json()
    if (!body.boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

    const err = validateRendezVous(body)
    if (err) return c.json({ success: false, error: err }, 400)

    await updateRendezVous(c.env.DB, Number(c.req.param('id')), Number(body.boutique_id), body)
    return c.json({ success: true, message: 'RDV mis à jour.' })
  } catch (e: any) {
    const status = e.message.includes('introuvable') ? 404 : 400
    return c.json({ success: false, error: e.message }, status)
  }
})

// Changer statut RDV
agenda.patch('/agenda/:id/statut', authMiddleware, async (c) => {
  try {
    const body = await c.req.json()
    if (!body.boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
    if (!body.statut) return c.json({ success: false, error: 'statut requis.' }, 400)
    if (!(STATUTS_RDV as readonly string[]).includes(body.statut))
      return c.json({ success: false, error: `statut invalide. Valeurs : ${STATUTS_RDV.join(', ')}` }, 400)

    await updateStatutRdv(c.env.DB, Number(c.req.param('id')), Number(body.boutique_id), body.statut)
    return c.json({ success: true, message: `Statut mis à jour : ${body.statut}.` })
  } catch (e: any) {
    const status = e.message.includes('introuvable') ? 404 : 400
    return c.json({ success: false, error: e.message }, status)
  }
})

// Supprimer RDV (soft delete)
agenda.delete('/agenda/:id', authMiddleware, async (c) => {
  try {
    const { boutique_id } = c.req.query()
    if (!boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
    await deleteRendezVous(c.env.DB, Number(c.req.param('id')), Number(boutique_id))
    return c.json({ success: true, message: 'RDV supprimé.' })
  } catch (e: any) {
    const status = e.message.includes('introuvable') ? 404 : 500
    return c.json({ success: false, error: e.message }, status)
  }
})

// NOTE : La route iCal publique GET /api/calendar/:filename
// est définie directement dans index.tsx AVANT les routers avec use('*', authMiddleware)
// afin d'éviter que clientsRoutes/ticketsRoutes n'intercepte la requête.

export default agenda
