/**
 * @module middleware
 * @description Middlewares Hono — Authentification JWT et contrôle d'accès RBAC.
 *
 * Architecture de sécurité (ordre d'application obligatoire) :
 *   1. `authMiddleware`  — vérifie le JWT Bearer, injecte `c.var.user`
 *   2. `requireRole()`   — vérifie le rôle RBAC (à appliquer après authMiddleware)
 *   3. `requirePin`      — vérifie la session PIN KV (techniciens uniquement)
 *
 * Isolation multi-tenant :
 *   `getBoutiqueId()` garantit qu'un non-admin ne peut accéder qu'à sa boutique.
 *
 * Permissions granulaires :
 *   `hasPermission()` interroge la table `permissions` pour des droits fins
 *   par action (ex: "CREATE_TICKET", "ENCAISSER") au-delà du RBAC par rôle.
 *
 * Fonctions/middlewares exportés :
 *   - `authMiddleware`   : middleware Hono — vérification JWT
 *   - `requireRole()`    : factory middleware — RBAC par rôle(s)
 *   - `requirePin`       : middleware Hono — session PIN KV
 *   - `hasPermission()`  : helper async — permission granulaire DB
 *   - `getBoutiqueId()`  : helper sync — isolation boutique par rôle
 */

import { createMiddleware } from 'hono/factory'
import { validateAccessToken, type JwtPayload } from './auth'

// ─── Types ────────────────────────────────────────────────────────────────────

type Bindings = {
  DB:         D1Database
  KV:         import("../lib/d1kv").D1KVNamespace
  JWT_SECRET: string
}

type Variables = {
  user: JwtPayload
}

// ─── Middleware d'authentification ────────────────────────────────────────────

/**
 * Middleware d'authentification JWT — à appliquer sur toutes les routes protégées.
 *
 * Flux de vérification :
 *   1. Lit le header `Authorization: Bearer <token>`
 *   2. Extrait et valide le JWT via `validateAccessToken()` (HMAC-SHA256)
 *   3. Vérifie l'expiration du token (`exp` dans le payload)
 *   4. Injecte le payload décodé dans `c.var.user` (`JwtPayload`)
 *
 * Réponses d'erreur :
 *   - 401 si header absent ou mal formé
 *   - 401 si token invalide, signature incorrecte ou expiré
 *
 * @example
 * ```typescript
 *   app.get('/api/ressource', authMiddleware, handler)
 *   // ou globalement : app.use('*', authMiddleware)
 * ```
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
 * Factory middleware RBAC — vérifie que l'utilisateur possède l'un des rôles autorisés.
 *
 * Doit obligatoirement être chaîné APRÈS `authMiddleware` (utilise `c.var.user`).
 *
 * Rôles disponibles dans le système :
 *   `admin` | `manager` | `gerant` | `technicien` | `client`
 *
 * @param roles  Un ou plusieurs rôles autorisés (au moins un suffit pour passer)
 * @returns      Middleware Hono — 401 si non authentifié, 403 si rôle insuffisant
 *
 * @example
 * ```typescript
 *   // Un seul rôle :
 *   app.delete('/api/boutiques/:id', authMiddleware, requireRole('admin'), handler)
 *   // Plusieurs rôles :
 *   app.post('/api/caisse/cloture', authMiddleware, requireRole('admin', 'gerant'), handler)
 * ```
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
 * Middleware de vérification session PIN (Sprint 2.3 — accès caisse).
 *
 * Les techniciens doivent saisir leur PIN pour accéder aux opérations de caisse.
 * La session PIN est stockée dans KV sous la clé `pin_session:{user_id}`.
 *
 * Exemptions : `admin` et `manager` passent sans vérification PIN.
 * Doit être chaîné APRÈS `authMiddleware`.
 *
 * @returns Middleware Hono — 403 avec `{ pin_required: true }` si session absente
 *
 * @example
 * ```typescript
 *   caisse.post('/vente', authMiddleware, requirePin, handler)
 * ```
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
 * Vérifie si un utilisateur possède une permission granulaire pour une action.
 *
 * Logique par défaut (permissive) :
 *   - Si aucune règle n'existe en base → autorisé (`true`)
 *   - Si une règle existe → respecte la valeur `autorise` (0 ou 1)
 *
 * La table `permissions` permet de désactiver des actions spécifiques
 * pour un utilisateur donné sans modifier son rôle global.
 *
 * @param db          Binding D1 Cloudflare
 * @param userId      Identifiant de l'utilisateur à vérifier
 * @param boutiqueId  Identifiant de la boutique (isolation multi-tenant)
 * @param action      Nom de l'action en majuscules (ex: "CREATE_TICKET", "ENCAISSER")
 * @returns           `true` si autorisé ou aucune règle, `false` si explicitement refusé
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
 * Résout le boutique_id effectif pour une requête selon le rôle de l'utilisateur.
 *
 * Règles d'isolation multi-tenant :
 *   - `admin`       → peut spécifier n'importe quel boutique_id via query param
 *   - Autres rôles  → uniquement leur `user.boutique_id` (paramBoutiqueId ignoré)
 *
 * Retourne `null` si l'utilisateur non-admin n'a pas de boutique assignée.
 * La route appelante doit tester `boutiqueId !== null` avant d'exécuter des requêtes.
 *
 * @param user            Payload JWT décodé (contient `role` et `boutique_id`)
 * @param paramBoutiqueId Valeur brute du query param `boutique_id` (string ou undefined)
 * @returns               `boutique_id` résolu (number) ou `null` si non déterminable
 *
 * @example
 * ```typescript
 *   const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
 *   if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
 * ```
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
