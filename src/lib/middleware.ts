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
