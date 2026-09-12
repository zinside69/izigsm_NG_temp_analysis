import { describe, it, expect, beforeEach } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
// @ts-ignore node:sqlite types not available without @types/node — moteur SQLite intégré à Node 24
import { DatabaseSync } from 'node:sqlite'

/**
 * Migration 0046 — une pièce fournisseur n'existe qu'une fois par boutique (décision du
 * 2026-09-12, revue du ticket 04 Mobilax).
 *
 * L'import vérifie `deja_importe` puis crée le produit : deux clics simultanés passaient tous
 * deux la vérification. L'index unique partiel ferme cette fenêtre au niveau de la base.
 *
 * Testé contre un VRAI SQLite (`node:sqlite`) : un mock n'applique aucune contrainte. Le
 * fichier de migration est rejoué tel quel, dans une transaction comme D1.
 */

// @ts-ignore process types not available without @types/node
const MIGRATION = join(process.cwd(), 'migrations', '0046_produits_source_fournisseur_unique.sql')

describe('produits — source fournisseur unique par boutique', () => {
  let db: any
  const inserer = (boutique: number, fournisseur: number | null, ref: string | null, actif = 1) =>
    db.prepare('INSERT INTO produits (boutique_id, fournisseur_id, reference_fournisseur, actif) VALUES (?, ?, ?, ?)')
      .run(boutique, fournisseur, ref, actif)

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE produits (
      id INTEGER PRIMARY KEY AUTOINCREMENT, boutique_id INTEGER NOT NULL,
      fournisseur_id INTEGER, reference_fournisseur TEXT, actif INTEGER NOT NULL DEFAULT 1)`)
    db.exec('BEGIN')
    db.exec(readFileSync(MIGRATION, 'utf8'))
    db.exec('COMMIT')
  })

  it('refuse un second produit actif pour la même pièce du même fournisseur', () => {
    inserer(1, 3, 'ECRTAREAPPIPHNE12MNO')
    expect(() => inserer(1, 3, 'ECRTAREAPPIPHNE12MNO')).toThrow(/UNIQUE constraint failed/)
  })

  it('étanchéité : la même pièce reste importable par une autre boutique', () => {
    inserer(1, 3, 'ECRTAREAPPIPHNE12MNO')
    expect(() => inserer(2, 7, 'ECRTAREAPPIPHNE12MNO')).not.toThrow()
  })

  it('un produit supprimé (actif = 0) n\'empêche pas de réimporter la pièce', () => {
    inserer(1, 3, 'ECRTAREAPPIPHNE12MNO', 0)
    expect(() => inserer(1, 3, 'ECRTAREAPPIPHNE12MNO')).not.toThrow()
  })

  it('produits saisis à la main (sans fournisseur ni référence) : aucune contrainte', () => {
    inserer(1, null, null); inserer(1, null, null)
    inserer(1, null, 'REF-LIBRE'); inserer(1, null, 'REF-LIBRE')
    expect(db.prepare('SELECT COUNT(*) AS n FROM produits').get().n).toBe(4)
  })
})
