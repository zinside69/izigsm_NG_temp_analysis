/**
 * services/userService.ts — Model layer Utilisateurs (PIN + Permissions)
 * Sprint 2.21 — Architecture P1 : 0 SQL dans les routes, tout ici.
 *
 * Périmètre :
 *   - PIN PBKDF2-SHA256 : set, verify (session KV 15min), delete, status, admin reset
 *   - Permissions granulaires : get, set (upsert) par action/boutique
 *   - Users : liste (admin = tous, manager = boutique)
 *
 * @module userService
 */

import { hashPassword, verifyPassword } from '../lib/auth'
import { auditLog } from '../lib/db'
import type { Database } from '../ports/database'

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Actions connues — whitelist des permissions granulaires. */
export const ACTIONS_VALIDES = [
  'discount',         // appliquer une remise
  'delete_ticket',    // supprimer un ticket
  'refund',           // émettre un avoir/remboursement
  'voir_prix_achat',  // voir prix d'achat dans le stock
  'acces_caisse',     // accès au module caisse POS
  'export_data',      // export CSV / comptable
  'modifier_prix',    // modifier prix de vente en cours de ticket
  'acces_stats',      // voir les stats / dashboard
] as const

export type Action = typeof ACTIONS_VALIDES[number]

// ─── PIN ──────────────────────────────────────────────────────────────────────

/**
 * Définit ou remplace le PIN d'un utilisateur.
 * @param db     - Instance D1Database
 * @param kv     - Instance KVNamespace
 * @param userId - ID de l'utilisateur
 * @param pin    - PIN en clair (4-6 chiffres — validation faite dans la route)
 */
