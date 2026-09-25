import { describe, it, expect, beforeEach } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
// @ts-ignore node:sqlite types not available without @types/node — moteur SQLite intégré à Node 24
import { DatabaseSync } from 'node:sqlite'

/**
 * Migration 0051 — `ajouts_stock_import` : clés d'ajout de « Ajouter N au stock » (ticket 18 du
 * chantier `vente-lit-catalogue`, points 1 et 4 de la relecture du 2026-09-24).
 *
 * Testé contre un VRAI moteur SQLite (`node:sqlite`) : l'idempotence tient à la clé primaire et à
 * `INSERT OR IGNORE`, qu'aucun mock n'applique. Témoin sans la migration.
 */

// @ts-ignore process types not available without @types/node
const MIGRATION = join(process.cwd(), 'migrations', '0051_ajouts_stock_import.sql')

function base(avecMigration: boolean): any {
  const db = new DatabaseSync(':memory:')
  if (avecMigration) db.exec(readFileSync(MIGRATION, 'utf8'))
  return db
}

/** La réservation telle que `ajouterStockPieceImportee()` l'écrit ; rend le nombre de lignes posées. */
function reserver(db: any, boutique: number, cle: string, produit = 41): number {
  return Number(db.prepare(
    `INSERT OR IGNORE INTO ajouts_stock_import (boutique_id, cle, produit_id, quantite, user_id) VALUES (?, ?, ?, 5, 7)`,
  ).run(boutique, cle, produit).changes)
}

describe('0051 — clés d\'ajout au stock', () => {
  it('témoin : sans la migration, la table n\'existe pas', () => {
    expect(() => reserver(base(false), 1, 'cle-0001')).toThrow(/ajouts_stock_import/)
  })

  describe('avec la migration', () => {
    let db: any
    beforeEach(() => { db = base(true) })

    it('une clé ne se réserve qu\'une fois par boutique : le second INSERT OR IGNORE ne pose rien', () => {
      expect(reserver(db, 1, 'cle-0001')).toBe(1)
      expect(reserver(db, 1, 'cle-0001', 99)).toBe(0)
      // La première réservation est intacte
      expect(db.prepare(`SELECT produit_id FROM ajouts_stock_import WHERE boutique_id = 1 AND cle = 'cle-0001'`).get().produit_id).toBe(41)
    })

    it('la même clé dans une autre boutique est une autre réservation', () => {
      reserver(db, 1, 'cle-0001')
      expect(reserver(db, 2, 'cle-0001')).toBe(1)
    })

    it('une réservation naît sans résultat : stock_avant / stock_apres à NULL (« en cours »)', () => {
      reserver(db, 1, 'cle-0001')
      expect(db.prepare(`SELECT stock_avant, stock_apres FROM ajouts_stock_import`).get())
        .toEqual({ stock_avant: null, stock_apres: null })
    })

    it.each(['produit_id', 'quantite', 'user_id'])('%s est obligatoire', (colonne) => {
      const colonnes = ['boutique_id', 'cle', 'produit_id', 'quantite', 'user_id'].filter(c => c !== colonne)
      expect(() => db.prepare(
        `INSERT INTO ajouts_stock_import (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '1').join(', ')})`,
      ).run()).toThrow(/NOT NULL constraint failed/)
    })

    it('aucune clé étrangère : la trace survit à un produit ou un compte supprimé', () => {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM pragma_foreign_key_list('ajouts_stock_import')`).get().n).toBe(0)
    })
  })
})
