import { describe, it, expect, beforeEach } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
// @ts-ignore node:sqlite types not available without @types/node — moteur SQLite intégré à Node 24
import { DatabaseSync } from 'node:sqlite'

/**
 * Migration 0054 — IMEI du produit et instantané des appareils vendus (ticket 07 du chantier
 * `vente-lit-catalogue`) : `produits.imei` avec un index unique partiel par boutique sur les
 * produits actifs (patron de 0048), et `factures.appareils_snapshot`.
 *
 * Testé contre un VRAI moteur SQLite (`node:sqlite`) : un index unique partiel ne se simule pas.
 * Même patron que `produits-unicite-codes-migration.test.ts` (0048).
 */

// @ts-ignore process types not available without @types/node
const MIGRATION = join(process.cwd(), 'migrations', '0054_produits_imei_factures_appareils.sql')

const IMEI = '356938035643809'

/** Colonnes lues par la migration (schéma réel : 0005_stocks.sql, 0006_facturation.sql). */
const SCHEMA = `
  CREATE TABLE produits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    boutique_id INTEGER NOT NULL,
    nom         TEXT    NOT NULL,
    actif       INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE factures (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    boutique_id INTEGER NOT NULL,
    numero      TEXT,
    locked      INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO factures (boutique_id, numero, locked) VALUES (1, 'FAC-2026-00001', 1);
`

let db: any
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(SCHEMA)
  db.exec(readFileSync(MIGRATION, 'utf8'))
})

function produit(p: { boutique?: number; imei?: string | null; actif?: number }) {
  db.prepare('INSERT INTO produits (boutique_id, nom, imei, actif) VALUES (?, ?, ?, ?)').run(
    p.boutique ?? 1, 'iPhone 12 occasion', p.imei ?? null, p.actif ?? 1,
  )
}

describe('0054 — IMEI du produit', () => {
  it('refuse un second produit actif au même IMEI dans la même boutique', () => {
    produit({ imei: IMEI })
    expect(() => produit({ imei: IMEI })).toThrow(/UNIQUE constraint failed: produits\.boutique_id, produits\.imei/)
  })

  it('admet le même IMEI dans deux boutiques', () => {
    produit({ boutique: 1, imei: IMEI })
    expect(() => produit({ boutique: 2, imei: IMEI })).not.toThrow()
  })

  it('admet le même IMEI si l\'un des produits est inactif', () => {
    produit({ imei: IMEI, actif: 0 })
    expect(() => produit({ imei: IMEI })).not.toThrow()
  })

  it('admet plusieurs produits sans IMEI (NULL ou vide)', () => {
    produit({})
    produit({})
    expect(() => produit({ imei: '' })).not.toThrow()
    expect(() => produit({ imei: '  ' })).not.toThrow()
  })
})

describe('0054 — instantané des appareils sur la facture', () => {
  it('ajoute la colonne, nulle sur les factures existantes, qui restent intactes', () => {
    const f = db.prepare('SELECT numero, locked, appareils_snapshot FROM factures WHERE id = 1').get()
    expect(f).toEqual({ numero: 'FAC-2026-00001', locked: 1, appareils_snapshot: null })
  })
})
