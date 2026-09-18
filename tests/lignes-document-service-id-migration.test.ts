import { describe, it, expect } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
// @ts-ignore node:sqlite types not available without @types/node — moteur SQLite intégré à Node
import { DatabaseSync } from 'node:sqlite'

/**
 * Migration 0049 — le lien d'une ligne de document vers le service du catalogue (ticket 03 du
 * chantier `vente-lit-catalogue`, récit 20).
 *
 * Testé contre un VRAI moteur SQLite (`node:sqlite`) : un mock ne dit rien d'un `ALTER TABLE`.
 * Joué **avec** et **sans** la migration, pour que ce soit elle qui produise la colonne.
 */

// @ts-ignore process types not available without @types/node
const MIGRATION = join(process.cwd(), 'migrations', '0049_lignes_document_service_id.sql')

/** Schéma réel de `lignes_document` (0006_facturation.sql), jamais recréé depuis. */
const SCHEMA_LIGNES = `
  CREATE TABLE lignes_document (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    document_type    TEXT    NOT NULL,
    document_id      INTEGER NOT NULL,
    ordre            INTEGER NOT NULL DEFAULT 1,
    description      TEXT    NOT NULL,
    quantite         REAL    NOT NULL DEFAULT 1,
    prix_unitaire_ht REAL    NOT NULL DEFAULT 0,
    tva_taux         REAL    NOT NULL DEFAULT 20.0,
    total_ht         REAL    NOT NULL DEFAULT 0,
    total_tva        REAL    NOT NULL DEFAULT 0,
    total_ttc        REAL    NOT NULL DEFAULT 0,
    produit_id       INTEGER,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
  )`

function base(avecMigration: boolean): any {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_LIGNES)
  db.prepare(`INSERT INTO lignes_document (document_type, document_id, description) VALUES ('facture', 1, 'Ligne existante')`).run()
  if (avecMigration) db.exec(readFileSync(MIGRATION, 'utf8'))
  return db
}

const INSERT_SERVICE = `INSERT INTO lignes_document (document_type, document_id, description, service_id) VALUES ('facture', 2, 'Pose de film', 7)`

describe('0049 — service_id sur les lignes de document', () => {
  it('témoin : sans la migration, la colonne n\'existe pas', () => {
    expect(() => base(false).prepare(INSERT_SERVICE).run()).toThrow(/service_id/)
  })

  it('une ligne peut porter le service vendu', () => {
    const db = base(true)
    db.prepare(INSERT_SERVICE).run()
    expect(db.prepare(`SELECT service_id FROM lignes_document WHERE document_id = 2`).get().service_id).toBe(7)
  })

  it('les lignes existantes sont conservées, sans service', () => {
    const db = base(true)
    const ligne = db.prepare(`SELECT description, service_id FROM lignes_document WHERE document_id = 1`).get()
    expect(ligne).toEqual({ description: 'Ligne existante', service_id: null })
  })

  it('le lien survit à la disparition du service (aucune clé étrangère) : une facture est immuable', () => {
    const db = base(true)
    const fk = db.prepare(`SELECT COUNT(*) AS n FROM pragma_foreign_key_list('lignes_document')`).get()
    expect(fk.n).toBe(0)
  })
})
