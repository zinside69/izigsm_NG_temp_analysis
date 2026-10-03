/**
 * @file tests/helpers/mockDatabase.ts
 * @description Mock du port Database pour les tests unitaires Vitest.
 * Même style que tests/helpers/mockD1.ts (matching sur SQL normalisé),
 * adapté à l'API plate all()/get()/run() du port Database.
 */
import type { Database } from '../../src/ports/database'

/**
 * Normalise une requête SQL pour le matching :
 * trim + collapse espaces/newlines → une seule espace entre tokens.
 */
function normalizeSQL(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

/**
 * Crée un mock Database en mémoire.
 * L'objet retourné expose `.all()`, `.get()`, `.run()` (interface Database) + `.__set*()` (API test).
 */
export function createMockDatabase() {
  const singleResponses = new Map<string, any>()
  const listResponses   = new Map<string, any[]>()
  const responseFns     = new Map<string, (params: unknown[]) => any>()
  const listFns         = new Map<string, (params: unknown[]) => any[]>()
  const calls: Array<{ sql: string; params: unknown[] }> = []

  /** Enregistre une réponse pour `.get<T>()` */
  function __setResponse(sql: string, value: any) {
    singleResponses.set(normalizeSQL(sql), value)
  }

  /** Enregistre une réponse null pour `.get<T>()` (simule "not found") */
  function __setNotFound(sql: string) {
    singleResponses.set(normalizeSQL(sql), null)
  }

  /** Enregistre une liste pour `.all<T>()` */
  function __setListResponse(sql: string, values: any[]) {
    listResponses.set(normalizeSQL(sql), values)
  }

  /** Enregistre une fonction callback pour `.get<T>()` / `.run()` — accès aux params */
  function __setResponseFn(sql: string, fn: (params: unknown[]) => any) {
    responseFns.set(normalizeSQL(sql), fn)
  }

  /** Enregistre une fonction callback pour `.all<T>()` — accès aux params */
  function __setListFn(sql: string, fn: (params: unknown[]) => any[]) {
    listFns.set(normalizeSQL(sql), fn)
  }

  /** Retourne tous les appels SQL enregistrés (pour assertion) */
  function __getCalls() {
    return [...calls]
  }

  const db: Database = {
    async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const normalSql = normalizeSQL(sql)
      calls.push({ sql: normalSql, params: [...params] })

      const fn = listFns.get(normalSql)
      if (fn) return fn(params) as T[]

      return (listResponses.get(normalSql) as T[]) ?? []
    },

    async get<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const normalSql = normalizeSQL(sql)
      calls.push({ sql: normalSql, params: [...params] })

      const fn = responseFns.get(normalSql)
      if (fn) return (fn(params) as T) ?? null

      if (singleResponses.has(normalSql)) {
        return singleResponses.get(normalSql) as T | null
      }
      return null
    },

    async run(sql: string, params: unknown[] = []): Promise<{ id: number | null; changes: number }> {
      const normalSql = normalizeSQL(sql)
      calls.push({ sql: normalSql, params: [...params] })

      const fn = responseFns.get(normalSql)
      if (fn) {
        const res = fn(params)
        return { id: res?.id ?? null, changes: 1 }
      }
      return { id: null, changes: 1 }
    },

    /**
     * Lot `batch()` (ajouté au port le 2026-10-03) : chaque requête est consignée comme un appel,
     * et rend la réponse configurée pour son SQL (`__setResponse` / `__setResponseFn`) dans une
     * liste d'une ligne — ou une liste vide si rien n'est configuré. Aucune transaction simulée :
     * le « tout ou rien » se prouve contre un vrai SQLite (`cloture-atomique-sqlite.test.ts`).
     */
    async batch(requetes: { sql: string; params?: unknown[] }[]): Promise<unknown[][]> {
      const lignesParRequete: unknown[][] = []
      for (const requete of requetes) {
        const params = requete.params ?? []
        const normalSql = normalizeSQL(requete.sql)
        calls.push({ sql: normalSql, params: [...params] })

        const fn = responseFns.get(normalSql)
        const reponse = fn ? fn(params) : singleResponses.get(normalSql)
        lignesParRequete.push(reponse ? [reponse] : [])
      }
      return lignesParRequete
    },
  }

  return Object.assign(db, {
    __setResponse,
    __setNotFound,
    __setListResponse,
    __setResponseFn,
    __setListFn,
    __getCalls,
  })
}
