/**
 * routes/users.ts — PIN technicien + Permissions granulaires
 * Sprint 2.3
 */

import { Hono } from 'hono'
import { hashPassword, verifyPassword } from '../lib/auth'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import { auditLog } from '../lib/db'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const users = new Hono<{ Bindings: Bindings; Variables: Variables }>()
users.use('*', authMiddleware)

// Actions connues (whitelist)
const ACTIONS_VALIDES = [
  'discount',           // appliquer une remise
  'delete_ticket',      // supprimer un ticket
  'refund',             // émettre un avoir/remboursement
  'voir_prix_achat',    // voir prix d'achat dans le stock
  'acces_caisse',       // accès au module caisse POS
  'export_data',        // export CSV / comptable
  'modifier_prix',      // modifier prix de vente en cours de ticket
  'acces_stats',        // voir les stats / dashboard
]

// ══════════════════════════════════════════════════════════════════════════════
// PIN
// ══════════════════════════════════════════════════════════════════════════════

// ── POST /api/users/pin/set — définir/changer son PIN ─────────────────────────
users.post('/users/pin/set', async (c) => {
  const user = c.get('user')
  const { pin } = await c.req.json()

  if (!pin || !/^\d{4,6}$/.test(String(pin)))
    return c.json({ success: false, error: 'PIN invalide : 4 à 6 chiffres requis.' }, 400)

  const pinHash = await hashPassword(String(pin))

  await c.env.DB.prepare(`
    UPDATE users SET pin_hash = ?, pin_actif = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(pinHash, user.sub).run()

  await auditLog(c.env.DB, { user_id: user.sub, action: 'SET_PIN' })
  return c.json({ success: true, message: 'PIN défini avec succès.' })
})

// ── POST /api/users/pin/verify — vérifier PIN + émettre session KV 15min ─────
users.post('/users/pin/verify', async (c) => {
  const user = c.get('user')
  const { pin } = await c.req.json()

  if (!pin) return c.json({ success: false, error: 'PIN requis.' }, 400)

  const row = await c.env.DB.prepare('SELECT pin_hash, pin_actif FROM users WHERE id = ?')
    .bind(user.sub).first<{ pin_hash: string | null; pin_actif: number }>()

  if (!row?.pin_hash || !row.pin_actif)
    return c.json({ success: false, error: 'Aucun PIN configuré pour ce compte.' }, 400)

  const ok = await verifyPassword(String(pin), row.pin_hash)
  if (!ok) return c.json({ success: false, error: 'PIN incorrect.' }, 403)

  // Stocker session PIN dans KV (TTL 15 min)
  const sessionKey = `pin_session:${user.sub}`
  await c.env.KV.put(sessionKey, '1', { expirationTtl: 900 })

  return c.json({ success: true, message: 'PIN vérifié. Session active 15 minutes.' })
})

// ── DELETE /api/users/pin — désactiver son PIN ────────────────────────────────
users.delete('/users/pin', async (c) => {
  const user = c.get('user')

  await c.env.DB.prepare(`
    UPDATE users SET pin_hash = NULL, pin_actif = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(user.sub).run()

  await c.env.KV.delete(`pin_session:${user.sub}`)
  await auditLog(c.env.DB, { user_id: user.sub, action: 'DELETE_PIN' })
  return c.json({ success: true, message: 'PIN supprimé.' })
})

// ── GET /api/users/pin/status — a-t-il un PIN ? session active ? ──────────────
users.get('/users/pin/status', async (c) => {
  const user = c.get('user')

  const row = await c.env.DB.prepare('SELECT pin_actif FROM users WHERE id = ?')
    .bind(user.sub).first<{ pin_actif: number }>()

  const session = await c.env.KV.get(`pin_session:${user.sub}`)

  return c.json({
    success:        true,
    pin_actif:      row?.pin_actif === 1,
    session_active: !!session,
  })
})

// ── POST /api/users/:id/pin/reset — admin reset PIN d'un user ────────────────
users.post('/users/:id/pin/reset', requireRole('admin', 'manager'), async (c) => {
  const adminUser = c.get('user')
  const targetId  = parseInt(c.req.param('id'), 10)
  const { pin }   = await c.req.json()

  if (!pin || !/^\d{4,6}$/.test(String(pin)))
    return c.json({ success: false, error: 'PIN invalide : 4 à 6 chiffres requis.' }, 400)

  // Vérifier que la cible appartient à la même boutique (sauf admin global)
  const target = await c.env.DB.prepare('SELECT id, boutique_id FROM users WHERE id = ? AND actif = 1')
    .bind(targetId).first<any>()
  if (!target) return c.json({ success: false, error: 'Utilisateur introuvable.' }, 404)

  if (adminUser.role !== 'admin' && target.boutique_id !== adminUser.boutique_id)
    return c.json({ success: false, error: 'Accès refusé à cet utilisateur.' }, 403)

  const pinHash = await hashPassword(String(pin))
  await c.env.DB.prepare(`
    UPDATE users SET pin_hash = ?, pin_actif = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(pinHash, targetId).run()

  await c.env.KV.delete(`pin_session:${targetId}`)
  await auditLog(c.env.DB, { user_id: adminUser.sub, action: 'RESET_PIN_USER', entite_type: 'user', entite_id: targetId })
  return c.json({ success: true, message: `PIN réinitialisé pour l'utilisateur #${targetId}.` })
})

// ══════════════════════════════════════════════════════════════════════════════
// PERMISSIONS GRANULAIRES
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/users/:id/permissions ───────────────────────────────────────────
users.get('/users/:id/permissions', requireRole('admin', 'manager'), async (c) => {
  const adminUser = c.get('user')
  const targetId  = parseInt(c.req.param('id'), 10)
  const query     = c.req.query()
  const boutiqueId = getBoutiqueId(adminUser, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const rows = await c.env.DB.prepare(`
    SELECT action, autorise FROM permissions
    WHERE user_id = ? AND boutique_id = ?
  `).bind(targetId, boutiqueId).all()

  // Construire map : toutes les actions connues avec défaut = autorisé
  const permsMap: Record<string, boolean> = {}
  ACTIONS_VALIDES.forEach(a => { permsMap[a] = true }) // défaut : tout autorisé
  rows.results.forEach((r: any) => { permsMap[r.action] = r.autorise === 1 })

  return c.json({ success: true, user_id: targetId, boutique_id: boutiqueId, permissions: permsMap })
})

// ── PUT /api/users/:id/permissions — set plusieurs permissions d'un coup ──────
users.put('/users/:id/permissions', requireRole('admin', 'manager'), async (c) => {
  const adminUser  = c.get('user')
  const targetId   = parseInt(c.req.param('id'), 10)
  const body       = await c.req.json()
  const { boutique_id: bodyBoutiqueId, permissions } = body

  const boutiqueId = getBoutiqueId(adminUser, bodyBoutiqueId?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
  if (!permissions || typeof permissions !== 'object')
    return c.json({ success: false, error: 'permissions (objet) requis.' }, 400)

  // Vérifier que la cible existe et est accessible
  const target = await c.env.DB.prepare('SELECT id, boutique_id FROM users WHERE id = ? AND actif = 1')
    .bind(targetId).first<any>()
  if (!target) return c.json({ success: false, error: 'Utilisateur introuvable.' }, 404)
  if (adminUser.role !== 'admin' && target.boutique_id !== adminUser.boutique_id)
    return c.json({ success: false, error: 'Accès refusé.' }, 403)

  // Upsert chaque permission
  const invalid: string[] = []
  for (const [action, autorise] of Object.entries(permissions)) {
    if (!ACTIONS_VALIDES.includes(action)) { invalid.push(action); continue }
    await c.env.DB.prepare(`
      INSERT INTO permissions (user_id, boutique_id, action, autorise)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, boutique_id, action)
      DO UPDATE SET autorise = excluded.autorise
    `).bind(targetId, boutiqueId, action, autorise ? 1 : 0).run()
  }

  await auditLog(c.env.DB, {
    boutique_id: boutiqueId, user_id: adminUser.sub,
    action: 'SET_PERMISSIONS', entite_type: 'user', entite_id: targetId,
    apres: { permissions },
  })

  return c.json({
    success: true,
    message: `Permissions mises à jour.`,
    invalid_actions: invalid.length ? invalid : undefined,
  })
})

// ── GET /api/users — liste users de la boutique ───────────────────────────────
users.get('/users', requireRole('admin', 'manager'), async (c) => {
  const adminUser  = c.get('user')
  const query      = c.req.query()
  const boutiqueId = getBoutiqueId(adminUser, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  // Pour admin : tous les users
  let result
  if (adminUser.role === 'admin') {
    result = await c.env.DB.prepare(`
      SELECT u.id, u.email, u.prenom, u.nom, u.telephone, u.actif,
             u.pin_actif, r.nom as role, u.boutique_id,
             b.nom as boutique_nom, u.created_at
      FROM   users u
      JOIN   roles r ON r.id = u.role_id
      LEFT JOIN boutiques b ON b.id = u.boutique_id
      ORDER  BY u.created_at ASC
    `).all()
  } else {
    result = await c.env.DB.prepare(`
      SELECT u.id, u.email, u.prenom, u.nom, u.telephone, u.actif,
             u.pin_actif, r.nom as role, u.boutique_id, u.created_at
      FROM   users u
      JOIN   roles r ON r.id = u.role_id
      WHERE  u.boutique_id = ?
      ORDER  BY u.created_at ASC
    `).bind(boutiqueId).all()
  }

  return c.json({ success: true, data: result.results })
})

export default users
export { ACTIONS_VALIDES }