export async function setPIN(
  db:     D1Database,
  kv:     import("../lib/d1kv").D1KVNamespace,
  userId: number,
  pin:    string
): Promise<void> {
  const pinHash = await hashPassword(pin)

  await db.prepare(`
    UPDATE users
    SET pin_hash   = ?,
        pin_actif  = 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(pinHash, userId).run()

  // Invalider toute session PIN existante
  await kv.delete(`pin_session:${userId}`)

  await auditLog(db, { user_id: userId, action: 'SET_PIN' })
}

/**
 * Vérifie le PIN d'un utilisateur et ouvre une session KV (TTL 15 min).
 * @param db     - Instance D1Database
 * @param kv     - Instance KVNamespace
 * @param userId - ID de l'utilisateur
 * @param pin    - PIN en clair
 */
export async function verifyPIN(
  db:     D1Database,
  kv:     import("../lib/d1kv").D1KVNamespace,
  userId: number,
  pin:    string
): Promise<void> {
  const row = await db.prepare(
    'SELECT pin_hash, pin_actif FROM users WHERE id = ?'
  ).bind(userId).first<{ pin_hash: string | null; pin_actif: number }>()

  if (!row?.pin_hash || !row.pin_actif)
    throw Object.assign(new Error('Aucun PIN configuré pour ce compte.'), { code: 'NO_PIN' })

  const ok = await verifyPassword(pin, row.pin_hash)
  if (!ok)
    throw Object.assign(new Error('PIN incorrect.'), { code: 'PIN_INCORRECT' })

  // Session KV — TTL 15 minutes
  await kv.put(`pin_session:${userId}`, '1', { expirationTtl: 900 })
}

/**
 * Supprime le PIN d'un utilisateur et invalide sa session.
 * @param db     - Instance D1Database
 * @param kv     - Instance KVNamespace
 * @param userId - ID de l'utilisateur
 */
export async function deletePIN(
  db:     D1Database,
  kv:     import("../lib/d1kv").D1KVNamespace,
  userId: number
): Promise<void> {
  await db.prepare(`
    UPDATE users
    SET pin_hash   = NULL,
        pin_actif  = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(userId).run()

  await kv.delete(`pin_session:${userId}`)
  await auditLog(db, { user_id: userId, action: 'DELETE_PIN' })
}

/**
 * Retourne le statut PIN + session active d'un utilisateur.
 * @param db     - Instance D1Database
 * @param kv     - Instance KVNamespace
 * @param userId - ID de l'utilisateur
 */
export async function getPINStatus(
  db:     D1Database,
  kv:     import("../lib/d1kv").D1KVNamespace,
  userId: number
): Promise<{ pin_actif: boolean; session_active: boolean }> {
  const [row, session] = await Promise.all([
    db.prepare('SELECT pin_actif FROM users WHERE id = ?')
      .bind(userId).first<{ pin_actif: number }>(),
    kv.get(`pin_session:${userId}`),
  ])

  return {
    pin_actif:      row?.pin_actif === 1,
    session_active: !!session,
  }
}

/**
 * Réinitialise le PIN d'un utilisateur cible (admin/manager).
 * Vérifie que la cible est accessible selon le rôle de l'admin.
 * @param db        - Instance D1Database
 * @param kv        - Instance KVNamespace
 * @param adminUser - Utilisateur admin/manager (depuis JWT)
 * @param targetId  - ID de l'utilisateur cible
 * @param pin       - Nouveau PIN en clair
 */
export async function resetPINAdmin(
  db:        D1Database,
  kv:        import("../lib/d1kv").D1KVNamespace,
  adminUser: { sub: number; role: string; boutique_id?: number | null },
  targetId:  number,
  pin:       string
): Promise<void> {
  const target = await db.prepare(
    'SELECT id, boutique_id FROM users WHERE id = ? AND actif = 1'
  ).bind(targetId).first<any>()

  if (!target) throw Object.assign(new Error('Utilisateur introuvable.'), { code: 'NOT_FOUND' })

  if (adminUser.role !== 'admin' && target.boutique_id !== adminUser.boutique_id)
    throw Object.assign(new Error('Accès refusé à cet utilisateur.'), { code: 'FORBIDDEN' })

  const pinHash = await hashPassword(pin)

  await db.prepare(`
    UPDATE users
    SET pin_hash   = ?,
        pin_actif  = 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(pinHash, targetId).run()

  await kv.delete(`pin_session:${targetId}`)

  await auditLog(db, {
    user_id: adminUser.sub, action: 'RESET_PIN_USER',
    entite_type: 'user', entite_id: targetId,
  })
}

// ─── Permissions ──────────────────────────────────────────────────────────────

/**
 * Retourne les permissions d'un utilisateur pour une boutique.
 * Défaut : toutes les actions autorisées (true), sauf exceptions enregistrées.
 * @param db         - Instance D1Database
 * @param targetId   - ID de l'utilisateur cible
 * @param boutiqueId - ID de la boutique
 */
export async function getPermissions(
  db:          D1Database,
  targetId:    number,
  boutiqueId:  number
): Promise<Record<string, boolean>> {
  const rows = await db.prepare(`
    SELECT action, autorise FROM permissions
    WHERE user_id = ? AND boutique_id = ?
  `).bind(targetId, boutiqueId).all<{ action: string; autorise: number }>()

  // Map initialisée à true (tout autorisé par défaut)
  const permsMap: Record<string, boolean> = {}
  ACTIONS_VALIDES.forEach(a => { permsMap[a] = true })
  ;(rows.results ?? []).forEach(r => { permsMap[r.action] = r.autorise === 1 })

  return permsMap
}

/**
 * Upsert de plusieurs permissions en une seule passe.
 * Ignore les actions inconnues (non dans ACTIONS_VALIDES).
 * @param db          - Instance D1Database
 * @param adminUser   - Utilisateur admin/manager effectuant l'action
 * @param targetId    - ID de l'utilisateur cible
 * @param boutiqueId  - ID de la boutique
 * @param permissions - Map action → boolean
 */
export async function setPermissions(
  db:          D1Database,
  adminUser:   { sub: number; role: string; boutique_id?: number | null },
  targetId:    number,
  boutiqueId:  number,
  permissions: Record<string, unknown>
): Promise<{ invalid_actions: string[] }> {
  // Vérifier que la cible existe et est accessible
  const target = await db.prepare(
    'SELECT id, boutique_id FROM users WHERE id = ? AND actif = 1'
  ).bind(targetId).first<any>()

  if (!target) throw Object.assign(new Error('Utilisateur introuvable.'), { code: 'NOT_FOUND' })
  if (adminUser.role !== 'admin' && target.boutique_id !== adminUser.boutique_id)
    throw Object.assign(new Error('Accès refusé.'), { code: 'FORBIDDEN' })

  const invalid: string[] = []
  const stmts: ReturnType<D1Database['prepare']>[] = []

  for (const [action, autorise] of Object.entries(permissions)) {
    if (!(ACTIONS_VALIDES as readonly string[]).includes(action)) {
      invalid.push(action)
      continue
    }
    stmts.push(
      db.prepare(`
        INSERT INTO permissions (user_id, boutique_id, action, autorise)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, boutique_id, action)
        DO UPDATE SET autorise = excluded.autorise
      `).bind(targetId, boutiqueId, action, autorise ? 1 : 0)
    )
  }

  if (stmts.length > 0) await db.batch(stmts)

  await auditLog(db, {
    boutique_id: boutiqueId, user_id: adminUser.sub,
    action: 'SET_PERMISSIONS', entite_type: 'user', entite_id: targetId,
    apres: { permissions },
  })

  return { invalid_actions: invalid }
}

// ─── Users — Liste ────────────────────────────────────────────────────────────

/**
 * Liste des utilisateurs.
 * Admin global → tous les users toutes boutiques.
 * Manager       → uniquement les users de sa boutique.
 *
 * Premier service migré vers le port `Database` (Sprint architecture Ports & Adapters,
 * voir docs/superpowers/specs/2026-07-12-architecture-ports-adapters-design.md) : `db`
 * n'est plus le binding D1 brut (`D1Database`, API `.prepare().bind().all()`) mais
 * l'abstraction `all/get/run` — objectif portabilité VPS/Postgres, aucun changement
 * de comportement métier. Le câblage de l'appelant (`routes/users.ts`) sur l'adaptateur
 * D1 réel se fait dans une tâche séparée du même chantier.
 * @param db         - Port Database (implémentation D1 aujourd'hui, Postgres à la bascule VPS)
 * @param adminUser  - Utilisateur effectuant la requête
 * @param boutiqueId - ID boutique (ignoré pour admin global)
 */
export async function listUsers(
  db:          Database,
  adminUser:   { role: string; boutique_id?: number | null },
  boutiqueId:  number
): Promise<any[]> {
  if (adminUser.role === 'admin') {
    return db.all<any>(`
      SELECT u.id, u.email, u.prenom, u.nom, u.telephone, u.actif,
             u.pin_actif, r.nom as role, u.boutique_id,
             b.nom as boutique_nom, u.created_at
      FROM   users u
      JOIN   roles r ON r.id = u.role_id
      LEFT JOIN boutiques b ON b.id = u.boutique_id
      ORDER  BY u.created_at ASC
    `)
  }

  return db.all<any>(`
    SELECT u.id, u.email, u.prenom, u.nom, u.telephone, u.actif,
           u.pin_actif, r.nom as role, u.boutique_id, u.created_at
    FROM   users u
    JOIN   roles r ON r.id = u.role_id
    WHERE  u.boutique_id = ?
    ORDER  BY u.created_at ASC
  `, [boutiqueId])
}
