/**
 * routes/users.ts — PIN technicien + Permissions granulaires + Liste utilisateurs
 * Sprint 2.21 — Architecture P1 MVC : Controller pur — 0 SQL (tout délégué à userService).
 *
 * @module routes/users
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import {
  setPIN, verifyPIN, deletePIN, getPINStatus, resetPINAdmin,
  getPermissions, setPermissions, listUsers,
  ACTIONS_VALIDES,
} from '../services/userService'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const users = new Hono<{ Bindings: Bindings; Variables: Variables }>()
users.use('*', authMiddleware)

// ══════════════════════════════════════════════════════════════════════════════
// PIN
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/users/pin/set
 * Définit ou remplace le PIN de l'utilisateur connecté.
 * Body : { pin: string } — 4 à 6 chiffres
 */
users.post('/users/pin/set', async (c) => {
  const user = c.get('user')
  const { pin } = await c.req.json()

  if (!pin || !/^\d{4,6}$/.test(String(pin)))
    return c.json({ success: false, error: 'PIN invalide : 4 à 6 chiffres requis.' }, 400)

  await setPIN(c.env.DB, c.env.KV, user.sub, String(pin))
  return c.json({ success: true, message: 'PIN défini avec succès.' })
})

/**
 * POST /api/users/pin/verify
 * Vérifie le PIN et ouvre une session KV (15 min).
 * Body : { pin: string }
 */
users.post('/users/pin/verify', async (c) => {
  const user = c.get('user')
  const { pin } = await c.req.json()

  if (!pin) return c.json({ success: false, error: 'PIN requis.' }, 400)

  try {
    await verifyPIN(c.env.DB, c.env.KV, user.sub, String(pin))
    return c.json({ success: true, message: 'PIN vérifié. Session active 15 minutes.' })
  } catch (err: any) {
    const status = err.code === 'PIN_INCORRECT' ? 403 : 400
    return c.json({ success: false, error: err.message }, status)
  }
})

/**
 * DELETE /api/users/pin
 * Supprime le PIN de l'utilisateur connecté et invalide sa session.
 */
users.delete('/users/pin', async (c) => {
  const user = c.get('user')
  await deletePIN(c.env.DB, c.env.KV, user.sub)
  return c.json({ success: true, message: 'PIN supprimé.' })
})

/**
 * GET /api/users/pin/status
 * Retourne : pin_actif (bool) + session_active (bool, TTL KV).
 */
users.get('/users/pin/status', async (c) => {
  const user   = c.get('user')
  const status = await getPINStatus(c.env.DB, c.env.KV, user.sub)
  return c.json({ success: true, ...status })
})

/**
 * POST /api/users/:id/pin/reset
 * Réinitialise le PIN d'un utilisateur cible (admin/manager).
 * Body : { pin: string }
 */
users.post('/users/:id/pin/reset', requireRole('admin', 'manager'), async (c) => {
  const adminUser = c.get('user')
  const targetId  = parseInt(c.req.param('id'), 10)
  const { pin }   = await c.req.json()

  if (!pin || !/^\d{4,6}$/.test(String(pin)))
    return c.json({ success: false, error: 'PIN invalide : 4 à 6 chiffres requis.' }, 400)

  try {
    await resetPINAdmin(c.env.DB, c.env.KV, adminUser, targetId, String(pin))
    return c.json({ success: true, message: `PIN réinitialisé pour l'utilisateur #${targetId}.` })
  } catch (err: any) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// PERMISSIONS GRANULAIRES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/users/:id/permissions
 * Retourne la map permissions (action → bool) de l'utilisateur pour une boutique.
 * Query : boutique_id
 */
users.get('/users/:id/permissions', requireRole('admin', 'manager'), async (c) => {
  const adminUser  = c.get('user')
  const targetId   = parseInt(c.req.param('id'), 10)
  const boutiqueId = getBoutiqueId(adminUser, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const permissions = await getPermissions(c.env.DB, targetId, boutiqueId)
  return c.json({ success: true, user_id: targetId, boutique_id: boutiqueId, permissions })
})

/**
 * PUT /api/users/:id/permissions
 * Upsert de plusieurs permissions en une seule passe.
 * Body : { boutique_id, permissions: Record<string, boolean> }
 */
users.put('/users/:id/permissions', requireRole('admin', 'manager'), async (c) => {
  const adminUser = c.get('user')
  const targetId  = parseInt(c.req.param('id'), 10)
  const body      = await c.req.json()

  const boutiqueId = getBoutiqueId(adminUser, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
  if (!body.permissions || typeof body.permissions !== 'object')
    return c.json({ success: false, error: 'permissions (objet) requis.' }, 400)

  try {
    const { invalid_actions } = await setPermissions(
      c.env.DB, adminUser, targetId, boutiqueId, body.permissions
    )
    return c.json({
      success:         true,
      message:         'Permissions mises à jour.',
      invalid_actions: invalid_actions.length ? invalid_actions : undefined,
    })
  } catch (err: any) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// USERS — Liste
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/users
 * Admin → tous les users. Manager → users de sa boutique.
 * Query : boutique_id
 */
users.get('/users', requireRole('admin', 'manager'), async (c) => {
  const adminUser  = c.get('user')
  const query      = c.req.query()
  const boutiqueId = getBoutiqueId(adminUser, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const data = await listUsers(c.env.DB, adminUser, boutiqueId)
  return c.json({ success: true, data })
})

export default users
export { ACTIONS_VALIDES }
