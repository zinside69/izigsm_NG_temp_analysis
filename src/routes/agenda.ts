/**
 * @module routes/agenda
 * @description Controller Agenda / Rendez-vous + export iCal (P1 MVC — 0 SQL ici).
 *
 * Rôle architectural :
 *   Controller pur (P1 Modularité) — orchestration HTTP uniquement.
 *   Toute logique métier et SQL est déléguée à `agendaService.ts` (Model).
 *   Toute validation d'entrée est déléguée à `validators.ts`.
 *
 * Sprint 2.6 — MOD-08 Agenda
 *
 * Endpoints protégés (JWT requis) :
 *   GET    /api/agenda/kpis           → KPIs agenda boutique
 *   GET    /api/agenda/view           → Vue calendrier groupée par date (semaine courante par défaut)
 *   GET    /api/agenda/ical-token     → Récupère ou génère le token iCal de la boutique
 *   GET    /api/agenda                → Liste RDV paginée avec filtres
 *   POST   /api/agenda                → Créer un rendez-vous
 *   GET    /api/agenda/:id            → Détail d'un rendez-vous
 *   PUT    /api/agenda/:id            → Modifier un rendez-vous
 *   PATCH  /api/agenda/:id/statut     → Changer le statut (machine à états)
 *   DELETE /api/agenda/:id            → Supprimer un RDV (soft delete)
 *
 * Endpoint public (sans JWT) :
 *   GET    /api/calendar/:token.ics   → Export iCal RFC 5545 (défini dans index.tsx)
 *
 * Machine à états RDV (validée côté service) :
 *   PENDING → SCHEDULED | CANCELLED
 *   SCHEDULED → DONE | NO_SHOW | CANCELLED | CONVERTED
 *   NO_SHOW → SCHEDULED (re-planification)
 *
 * Format de réponse (P5 uniforme) : `{ success, data?, error?, message? }`
 */

import { Hono } from 'hono'
import { authMiddleware } from '../lib/middleware'
import { validateRendezVous } from '../lib/validators'
import type { Database } from '../ports/database'
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

type Bindings = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string }
type Variables = { user: any; db: Database }

const agenda = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── Routes protégées (JWT requis) ────────────────────────────────────────────

/**
 * GET /api/agenda/kpis
 * Retourne les KPIs de l'agenda pour une boutique (total RDV, taux présence, etc.).
 * Défini avant `:id` pour éviter le conflit de routes Hono.
 *
 * Query params :
 *   `boutique_id` (requis)
 *
 * @returns 200 `{ success: true, data: KpisAgenda }`
 * @returns 400 si boutique_id manquant
 * @returns 500 en cas d'erreur serveur
 */
