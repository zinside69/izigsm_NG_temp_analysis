import { describe, it, expect, beforeEach } from 'vitest'
// @ts-ignore node:sqlite types not available without @types/node — moteur SQLite intégré à Node 24
import { DatabaseSync } from 'node:sqlite'
import type { Database } from '../src/ports/database'
import { rechercherParCode } from '../src/services/catalogueService'

/**
 * Recherche par code scanné (ticket 04 `vente-lit-catalogue`, décision de l'exploitant du
 * 2026-09-30) : un scan de 13 chiffres cherche par **égalité stricte** sur le code-barres **ou** le
 * SKU — la fiche produit n'a pas de champ code-barres, l'EAN y est tapé comme SKU. Jamais par le
 * `LIKE %…%` de la recherche texte : un SKU qui *contient* les chiffres ne doit pas remonter.
 *
 * La règle vit dans le `WHERE` : testée contre un VRAI moteur SQLite (`node:sqlite`), deux
 * boutiques — un mock accepterait n'importe quelle requête (`CLAUDE.md`, § Bons de commande).
 */

const SCHEMA = `
  CREATE TABLE produits (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    boutique_id    INTEGER NOT NULL,
    nom            TEXT    NOT NULL,
    sku            TEXT,
    code_barre     TEXT,
    prix_vente_ht  REAL    NOT NULL DEFAULT 0,
    tva_taux       REAL    NOT NULL DEFAULT 20,
    stock_actuel   INTEGER NOT NULL DEFAULT 0,
    actif          INTEGER NOT NULL DEFAULT 1
  );
  -- Lues par la sous-requête du dernier prix vendu (recette 002 D, 2026-10-03), vides ici
  CREATE TABLE factures (id INTEGER PRIMARY KEY, boutique_id INTEGER, locked INTEGER, statut TEXT, issued_at TEXT);
  CREATE TABLE lignes_document (id INTEGER PRIMARY KEY, document_type TEXT, document_id INTEGER, produit_id INTEGER, prix_unitaire_ht REAL);
`

const EAN = '3760123456789'

let sqlite: any
let db: Database

/** Port `Database` au-dessus du SQLite réel — même adaptateur que les autres tests SQLite du dépôt. */
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

function produit(p: Partial<{ boutique_id: number; nom: string; sku: string | null; code_barre: string | null; actif: number }>): number {
  const v = { boutique_id: 1, nom: 'Produit', sku: null, code_barre: null, actif: 1, ...p }
  return Number(sqlite.prepare(
    'INSERT INTO produits (boutique_id, nom, sku, code_barre, actif) VALUES (?, ?, ?, ?, ?)',
  ).run(v.boutique_id, v.nom, v.sku, v.code_barre, v.actif).lastInsertRowid)
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(SCHEMA)
  db = portSur(sqlite)
})

describe('rechercherParCode() — égalité stricte sur code-barres ou SKU', () => {
  it('trouve un produit par son code-barres', async () => {
    const id = produit({ nom: 'Coque', code_barre: EAN })
    const res = await rechercherParCode(db, 1, EAN)
    expect(res.map(r => r.id)).toEqual([id])
    expect(res[0].type).toBe('produit')
  })

  it('trouve un produit dont l\'EAN est tapé comme SKU', async () => {
    const id = produit({ nom: 'Verre trempé', sku: EAN })
    expect((await rechercherParCode(db, 1, EAN)).map(r => r.id)).toEqual([id])
  })

  it('ne trouve PAS un produit dont le SKU ou le code ne fait que contenir les chiffres', async () => {
    produit({ nom: 'Contient dans le SKU', sku: `X${EAN}` })
    produit({ nom: 'Contient dans le code', code_barre: `${EAN}0` })
    produit({ nom: 'Porte les chiffres dans son nom ' + EAN })
    expect(await rechercherParCode(db, 1, EAN)).toEqual([])
  })

  it('ignore un produit inactif', async () => {
    produit({ code_barre: EAN, actif: 0 })
    expect(await rechercherParCode(db, 1, EAN)).toEqual([])
  })

  it('ne lit jamais une autre boutique', async () => {
    produit({ boutique_id: 2, code_barre: EAN })
    expect(await rechercherParCode(db, 1, EAN)).toEqual([])
  })

  it('rend les deux produits quand l\'EAN de l\'un est le SKU de l\'autre — aucun choix', async () => {
    const a = produit({ nom: 'Coque noire', code_barre: EAN })
    const b = produit({ nom: 'Coque bleue', sku: EAN })
    expect((await rechercherParCode(db, 1, EAN)).map(r => r.id).sort()).toEqual([a, b].sort())
  })
})
