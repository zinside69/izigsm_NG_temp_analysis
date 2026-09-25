import { describe, it, expect, beforeEach } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
// @ts-ignore node:sqlite types not available without @types/node — moteur SQLite intégré à Node 24
import { DatabaseSync } from 'node:sqlite'

/**
 * Migration 0050 — `produits.mobilax_id` : une pièce Mobilax reconnue sans rappeler le
 * fournisseur (ticket 18 du chantier `vente-lit-catalogue`, point 4 de la relecture du 2026-09-24).
 *
 * Testé contre un VRAI moteur SQLite (`node:sqlite`) : un `ALTER TABLE` et un index unique partiel
 * ne se simulent pas. Joué **avec** et **sans** la migration, pour que ce soit elle qui produise la
 * colonne et le refus.
 */

// @ts-ignore process types not available without @types/node
const MIGRATION = join(process.cwd(), 'migrations', '0050_produits_mobilax_id.sql')

/** Colonnes de `produits` que 0050 touche ou que son index lit (schéma réel : 0005_stocks.sql). */
const SCHEMA_PRODUITS = `
  CREATE TABLE produits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    boutique_id INTEGER NOT NULL,
    nom         TEXT    NOT NULL,
    actif       INTEGER NOT NULL DEFAULT 1
  )`

function base(avecMigration: boolean): any {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_PRODUITS)
  db.prepare(`INSERT INTO produits (boutique_id, nom) VALUES (1, 'Produit existant')`).run()
  if (avecMigration) db.exec(readFileSync(MIGRATION, 'utf8'))
  return db
}

function inserer(db: any, p: { boutique?: number; mobilax_id?: number | null; actif?: number }) {
  db.prepare('INSERT INTO produits (boutique_id, nom, mobilax_id, actif) VALUES (?, ?, ?, ?)').run(
    p.boutique ?? 1, 'Pièce', p.mobilax_id ?? null, p.actif ?? 1,
  )
}

describe('0050 — identifiant Mobilax sur les produits', () => {
  it('témoin : sans la migration, la colonne n\'existe pas', () => {
    expect(() => inserer(base(false), { mobilax_id: 17 })).toThrow(/mobilax_id/)
  })

  describe('avec la migration', () => {
    let db: any
    beforeEach(() => { db = base(true) })

    it('les produits existants sont conservés, sans identifiant (aucune reprise)', () => {
      expect(db.prepare(`SELECT nom, mobilax_id FROM produits WHERE id = 1`).get())
        .toEqual({ nom: 'Produit existant', mobilax_id: null })
    })

    it('refuse une même pièce Mobilax sur deux produits actifs de la même boutique', () => {
      inserer(db, { mobilax_id: 17 })
      expect(() => inserer(db, { mobilax_id: 17 })).toThrow(/UNIQUE constraint failed/)
    })

    it('nomme les colonnes que rattacherProduitMobilax() reconnaît (point 2 de la relecture)', () => {
      // Le rattrapage de la course se fonde sur CE message : s'il changeait, la course remonterait
      // en erreur au lieu d'être reconnue — ce test le dirait avant la production.
      inserer(db, { mobilax_id: 17 })
      expect(() => inserer(db, { mobilax_id: 17 }))
        .toThrow(/UNIQUE constraint failed: produits\.boutique_id, produits\.mobilax_id\b/)
    })

    it('la même pièce reste importable par une autre boutique', () => {
      inserer(db, { boutique: 1, mobilax_id: 17 })
      expect(() => inserer(db, { boutique: 2, mobilax_id: 17 })).not.toThrow()
    })

    it('un produit supprimé (actif = 0) ne bloque pas une réimportation', () => {
      inserer(db, { mobilax_id: 17, actif: 0 })
      expect(() => inserer(db, { mobilax_id: 17 })).not.toThrow()
    })

    it('plusieurs produits sans identifiant coexistent', () => {
      inserer(db, { mobilax_id: null })
      expect(() => inserer(db, { mobilax_id: null })).not.toThrow()
    })
  })
})
