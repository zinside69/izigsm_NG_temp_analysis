/**
 * routes/personnel.ts — Employés & Pointage (machine à états)
 * Sprint 2.21 — Architecture P1 MVC : Controller pur — 0 SQL (tout délégué à personnelService).
 *
 * Machine à états du pointage :
 *   absent → en_poste → pause → en_poste → termine
 *
 * @module routes/personnel
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import {
  listEmployes, getEmploye, createEmploye, updateEmploye, desactiverEmploye,
  pointer, pointagesAujourdhui, rapportPointage, statutsTempsReel,
} from '../services/personnelService'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const personnel = new Hono<{ Bindings: Bindings; Variables: Variables }>()
personnel.use('*', authMiddleware)

// ══════════════════════════════════════════════════════════════════════════════
// EMPLOYÉS — CRUD
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/employes
 * Liste des employés actifs avec statut pointage temps réel.
 * Query : boutique_id
 */
personnel.get('/employes', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const data = await listEmployes(c.env.DB, boutiqueId)
  return c.json({ success: true, data })
})

/**
 * GET /api/employes/:id
 * Détail d'un employé + 50 derniers pointages.
 */
personnel.get('/employes/:id', async (c) => {
  const id   = parseInt(c.req.param('id'), 10)
  const data = await getEmploye(c.env.DB, id)
  if (!data) return c.json({ success: false, error: 'Employé introuvable.' }, 404)
  return c.json({ success: true, data })
})

/**
 * POST /api/employes
 * Crée un employé (optionnel : liaison compte utilisateur via user_id).
 * Body : { prenom, nom, poste?, email?, telephone?, taux_horaire?, commission_pct?, user_id?, boutique_id? }
 */
personnel.post('/employes', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  if (!body.prenom || !body.nom)
    return c.json({ success: false, error: 'Prénom et nom obligatoires.' }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const { id } = await createEmploye(c.env.DB, boutiqueId, user.sub, body)
  return c.json({ success: true, id, message: 'Employé créé.' }, 201)
})

/**
 * PUT /api/employes/:id
 * Mise à jour des informations d'un employé.
 * Body : { prenom, nom, poste?, email?, telephone?, taux_horaire?, commission_pct? }
 */
personnel.put('/employes/:id', requireRole('admin', 'manager'), async (c) => {
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  await updateEmploye(c.env.DB, id, body)
  return c.json({ success: true, message: 'Employé mis à jour.' })
})

/**
 * DELETE /api/employes/:id
 * Désactive un employé (soft delete).
 */
personnel.delete('/employes/:id', requireRole('admin'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  await desactiverEmploye(c.env.DB, id)
  return c.json({ success: true, message: 'Employé désactivé.' })
})

// ══════════════════════════════════════════════════════════════════════════════
// POINTAGE — Machine à états
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/pointage/:employeId/pointer
 * Déclenche la prochaine transition de pointage.
 * Body : { statut?, notes?, latitude?, longitude? }
 */
personnel.post('/pointage/:employeId/pointer', async (c) => {
  const user      = c.get('user')
  const employeId = parseInt(c.req.param('employeId'), 10)
  const body      = await c.req.json().catch(() => ({}))

  try {
    const result = await pointer(c.env.DB, employeId, user.sub, body)
    return c.json({ success: true, ...result })
  } catch (err: any) {
    const status = err.code === 'JOURNEE_TERMINEE'   ? 422
                 : err.code === 'TRANSITION_INVALIDE' ? 422 : 404
    return c.json({ success: false, error: err.message }, status)
  }
})

/**
 * GET /api/pointage/:employeId/aujourd-hui
 * Pointages du jour + calcul heures travaillées.
 */
personnel.get('/pointage/:employeId/aujourd-hui', async (c) => {
  const employeId = parseInt(c.req.param('employeId'), 10)
  const result    = await pointagesAujourdhui(c.env.DB, employeId)
  return c.json({ success: true, employe_id: employeId, ...result })
})

/**
 * GET /api/pointage/rapport
 * Rapport de présences sur une période.
 * Query : boutique_id, date_debut?, date_fin?
 */
personnel.get('/pointage/rapport', requireRole('admin', 'manager'), async (c) => {
  const user       = c.get('user')
  const query      = c.req.query()
  const boutiqueId = getBoutiqueId(user, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const dateDebut = query.date_debut ?? new Date(Date.now() - 7 * 86_400_000).toISOString().split('T')[0]
  const dateFin   = query.date_fin   ?? new Date().toISOString().split('T')[0]

  const data = await rapportPointage(c.env.DB, boutiqueId, dateDebut, dateFin)
  return c.json({ success: true, periode: { debut: dateDebut, fin: dateFin }, data })
})

/**
 * GET /api/pointage/statuts
 * Statuts temps réel de tous les employés actifs, groupés par statut.
 * Query : boutique_id
 */
personnel.get('/pointage/statuts', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await statutsTempsReel(c.env.DB, boutiqueId)
  return c.json({ success: true, ...result })
})

export default personnel