agenda.get('/agenda/kpis', authMiddleware, async (c) => {
  try {
    const { boutique_id } = c.req.query()
    if (!boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
    const data = await getKpisAgenda(c.get('db'), Number(boutique_id))
    return c.json({ success: true, data })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

/**
 * GET /api/agenda/view
 * Retourne la vue calendrier des RDV groupés par date.
 * Par défaut : semaine courante (lundi–dimanche de la semaine ISO courante).
 *
 * Query params :
 *   `boutique_id` (requis)
 *   `date_debut`  (optionnel, format YYYY-MM-DD HH:MM:SS — défaut : lundi courant)
 *   `date_fin`    (optionnel, format YYYY-MM-DD HH:MM:SS — défaut : dimanche courant)
 *   `user_id`     (optionnel, filtre par technicien assigné)
 *
 * @returns 200 `{ success: true, data: Record<string, RendezVous[]> }`
 * @returns 400 si boutique_id manquant
 * @returns 500 en cas d'erreur serveur
 */
agenda.get('/agenda/view', authMiddleware, async (c) => {
  try {
    const { boutique_id, date_debut, date_fin, user_id } = c.req.query()
    if (!boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

    // Calcul de la semaine courante (lundi ISO → dimanche)
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
      c.get('db'),
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

/**
 * GET /api/agenda/ical-token
 * Retourne le token iCal de la boutique, ou en génère un nouveau si absent.
 * Le token est stocké en DB dans `boutique_settings.ical_token`.
 *
 * L'URL iCal publique retournée peut être ajoutée dans Google Calendar / Apple Calendar.
 *
 * Query params :
 *   `boutique_id` (requis)
 *
 * @returns 200 `{ success: true, token: string, url: '/api/calendar/{token}.ics' }`
 * @returns 400 si boutique_id manquant
 * @returns 500 en cas d'erreur serveur
 */
agenda.get('/agenda/ical-token', authMiddleware, async (c) => {
  try {
    const { boutique_id } = c.req.query()
    if (!boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
    const token = await getOrCreateIcalToken(c.get('db'), Number(boutique_id))
    const url   = `/api/calendar/${token}.ics`
    return c.json({ success: true, token, url })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

/**
 * GET /api/agenda
 * Liste les rendez-vous d'une boutique avec pagination et filtres.
 *
 * Query params :
 *   `boutique_id` (requis)
 *   `page`        (optionnel, défaut 1)
 *   `limit`       (optionnel, défaut 20, max 100)
 *   `statut`      (optionnel, filtre par statut RDV)
 *   `date_debut`  (optionnel, filtre à partir de cette date)
 *   `date_fin`    (optionnel, filtre jusqu'à cette date)
 *   `user_id`     (optionnel, filtre par technicien)
 *   `client_id`   (optionnel, filtre par client)
 *
 * @returns 200 `{ success: true, data: RendezVous[], total, page, limit }`
 * @returns 400 si boutique_id manquant
 * @returns 500 en cas d'erreur serveur
 */
agenda.get('/agenda', authMiddleware, async (c) => {
  try {
    const query = c.req.query()
    if (!query.boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
    const result = await listRendezVous(c.get('db'), Number(query.boutique_id), query)
    return c.json({ success: true, ...result })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

/**
 * POST /api/agenda
 * Crée un nouveau rendez-vous. Statut initial : `PENDING`.
 *
 * Body JSON :
 * ```json
 * {
 *   "boutique_id":   1,
 *   "client_id":     42,
 *   "user_id":       5,           // technicien assigné (optionnel)
 *   "titre":         "Réparation écran iPhone",
 *   "description":   "...",       // optionnel
 *   "date_rdv":      "2026-07-01 10:00:00",
 *   "duree_minutes": 60,
 *   "type_rdv":      "atelier"    // optionnel
 * }
 * ```
 *
 * Validation déléguée à `validateRendezVous()` (lib/validators.ts).
 *
 * @returns 201 `{ success: true, id: number, message: 'Rendez-vous créé.' }`
 * @returns 400 si boutique_id manquant ou validation échouée
 * @returns 500 en cas d'erreur serveur
 */
agenda.post('/agenda', authMiddleware, async (c) => {
  try {
    const body = await c.req.json()
    if (!body.boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

    const err = validateRendezVous(body)
    if (err) return c.json({ success: false, error: err }, 400)

    const user = c.get('user')
    const { id } = await createRendezVous(c.get('db'), Number(body.boutique_id), body, user.sub)
    return c.json({ success: true, id, message: 'Rendez-vous créé.' }, 201)
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

/**
 * GET /api/agenda/:id
 * Retourne le détail complet d'un rendez-vous (client, technicien, historique statuts).
 *
 * Query params :
 *   `boutique_id` (requis, isolation multi-tenant)
 *
 * @param id  Identifiant numérique du rendez-vous
 * @returns 200 `{ success: true, data: RendezVous }`
 * @returns 400 si boutique_id manquant
 * @returns 404 si RDV introuvable ou appartient à une autre boutique
 * @returns 500 en cas d'erreur serveur
 */
agenda.get('/agenda/:id', authMiddleware, async (c) => {
  try {
    const { boutique_id } = c.req.query()
    if (!boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
    const rdv = await getRendezVous(c.get('db'), Number(c.req.param('id')), Number(boutique_id))
    if (!rdv) return c.json({ success: false, error: 'RDV introuvable.' }, 404)
    return c.json({ success: true, data: rdv })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

/**
 * PUT /api/agenda/:id
 * Met à jour un rendez-vous existant (informations, date, technicien).
 * Ne modifie pas le statut — utiliser PATCH /:id/statut pour les transitions.
 *
 * Body JSON : même structure que POST (boutique_id requis).
 * Validation déléguée à `validateRendezVous()`.
 *
 * @param id  Identifiant numérique du rendez-vous
 * @returns 200 `{ success: true, message: 'RDV mis à jour.' }`
 * @returns 400 si boutique_id manquant ou validation échouée
 * @returns 404 si RDV introuvable
 * @returns 500 en cas d'erreur serveur
 */
agenda.put('/agenda/:id', authMiddleware, async (c) => {
  try {
    const body = await c.req.json()
    if (!body.boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

    const err = validateRendezVous(body)
    if (err) return c.json({ success: false, error: err }, 400)

    await updateRendezVous(c.get('db'), Number(c.req.param('id')), Number(body.boutique_id), body)
    return c.json({ success: true, message: 'RDV mis à jour.' })
  } catch (e: any) {
    // Détection 404 vs 400 par message d'erreur du service
    const status = e.message.includes('introuvable') ? 404 : 400
    return c.json({ success: false, error: e.message }, status)
  }
})

/**
 * PATCH /api/agenda/:id/statut
 * Change le statut d'un RDV en respectant la machine à états.
 *
 * Transitions valides :
 *   PENDING   → SCHEDULED | CANCELLED
 *   SCHEDULED → DONE | NO_SHOW | CANCELLED | CONVERTED
 *   NO_SHOW   → SCHEDULED (re-planification)
 *
 * Body JSON :
 * ```json
 * {
 *   "boutique_id": 1,
 *   "statut":      "SCHEDULED"
 * }
 * ```
 *
 * Validation du statut contre `STATUTS_RDV` (constante exportée du service).
 * Validation de la transition déléguée à `updateStatutRdv()`.
 *
 * @param id  Identifiant numérique du rendez-vous
 * @returns 200 `{ success: true, message: 'Statut mis à jour : SCHEDULED.' }`
 * @returns 400 si boutique_id/statut manquant, statut invalide, ou transition interdite
 * @returns 404 si RDV introuvable
 */
agenda.patch('/agenda/:id/statut', authMiddleware, async (c) => {
  try {
    const body = await c.req.json()
    if (!body.boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
    if (!body.statut) return c.json({ success: false, error: 'statut requis.' }, 400)
    // Validation de la valeur contre les statuts connus (constante du service)
    if (!(STATUTS_RDV as readonly string[]).includes(body.statut))
      return c.json({ success: false, error: `statut invalide. Valeurs : ${STATUTS_RDV.join(', ')}` }, 400)

    await updateStatutRdv(c.get('db'), Number(c.req.param('id')), Number(body.boutique_id), body.statut)
    return c.json({ success: true, message: `Statut mis à jour : ${body.statut}.` })
  } catch (e: any) {
    const status = e.message.includes('introuvable') ? 404 : 400
    return c.json({ success: false, error: e.message }, status)
  }
})

/**
 * DELETE /api/agenda/:id
 * Supprime un rendez-vous (soft delete — `actif = 0`).
 * Le RDV est conservé en base pour l'historique et l'audit.
 *
 * Query params :
 *   `boutique_id` (requis, isolation multi-tenant)
 *
 * @param id  Identifiant numérique du rendez-vous
 * @returns 200 `{ success: true, message: 'RDV supprimé.' }`
 * @returns 400 si boutique_id manquant
 * @returns 404 si RDV introuvable
 * @returns 500 en cas d'erreur serveur
 */
agenda.delete('/agenda/:id', authMiddleware, async (c) => {
  try {
    const { boutique_id } = c.req.query()
    if (!boutique_id) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
    await deleteRendezVous(c.get('db'), Number(c.req.param('id')), Number(boutique_id))
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
