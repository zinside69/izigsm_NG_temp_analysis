/**
 * @file tests/helpers/mockD1.ts
 * @description Mock D1Database pour les tests unitaires Vitest.
 *
 * Stratégie de mock :
 *   Cloudflare D1Database n'est pas disponible en dehors du runtime Workers.
 *   Ce helper crée un faux D1Database en mémoire (Map) qui reproduit
 *   l'interface `.prepare().bind().first<T>()` et `.prepare().bind().all<T>()`
 *   et `.prepare().bind().run()`.
 *
 * Utilisation :
 * ```ts
 * const db = createMockD1()
 *
 * // Enregistrer une réponse pour une requête SQL précise
 * db.__setResponse('SELECT id FROM users WHERE email = ?', { id: 42 })
 *
 * // Enregistrer une liste (pour .all())
 * db.__setListResponse('SELECT * FROM boutiques WHERE actif = 1 ORDER BY nom', [
 *   { id: 1, nom: 'Paris' },
 *   { id: 2, nom: 'Lyon' }
 * ])
 *
 * // Utiliser dans le service
 * const user = await findUserByEmail(db, 'test@test.com')
 * ```
 *
 * Limitations :
 *   - Le matching est fait sur le SQL normalisé (trim + collapse spaces)
 *   - Les paramètres `.bind()` ne sont pas utilisés pour le matching
 *     (les réponses sont enregistrées par SQL uniquement)
 *   - Pour tester des comportements avec des paramètres différents sur le même SQL,
 *     utiliser `.__setResponseFn()` avec une fonction de callback
 */

import { vi } from 'vitest'

/** Résultat d'une requête `.run()` (D1Result) */
export interface MockD1Result {
  success: boolean
  meta: { last_row_id: number; changes: number }
  results: any[]
}

/**
 * Normalise une requête SQL pour le matching :
 * trim + collapse espaces/newlines → une seule espace entre tokens.
 */
function normalizeSQL(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

/**
 * Crée un mock D1Database en mémoire.
 * L'objet retourné expose `.prepare()` (interface D1) + `.__set*()` (API test).
 */
export function createMockD1() {
  // Stockage des réponses : SQL normalisé → valeur
  const singleResponses  = new Map<string, any>()
  const listResponses    = new Map<string, any[]>()
  const responseFns      = new Map<string, (params: any[]) => any>()
  const listFns          = new Map<string, (params: any[]) => any[]>()

  // Tracker des appels pour assertions
  const calls: Array<{ sql: string; params: any[] }> = []

  /** Enregistre une réponse pour `.first<T>()` */
  function __setResponse(sql: string, value: any) {
    singleResponses.set(normalizeSQL(sql), value)
  }

  /** Enregistre une réponse null pour `.first<T>()` (simule "not found") */
  function __setNotFound(sql: string) {
    singleResponses.set(normalizeSQL(sql), null)
  }

  /** Enregistre une liste pour `.all<T>()` */
  function __setListResponse(sql: string, values: any[]) {
    listResponses.set(normalizeSQL(sql), values)
  }

  /** Enregistre une fonction callback pour `.first<T>()` — accès aux params */
  function __setResponseFn(sql: string, fn: (params: any[]) => any) {
    responseFns.set(normalizeSQL(sql), fn)
  }

  /** Enregistre une fonction callback pour `.all<T>()` — accès aux params */
  function __setListFn(sql: string, fn: (params: any[]) => any[]) {
    listFns.set(normalizeSQL(sql), fn)
  }

  /** Retourne tous les appels SQL enregistrés (pour assertion) */
  function __getCalls() {
    return [...calls]
  }

  /** Efface tous les appels enregistrés */
  function __resetCalls() {
    calls.length = 0
  }

  /** Efface toutes les réponses enregistrées */
  function __reset() {
    singleResponses.clear()
    listResponses.clear()
    responseFns.clear()
    listFns.clear()
    calls.length = 0
  }

  // Implémentation de l'interface D1Database
  const db = {
    prepare(sql: string) {
      const normalSql = normalizeSQL(sql)
      const boundParams: any[] = []

      const stmt = {
        bind(...params: any[]) {
          boundParams.push(...params)
          return stmt
        },

        async first<T>(): Promise<T | null> {
          calls.push({ sql: normalSql, params: [...boundParams] })

          // Callback fn prioritaire
          const fn = responseFns.get(normalSql)
          if (fn) return fn(boundParams) as T | null

          // Valeur statique
          if (singleResponses.has(normalSql)) {
            return singleResponses.get(normalSql) as T | null
          }

          // Par défaut : null (not found)
          return null
        },

        async all<T>(): Promise<{ results: T[] }> {
          calls.push({ sql: normalSql, params: [...boundParams] })

          // Callback fn prioritaire
          const fn = listFns.get(normalSql)
          if (fn) return { results: fn(boundParams) as T[] }

          // Valeur statique
          if (listResponses.has(normalSql)) {
            return { results: listResponses.get(normalSql) as T[] }
          }

          // Par défaut : liste vide
          return { results: [] }
        },

        async run(): Promise<MockD1Result> {
          calls.push({ sql: normalSql, params: [...boundParams] })

          // Réponse statique si fournie (ex: RETURNING id)
          const fn = responseFns.get(normalSql)
          if (fn) {
            const res = fn(boundParams)
            return {
              success: true,
              meta: { last_row_id: res?.id ?? 1, changes: 1 },
              results: res ? [res] : [],
            }
          }

          return {
            success: true,
            meta: { last_row_id: 1, changes: 1 },
            results: [],
          }
        },
      }

      return stmt
    },

    // API de test (préfixe __ pour distinguer de l'interface D1)
    __setResponse,
    __setNotFound,
    __setListResponse,
    __setResponseFn,
    __setListFn,
    __getCalls,
    __resetCalls,
    __reset,

    // Méthodes D1 non utilisées dans les services (stub no-op)
    dump:  vi.fn(),
    batch: vi.fn().mockResolvedValue([]),
    exec:  vi.fn().mockResolvedValue({ count: 0, duration: 0 }),
  }

  return db as unknown as D1Database & {
    __setResponse: typeof __setResponse
    __setNotFound: typeof __setNotFound
    __setListResponse: typeof __setListResponse
    __setResponseFn: typeof __setResponseFn
    __setListFn: typeof __setListFn
    __getCalls: typeof __getCalls
    __resetCalls: typeof __resetCalls
    __reset: typeof __reset
  }
}
