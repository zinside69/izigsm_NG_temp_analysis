import { describe, it, expect, beforeEach } from 'vitest'
// @ts-ignore node:sqlite types not available without @types/node — moteur SQLite intégré à Node 24
import { DatabaseSync } from 'node:sqlite'
import type { Database } from '../src/ports/database'
import {
  createService, updateService, poserCodeMaisonService,
  ErreurServiceCodeEnDoublon, ErreurServiceDejaCode,
} from '../src/services/servicesService'
import { codeMaison, estEan13Valide } from '../src/lib/codeMaison'

/**
 * @file tests/services-code-maison-sqlite.test.ts
 * @description Code-barres / code maison des services (ticket 05 `vente-lit-catalogue`).
 *
 * La migration `0052_services_code_barre.sql` (colonne `services.code_barre` + index unique
 * partiel `(boutique_id, code_barre)`, patron de `0048`) ne peut pas être écrite par cet agent —
 * `migrations/**` est un fichier critique au sens de l'ADR 0002 (orchestrateur du socle), même
 * listée dans le périmètre de la tâche. Elle est soumise en demande d'écriture (diff exact dans le
 * compte rendu) ; même précédent que `migrations/0050_produits_mobilax_id.sql` au ticket 18
 * (`tests/stock-import-deja-en-stock.test.ts`).
 *
 * En attendant, ce fichier rejoue EXACTEMENT le contenu demandé sur un schéma autonome (comme
 * `tests/catalogue-scan-sqlite.test.ts`, indépendant de `migrations/`) : contre un VRAI moteur
 * SQLite (`node:sqlite`), jamais un mock, pour que la règle d'unicité et les écritures
 * conditionnelles soient réellement exercées (`CLAUDE.md` § Bons de commande).
 */

const SCHEMA = `
  CREATE TABLE services (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    boutique_id     INTEGER NOT NULL,
    categorie_id    INTEGER,
    nom             TEXT    NOT NULL,
    description     TEXT,
    prix_ht         REAL    NOT NULL DEFAULT 0,
    tva_taux        REAL    NOT NULL DEFAULT 20,
    duree_minutes   INTEGER,
    reference       TEXT,
    garantie_jours  INTEGER DEFAULT 0,
    code_barre      TEXT,
    actif           INTEGER NOT NULL DEFAULT 1,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX idx_services_code_barre_unique
    ON services(boutique_id, code_barre)
    WHERE actif = 1 AND code_barre IS NOT NULL AND TRIM(code_barre) <> '';
  CREATE TABLE audit_logs (
    id BLOB
  );
`

let sqlite: any
let db: Database

function portSur(base: any): Database {
  return {
    async all<T>(sql: string, params: unknown[] = []) { return base.prepare(sql).all(...params) as T[] },
    async get<T>(sql: string, params: unknown[] = []) { return (base.prepare(sql).get(...params) ?? null) as T | null },
    async run(sql: string, params: unknown[] = []) {
      const r = base.prepare(sql).run(...params)
      return { id: Number(r.lastInsertRowid), changes: Number(r.changes) }
    },
  }
}

/** `createService`/`updateService` appellent `auditLog()` sur un binding D1 brut : stub minimal. */
function d1Brut(base: any): D1Database {
  return {
    prepare(sql: string) {
      const params: unknown[] = []
      const stmt = {
        bind(...args: unknown[]) { params.push(...args); return stmt },
        first: async <T>() => (base.prepare(sql).get(...params) ?? null) as T | null,
        run: async () => {
          const r = base.prepare(sql).run(...params)
          return { success: true, results: [], meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }
        },
        all: async () => ({ results: base.prepare(sql).all(...params) }),
      }
      return stmt
    },
  } as unknown as D1Database
}

function service(p: Partial<{ boutique_id: number; nom: string; code_barre: string | null; actif: number }>): number {
  const v = { boutique_id: 1, nom: 'Service', code_barre: null, actif: 1, ...p }
  return Number(sqlite.prepare(
    'INSERT INTO services (boutique_id, nom, code_barre, actif) VALUES (?, ?, ?, ?)',
  ).run(v.boutique_id, v.nom, v.code_barre, v.actif).lastInsertRowid)
}

function codeBarreDe(id: number): string | null {
  return (sqlite.prepare('SELECT code_barre FROM services WHERE id = ?').get(id) as any).code_barre
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(SCHEMA)
  db = portSur(sqlite)
})

// ─── Index unique (équivalent du contenu demandé pour la migration 0052) ───────

describe('services.code_barre — unicité par boutique (contenu demandé pour 0052)', () => {
  it('refuse un second service actif au même code-barres dans la même boutique', () => {
    service({ nom: 'Pose de film', code_barre: 'ABC' })
    expect(() => service({ nom: 'Doublon', code_barre: 'ABC' })).toThrow(/UNIQUE constraint failed/)
  })

  it('laisse passer deux services sans code-barres', () => {
    service({ code_barre: null })
    expect(() => service({ code_barre: null })).not.toThrow()
  })

  it('laisse passer un code déjà porté par un service inactif', () => {
    service({ code_barre: 'ABC', actif: 0 })
    expect(() => service({ code_barre: 'ABC' })).not.toThrow()
  })

  it('laisse deux boutiques porter le même code', () => {
    service({ boutique_id: 1, code_barre: 'ABC' })
    expect(() => service({ boutique_id: 2, code_barre: 'ABC' })).not.toThrow()
  })
})

