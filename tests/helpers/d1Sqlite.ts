/**
 * @file tests/helpers/d1Sqlite.ts
 * @description Une vraie base SQLite en mémoire, au **schéma réel** (toutes les migrations du
 * dépôt appliquées dans l'ordre), exposée sous l'interface `D1Database` que prennent les services
 * écrits pour D1 brut (`createProduit()`, `createVente()`…).
 *
 * Pourquoi : une règle portée par le SQL ou par l'ordre des écritures (figeage NF525, index
 * uniques) ne se prouve pas contre `createMockD1`, qui rend ce qu'on lui configure quelle que soit
 * la requête (`CLAUDE.md` § Bons de commande). Les tests SQLite existants écrivent un schéma à la
 * main ; ce helper rejoue les vraies migrations, pour tester contre le schéma de production.
 *
 * Ne couvre que ce que les services emploient : `prepare().bind().first()/run()/all()`, `batch()`,
 * `exec()`.
 */
// @ts-ignore node:fs types not available without @types/node
import { readFileSync, readdirSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
// @ts-ignore node:sqlite types not available without @types/node — moteur SQLite intégré à Node 24
import { DatabaseSync } from 'node:sqlite'

/** Base SQLite en mémoire au schéma réel, et son interface D1. */
export interface BaseReelle {
  /** Accès direct au moteur, pour préparer des données et relire sans passer par un service. */
  sqlite: any
  /** Interface D1 attendue par les services. */
  d1:     D1Database
}

/**
 * Crée une base en mémoire et y applique `migrations/*.sql` par ordre de nom.
 * @param jusqua Nom de fichier (exclu) où s'arrêter — pour tester une migration isolément
 */
export function baseAuSchemaReel(jusqua?: string): BaseReelle {
  const sqlite = new DatabaseSync(':memory:')
  // @ts-ignore process types not available without @types/node
  const dossier = join(process.cwd(), 'migrations')
  const fichiers = (readdirSync(dossier) as string[]).filter(f => f.endsWith('.sql')).sort()
  for (const f of fichiers) {
    if (jusqua && f >= jusqua) break
    sqlite.exec(readFileSync(join(dossier, f), 'utf8'))
  }
  return { sqlite, d1: versD1(sqlite) }
}

/** Valeurs acceptées par `node:sqlite` : un booléen ou `undefined` doivent être convertis. */
function normaliser(v: unknown): unknown {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  return v
}

function versD1(sqlite: any): D1Database {
  function preparer(sql: string, params: unknown[] = []): any {
    return {
      bind(...args: unknown[]) { return preparer(sql, args) },
      async first<T>(colonne?: string) {
        const ligne = sqlite.prepare(sql).get(...params.map(normaliser)) ?? null
        if (ligne && colonne) return (ligne as any)[colonne] as T
        return ligne as T | null
      },
      async all<T>() {
        return { results: sqlite.prepare(sql).all(...params.map(normaliser)) as T[], success: true, meta: {} }
      },
      async run() {
        const r = sqlite.prepare(sql).run(...params.map(normaliser))
        return { success: true, results: [], meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }
      },
      async raw() { return sqlite.prepare(sql).all(...params.map(normaliser)).map((l: any) => Object.values(l)) },
    }
  }
  return {
    prepare: (sql: string) => preparer(sql),
    async batch(instructions: any[]) {
      // D1 exécute un lot dans une transaction : un échec annule tout le lot
      sqlite.exec('BEGIN')
      try {
        const res = []
        for (const i of instructions) res.push(await i.run())
        sqlite.exec('COMMIT')
        return res
      } catch (e) {
        sqlite.exec('ROLLBACK')
        throw e
      }
    },
    async exec(sql: string) { sqlite.exec(sql); return { count: 0, duration: 0 } },
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database
}
