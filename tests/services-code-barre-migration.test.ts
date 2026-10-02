import { describe, it, expect, beforeEach } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
// @ts-ignore node:sqlite types not available without @types/node — moteur SQLite intégré à Node 24
import { DatabaseSync } from 'node:sqlite'

/**
 * Migration 0052 — code-barres des services (ticket 05 `vente-lit-catalogue`, « Codes maison »).
 *
 * Testé contre un VRAI moteur SQLite (`node:sqlite`), jamais un mock : un index unique partiel ne
 * se simule pas. Chaque cas est joué **avec** et **sans** la migration — un test qui ne verrait que
 * le refus ne dirait pas que c'est la migration qui le produit. Même patron que
 * `tests/produits-unicite-codes-migration.test.ts` (migration 0048).
 */

// @ts-ignore process types not available without @types/node
const MIGRATION = join(process.cwd(), 'migrations', '0052_services_code_barre.sql')

/**
 * Colonnes de `services` AVANT 0052 (schéma réel : 0013_services.sql) — `code_barre` n'existe pas
 * encore, 0052 l'ajoute elle-même par `ALTER TABLE` : la pré-déclarer ici ferait échouer la
 * migration avec « duplicate column name » au lieu de prouver qu'elle l'ajoute.
 */
const SCHEMA_SERVICES = `
  CREATE TABLE services (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    boutique_id INTEGER NOT NULL,
    nom         TEXT    NOT NULL,
    actif       INTEGER NOT NULL DEFAULT 1
  )`

function base(avecMigration: boolean): any {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_SERVICES)
  if (avecMigration) db.exec(readFileSync(MIGRATION, 'utf8'))
  return db
}

function inserer(db: any, s: { boutique?: number; nom?: string; code_barre?: string | null; actif?: number }) {
  db.prepare('INSERT INTO services (boutique_id, nom, code_barre, actif) VALUES (?, ?, ?, ?)').run(
    s.boutique ?? 1, s.nom ?? 'Service', s.code_barre ?? null, s.actif ?? 1,
  )
}

describe('0052 — unicité du code-barres de service par boutique', () => {
  describe('témoin : sans la migration, la colonne code_barre n\'existe pas encore', () => {
    // 0052 ajoute la colonne ET l'index dans le même fichier (ALTER TABLE, contrairement à 0048 où
    // l'index seul était ajouté sur une colonne déjà existante) : le témoin qui compte ici est que
    // rien n'écrit dans `code_barre` sans la migration, pas « un doublon serait accepté ».
    it('refuse toute insertion référençant code_barre (colonne absente)', () => {
      const db = base(false)
      expect(() => inserer(db, { code_barre: '2200000000011' })).toThrow(/has no column named code_barre/)
    })
  })

  describe('avec la migration', () => {
    let db: any
    beforeEach(() => { db = base(true) })

    it('refuse un second service actif au même code-barres dans la même boutique', () => {
      inserer(db, { nom: 'Pose de film', code_barre: '2200000000011' })
      expect(() => inserer(db, { nom: 'Doublon', code_barre: '2200000000011' }))
        .toThrow(/UNIQUE constraint failed/)
    })

    it('laisse passer deux services sans code-barres', () => {
      inserer(db, { code_barre: null })
      expect(() => inserer(db, { code_barre: null })).not.toThrow()
    })

    it('laisse passer deux services dont le code est vide ou blanc', () => {
      inserer(db, { code_barre: '' })
      expect(() => inserer(db, { code_barre: '  ' })).not.toThrow()
    })

    it('laisse passer un code déjà porté par un service inactif (supprimé)', () => {
      inserer(db, { code_barre: '2200000000011', actif: 0 })
      expect(() => inserer(db, { code_barre: '2200000000011' })).not.toThrow()
    })

    it('laisse deux boutiques porter le même code', () => {
      inserer(db, { boutique: 1, code_barre: '2200000000011' })
      expect(() => inserer(db, { boutique: 2, code_barre: '2200000000011' })).not.toThrow()
    })

    it('nomme la colonne en cause dans le message d\'erreur', () => {
      // Fait sur lequel s'appuie la conversion en message lisible (leverSiServiceCodeEnDoublon)
      inserer(db, { code_barre: '2200000000011' })
      expect(() => inserer(db, { code_barre: '2200000000011' }))
        .toThrow('UNIQUE constraint failed: services.boutique_id, services.code_barre')
    })
  })
})
