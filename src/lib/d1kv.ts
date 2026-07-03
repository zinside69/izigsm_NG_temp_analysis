/**
 * @module d1kv
 * @description Wrapper D1-as-KV — émule l'API `KVNamespace` Cloudflare dans une table D1.
 *
 * Contexte : le pipeline gsk-hosted-deploy ne supporte pas les KV namespaces.
 * Ce module expose `createD1KV(db)` qui retourne un objet implémentant
 * `KVNamespace` (méthodes `get`, `put`, `delete`) stocké dans la table `kv_store`.
 *
 * Compatibilité : seules les méthodes utilisées dans ce projet sont implémentées.
 *   - `get(key)`                      → lecture, null si absent ou expiré
 *   - `put(key, value, { expirationTtl })` → écriture avec TTL en secondes
 *   - `delete(key)`                   → suppression
 *
 * TTL : géré par la colonne `expires_at` (epoch secondes).
 * Le nettoyage passif s'applique à chaque `get()`.
 * Le nettoyage actif (`d1KvCleanup`) est appelé périodiquement depuis `index.tsx`.
 *
 * Usage :
 * ```ts
 * const kv = createD1KV(c.env.DB)
 * await kv.put('otp:user@ex.com', 'hash', { expirationTtl: 600 })
 * const val = await kv.get('otp:user@ex.com')  // null si expiré
 * await kv.delete('otp:user@ex.com')
 * ```
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Sous-ensemble de KVNamespace utilisé dans ce projet. */
export interface D1KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Crée un objet KV backed par la table D1 `kv_store`.
 * Retourné depuis les handlers Hono en remplacement de `c.env.KV`.
 *
 * @param db - Instance D1Database (Cloudflare binding)
 * @returns  Objet compatible `KVNamespace` (get/put/delete)
 */
export function createD1KV(db: D1Database): D1KVNamespace {
  return {
    /**
     * Lit une valeur. Retourne `null` si la clé est absente ou expirée.
     * Nettoyage passif : supprime l'entrée expirée si trouvée.
     */
    async get(key: string): Promise<string | null> {
      const now = Math.floor(Date.now() / 1000)
      const row = await db.prepare(
        'SELECT value, expires_at FROM kv_store WHERE key = ?'
      ).bind(key).first<{ value: string; expires_at: number | null }>()

      if (!row) return null

      // Expiration : nettoyage passif
      if (row.expires_at !== null && row.expires_at <= now) {
        await db.prepare('DELETE FROM kv_store WHERE key = ?').bind(key).run()
        return null
      }

      return row.value
    },

    /**
     * Écrit une valeur avec TTL optionnel.
     * `expirationTtl` est en secondes (compatible API KV Cloudflare).
     * Upsert : remplace la valeur existante si la clé existe déjà.
     */
    async put(
      key:     string,
      value:   string,
      options?: { expirationTtl?: number }
    ): Promise<void> {
      const expiresAt = options?.expirationTtl
        ? Math.floor(Date.now() / 1000) + options.expirationTtl
        : null

      await db.prepare(`
        INSERT INTO kv_store (key, value, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
      `).bind(key, value, expiresAt).run()
    },

    /**
     * Supprime une clé (idempotent — pas d'erreur si absente).
     */
    async delete(key: string): Promise<void> {
      await db.prepare('DELETE FROM kv_store WHERE key = ?').bind(key).run()
    },
  }
}

// ─── Nettoyage actif ──────────────────────────────────────────────────────────

/**
 * Supprime toutes les entrées expirées de `kv_store`.
 * À appeler périodiquement (ex. : à chaque requête entrante dans `index.tsx`
 * avec une probabilité de 1/100 pour éviter la surcharge).
 *
 * @param db - Instance D1Database
 * @returns  Nombre d'entrées supprimées
 */
export async function d1KvCleanup(db: D1Database): Promise<number> {
  const now = Math.floor(Date.now() / 1000)
  const result = await db.prepare(
    'DELETE FROM kv_store WHERE expires_at IS NOT NULL AND expires_at <= ?'
  ).bind(now).run()
  return result.meta?.changes ?? 0
}
