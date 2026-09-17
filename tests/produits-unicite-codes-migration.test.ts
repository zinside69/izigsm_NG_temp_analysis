import { describe, it, expect, beforeEach } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
// @ts-ignore node:sqlite types not available without @types/node — moteur SQLite intégré à Node 24
import { DatabaseSync } from 'node:sqlite'

/**
 * Migration 0048 — un code-barres, un produit ; un SKU, un produit (ticket 01 du chantier
 * `vente-lit-catalogue`, `CONTEXT.md` § Code-barres, SKU).
 *
 * Testé contre un VRAI moteur SQLite (`node:sqlite`), jamais un mock : un index unique partiel
 * ne se simule pas. Chaque cas est joué **avec** et **sans** la migration — un test qui ne
 * verrait que le refus ne dirait pas que c'est la migration qui le produit.
 */

// @ts-ignore process types not available without @types/node
const MIGRATION = join(process.cwd(), 'migrations', '0048_produits_ean_sku_unique.sql')

/** Colonnes de `produits` que les index de 0048 lisent (schéma réel : 0005_stocks.sql). */
const SCHEMA_PRODUITS = `
  CREATE TABLE produits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    boutique_id INTEGER NOT NULL,
    nom         TEXT    NOT NULL,
    sku         TEXT,
    code_barre  TEXT,
    actif       INTEGER NOT NULL DEFAULT 1
  )`

function base(avecMigration: boolean): any {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_PRODUITS)
  if (avecMigration) db.exec(readFileSync(MIGRATION, 'utf8'))
  return db
}

function inserer(db: any, p: { boutique?: number; nom?: string; sku?: string | null; code_barre?: string | null; actif?: number }) {
  db.prepare('INSERT INTO produits (boutique_id, nom, sku, code_barre, actif) VALUES (?, ?, ?, ?, ?)').run(
    p.boutique ?? 1, p.nom ?? 'Produit', p.sku ?? null, p.code_barre ?? null, p.actif ?? 1,
  )
}

describe('0048 — unicité du code-barres et du SKU par boutique', () => {
  describe('témoin : sans la migration, rien n\'est refusé', () => {
    let db: any
    beforeEach(() => { db = base(false) })

    it('accepte deux produits actifs au même code-barres', () => {
      inserer(db, { code_barre: '3700275472140' })
      expect(() => inserer(db, { code_barre: '3700275472140' })).not.toThrow()
    })
  })

  describe('avec la migration', () => {
    let db: any
    beforeEach(() => { db = base(true) })

    it('refuse un second produit actif au même code-barres dans la même boutique', () => {
      inserer(db, { nom: 'Coque silicone', code_barre: '3700275472140' })
      expect(() => inserer(db, { nom: 'Doublon', code_barre: '3700275472140' }))
        .toThrow(/UNIQUE constraint failed/)
    })

    it('refuse un second produit actif au même SKU dans la même boutique', () => {
      inserer(db, { sku: 'COQ-IP12' })
      expect(() => inserer(db, { sku: 'COQ-IP12' })).toThrow(/UNIQUE constraint failed/)
    })

    it('laisse passer deux produits sans code-barres ni SKU', () => {
      inserer(db, { code_barre: null, sku: null })
      expect(() => inserer(db, { code_barre: null, sku: null })).not.toThrow()
    })

    it('laisse passer deux produits dont le code est vide ou blanc', () => {
      inserer(db, { code_barre: '', sku: '  ' })
      expect(() => inserer(db, { code_barre: '', sku: '  ' })).not.toThrow()
    })

    it('laisse passer un code déjà porté par un produit inactif (supprimé)', () => {
      inserer(db, { code_barre: '3700275472140', sku: 'COQ-IP12', actif: 0 })
      expect(() => inserer(db, { code_barre: '3700275472140', sku: 'COQ-IP12' })).not.toThrow()
    })

    it('laisse deux boutiques vendre le même article', () => {
      inserer(db, { boutique: 1, code_barre: '3700275472140', sku: 'COQ-IP12' })
      expect(() => inserer(db, { boutique: 2, code_barre: '3700275472140', sku: 'COQ-IP12' })).not.toThrow()
    })

    it('nomme les colonnes en cause dans le message d\'erreur', () => {
      // Fait sur lequel s'appuie la conversion en message lisible : SQLite cite les colonnes de
      // l'index violé, ce qui distingue un doublon de code-barres d'un doublon de SKU.
      inserer(db, { code_barre: '3700275472140', sku: 'A' })
      expect(() => inserer(db, { code_barre: '3700275472140', sku: 'B' }))
        .toThrow('UNIQUE constraint failed: produits.boutique_id, produits.code_barre')
      expect(() => inserer(db, { code_barre: '0000000000000', sku: 'A' }))
        .toThrow('UNIQUE constraint failed: produits.boutique_id, produits.sku')
    })
  })
})