// ─── poserCodeMaisonService() ───────────────────────────────────────────────────

describe('poserCodeMaisonService()', () => {
  it('pose un code maison (préfixe 22, EAN-13 valide) sur un service sans code', async () => {
    const id = service({ nom: 'Pose de film' })
    const { code } = await poserCodeMaisonService(db, 1, id)
    expect(code).toBe(codeMaison(2, id))
    expect(code.startsWith('22')).toBe(true)
    expect(estEan13Valide(code)).toBe(true)
    expect(codeBarreDe(id)).toBe(code)
  })

  it('refuse un service qui a déjà un code-barres (ErreurServiceDejaCode)', async () => {
    const id = service({ code_barre: 'DEJA' })
    await expect(poserCodeMaisonService(db, 1, id)).rejects.toBeInstanceOf(ErreurServiceDejaCode)
    expect(codeBarreDe(id)).toBe('DEJA') // inchangé
  })

  it('service introuvable (autre boutique) → Error dédiée', async () => {
    const id = service({ boutique_id: 2 })
    await expect(poserCodeMaisonService(db, 1, id)).rejects.toThrow('Service introuvable.')
  })

  it('collision avec un autre service porteur du même code calculé → ErreurServiceCodeEnDoublon nommant le porteur', async () => {
    const id = service({ nom: 'Cible' })
    service({ nom: 'Porteur existant', code_barre: codeMaison(2, id) })

    const err = await poserCodeMaisonService(db, 1, id).catch(e => e)
    expect(err).toBeInstanceOf(ErreurServiceCodeEnDoublon)
    expect(err.service.nom).toBe('Porteur existant')
    expect(codeBarreDe(id)).toBeNull() // pas posé
  })

  // ─── Mutation (ADR 0003) ────────────────────────────────────────────────────
  // Mutant : dans `poserCodeMaisonService()` (src/services/servicesService.ts), retirer la
  // condition `AND (code_barre IS NULL OR TRIM(code_barre) = '')` du `WHERE` de l'UPDATE, SANS
  // retirer le refus `ErreurServiceDejaCode` en amont. Comme pour les produits, les deux gardes
  // sont redondants pour cet appelant (le refus amont empêche déjà d'atteindre l'UPDATE) : seul un
  // appel direct à une fonction interne sans ce refus exercerait la différence — non applicable
  // ici (`poserCodeMaisonService()` est la seule porte d'entrée). Non reproduit : voir équivalent
  // produit (`tests/produit-code-maison-sqlite.test.ts`) pour la preuve par mutation combinée.
})

// ─── createService() / updateService() — doublon de code-barres ───────────────

describe('createService() — doublon de code-barres', () => {
  it('crée un service avec un code-barres libre', async () => {
    const id = await createService(d1Brut(sqlite), { boutique_id: 1, nom: 'Pose de film', prix_ht: 10, code_barre: 'ABC' }, 1)
    expect(codeBarreDe(id)).toBe('ABC')
  })

  it('refuse un code-barres déjà porté, en nommant le service existant', async () => {
    await createService(d1Brut(sqlite), { boutique_id: 1, nom: 'Premier', prix_ht: 10, code_barre: 'ABC' }, 1)

    const err = await createService(d1Brut(sqlite), { boutique_id: 1, nom: 'Doublon', prix_ht: 10, code_barre: 'ABC' }, 1).catch(e => e)
    expect(err).toBeInstanceOf(ErreurServiceCodeEnDoublon)
    expect(err.service.nom).toBe('Premier')
    expect(err.message).toContain('Premier')
  })

  it('aucun code maison automatique à la création (spec : génération à la demande seulement)', async () => {
    const id = await createService(d1Brut(sqlite), { boutique_id: 1, nom: 'Sans code', prix_ht: 10 }, 1)
    expect(codeBarreDe(id)).toBeNull()
  })
})

describe('updateService() — doublon de code-barres', () => {
  it('pose un code-barres sur un service qui n\'en avait pas', async () => {
    const id = service({ nom: 'Cible' })
    await updateService(d1Brut(sqlite), id, { code_barre: 'NOUVEAU' }, 1)
    expect(codeBarreDe(id)).toBe('NOUVEAU')
  })

  it('refuse de donner à un service le code-barres d\'un autre, en le nommant', async () => {
    service({ nom: 'Porteur', code_barre: 'ABC' })
    const cible = service({ nom: 'Cible' })

    const err = await updateService(d1Brut(sqlite), cible, { code_barre: 'ABC' }, 1).catch(e => e)
    expect(err).toBeInstanceOf(ErreurServiceCodeEnDoublon)
    expect(err.service.nom).toBe('Porteur')
    expect(codeBarreDe(cible)).toBeNull() // inchangé
  })

  it('code_barre absent du corps → inchangé (COALESCE)', async () => {
    const id = service({ nom: 'A', code_barre: 'GARDE' })
    await updateService(d1Brut(sqlite), id, { nom: 'A renommé' }, 1)
    expect(codeBarreDe(id)).toBe('GARDE')
  })
})
