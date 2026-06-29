/**
 * @file tests/helpers/mockKV.ts
 * @description Mock KVNamespace pour les tests unitaires Vitest.
 *
 * Reproduit l'interface Cloudflare KVNamespace :
 *   - `.get(key)` → retourne la valeur stockée ou `null`
 *   - `.put(key, value, options?)` → stocke la valeur
 *   - `.delete(key)` → supprime la clé
 *   - `.list(options?)` → liste les clés (non implémenté dans les services testés)
 *
 * Gestion TTL :
 *   Le TTL est stocké comme métadonnée mais n'est pas appliqué automatiquement
 *   (les tests sont synchrones — pas de timer réel). Pour simuler une clé expirée,
 *   utiliser `.__expire(key)` ou simplement ne pas l'ajouter.
 *
 * Utilisation :
 * ```ts
 * const kv = createMockKV()
 * await kv.put('otp:test@test.com', 'hashed_otp', { expirationTtl: 600 })
 * const val = await kv.get('otp:test@test.com')  // → 'hashed_otp'
 * await kv.delete('otp:test@test.com')
 * const gone = await kv.get('otp:test@test.com')  // → null
 * ```
 */

import { vi } from 'vitest'

export function createMockKV() {
  // Stockage en mémoire : clé → valeur
  const store = new Map<string, string>()

  const kv = {
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null
    },

    async put(key: string, value: string, _options?: { expirationTtl?: number; expiration?: number }): Promise<void> {
      store.set(key, value)
    },

    async delete(key: string): Promise<void> {
      store.delete(key)
    },

    async list(_options?: { prefix?: string; limit?: number; cursor?: string }) {
      return { keys: [], list_complete: true, cursor: undefined }
    },

    // API de test
    /** Force la suppression d'une clé (simule expiration TTL) */
    __expire(key: string) {
      store.delete(key)
    },

    /** Pré-remplit une clé directement sans passer par put() */
    __set(key: string, value: string) {
      store.set(key, value)
    },

    /** Retourne toutes les clés actuellement stockées */
    __keys(): string[] {
      return [...store.keys()]
    },

    /** Vide complètement le store */
    __reset() {
      store.clear()
    },

    /** Retourne le contenu brut du store (pour debug) */
    __dump(): Record<string, string> {
      return Object.fromEntries(store)
    },
  }

  return kv as unknown as KVNamespace & {
    __expire: (key: string) => void
    __set: (key: string, value: string) => void
    __keys: () => string[]
    __reset: () => void
    __dump: () => Record<string, string>
  }
}
