/**
 * lib/middleware.ts — Middlewares Hono (Auth JWT + RBAC)
 */

import { createMiddleware } from 'hono/factory'
import { validateAccessToken, type JwtPayload } from './auth'

// ─── Types ────────────────────────────────────────────────────────────────────

type Bindings = {
  DB:         D1Database
  KV:         KVNamespace
  JWT_SECRET: string
}

type Variables = {
  user: JwtPayload
}

// ─── Middleware d'authentification ────────────────────────────────────────────

/**
 * Vérifie le JWT dans le header Authorization: Bearer <token>
 * Injecte le payload dans c.var.user
 */
export const authMiddleware = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ success: false, error: 'Token manquant.' }, 401)
    }

    const token   = authHeader.slice(7)
    const secret  = c.env.JWT_SECRET
    const payload = await validateAccessToken(token, secret)

    if (!payload) {
      return c.json({ success: false, error: 'Token invalide ou expiré.' }, 401)
    }

    c.set('user', payload)
    await next()
  }
)

// ─── Middleware RBAC ──────────────────────────────────────────────────────────

/**
 * Vérifie que l'utilisateur a l'un des rôles autorisés.
 * Doit être utilisé APRÈS authMiddleware.
 *
 * Exemple :
 *   app.delete('/api/boutiques/:id', authMiddleware, requireRole('admin'), handler)
 */
export function requireRole(...roles: string[]) {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
    async (c, next) => {
      const user = c.get('user')
      if (!user) {
        return c.json({ success: false, error: 'Non authentifié.' }, 401)
      }
      if (!roles.includes(user.role)) {
        return c.json({
          success: false,
          error: `Accès refusé. Rôles requis : ${roles.join(', ')}. Votre rôle : ${user.role}.`
        }, 403)
      }
      await next()
    }
  )
}

// ─── Middleware : vérification session PIN (Sprint 2.3) ───────────────────────

/**
 * Vérifie qu'une session PIN active existe dans KV pour cet user.
 * Admin et manager sont exemptés.
 */
export const requirePin = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const user = c.get('user')
    if (user.role === 'admin' || user.role === 'manager') { await next(); return }
    const session = await c.env.KV.get(`pin_session:${user.sub}`)
    if (!session) {
      return c.json({ success: false, error: 'Session PIN requise.', pin_required: true }, 403)
    }
    await next()
  }
)

// ─── Helper : vérifier permission granulaire ──────────────────────────────────

/**
 * Vérifie si un user a une permission. Défaut = autorisé si aucune règle.
 */
export async function hasPermission(
  db: D1Database, userId: number, boutiqueId: number, action: string
): Promise<boolean> {
  const row = await db.prepare(
    'SELECT autorise FROM permissions WHERE user_id = ? AND boutique_id = ? AND action = ?'
  ).bind(userId, boutiqueId, action).first<{ autorise: number }>()
  return !row || row.autorise === 1
}

// ─── Helper : isolation par boutique ─────────────────────────────────────────

/**
 * Retourne le boutique_id à utiliser pour une requête.
 * - Admin → peut accéder à n'importe quelle boutique (param ?boutique_id=X)
 * - Autres rôles → uniquement leur boutique
 */
export function getBoutiqueId(
  user: JwtPayload,
  paramBoutiqueId?: string
): number | null {
  if (user.role === 'admin' && paramBoutiqueId) {
    return parseInt(paramBoutiqueId, 10)
  }
  return user.boutique_id
}
