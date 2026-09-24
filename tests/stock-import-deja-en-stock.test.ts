import { describe, it, expect, beforeEach } from 'vitest'
// @ts-ignore node:sqlite types not available without @types/node — moteur SQLite intégré à Node 24
import { DatabaseSync } from 'node:sqlite'
import type { Database } from '../src/ports/database'
import {
  trouverProduitParMobilaxId, rattacherProduitMobilax, completerDescriptionSiVide, ajouterStockPieceImportee,
} from '../src/services/stockService'

/**
 * Pièce fournisseur déjà en stock (ticket 18 du chantier `vente-lit-catalogue`) : reconnaissance
 * par `mobilax_id` stocké, rattachement d'un produit trouvé par son seul code, description reprise
 * si elle est vide, ajout de quantité tracé.
 *
 * Testé contre un VRAI moteur SQLite (`node:sqlite`) : les règles vivent dans le SQL (garde
 * d'isolation, « sauf si la référence est déjà portée » = contrainte 0046, description non
 * écrasée) — un mock renverrait ce qu'on lui configure. Le schéma reprend les colonnes lues par
 * ces fonctions ; `mobilax_id` et son index unique sont ceux de la migration 0050
 * (`migrations/0050_produits_mobilax_id.sql`, soumise en demande d'écriture — fichier critique).
 */

const SCHEMA = `
  CREATE TABLE produits (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    boutique_id           INTEGER NOT NULL,
    nom                   TEXT    NOT NULL,
    sku                   TEXT,
    code_barre            TEXT,
    description           TEXT,
    fournisseur           TEXT,
    fournisseur_id        INTEGER,
    reference_fournisseur TEXT,
    stock_actuel          INTEGER NOT NULL DEFAULT 0,
    actif                 INTEGER NOT NULL DEFAULT 1,
    updated_at            DATETIME,
    mobilax_id            INTEGER
  );
  CREATE UNIQUE INDEX idx_produits_source_fournisseur
    ON produits(boutique_id, fournisseur_id, reference_fournisseur)
    WHERE actif = 1 AND fournisseur_id IS NOT NULL AND reference_fournisseur IS NOT NULL;
  CREATE UNIQUE INDEX idx_produits_mobilax_id
    ON produits(boutique_id, mobilax_id)
    WHERE actif = 1 AND mobilax_id IS NOT NULL;
  CREATE TABLE mouvements_stock (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    produit_id     INTEGER NOT NULL,
    boutique_id    INTEGER NOT NULL,
    type_mouvement TEXT    NOT NULL,
    quantite       INTEGER NOT NULL,
    stock_avant    INTEGER NOT NULL,
    stock_apres    INTEGER NOT NULL,
    ticket_id      INTEGER,
    user_id        INTEGER NOT NULL,
    motif          TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`

let sqlite: any
let db: Database

/** Port `Database` au-dessus du SQLite réel. */
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

/** Insère un produit et rend son id. */
function produit(p: Partial<{
  boutique_id: number; nom: string; description: string | null; fournisseur: string | null
  fournisseur_id: number | null; reference_fournisseur: string | null; stock_actuel: number
  actif: number; mobilax_id: number | null
}> = {}): number {
  const v = { boutique_id: 1, nom: 'Batterie', description: null, fournisseur: null, fournisseur_id: null,
    reference_fournisseur: null, stock_actuel: 0, actif: 1, mobilax_id: null, ...p }
  return Number(sqlite.prepare(
    `INSERT INTO produits (boutique_id, nom, description, fournisseur, fournisseur_id, reference_fournisseur, stock_actuel, actif, mobilax_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(v.boutique_id, v.nom, v.description, v.fournisseur, v.fournisseur_id, v.reference_fournisseur, v.stock_actuel, v.actif, v.mobilax_id).lastInsertRowid)
}

const ligne = (id: number): any => sqlite.prepare('SELECT * FROM produits WHERE id = ?').get(id)

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(SCHEMA)
  db = portSur(sqlite)
})

const FOURNISSEUR = { fournisseur_id: 3, fournisseur_nom: 'MOBILAX', reference: 'BATTIP12', mobilax_id: 17 }

describe('trouverProduitParMobilaxId()', () => {
  it('retrouve le produit de la boutique qui porte cet identifiant Mobilax', async () => {
    const id = produit({ mobilax_id: 17 })
    expect(await trouverProduitParMobilaxId(db, 1, 17)).toEqual({ id })
  })

  it('ne voit ni le produit d\'une autre boutique, ni un produit supprimé', async () => {
    produit({ boutique_id: 2, mobilax_id: 17 })
    produit({ actif: 0, mobilax_id: 18 })
    expect(await trouverProduitParMobilaxId(db, 1, 17)).toBeNull()
    expect(await trouverProduitParMobilaxId(db, 1, 18)).toBeNull()
  })
})

describe('rattacherProduitMobilax()', () => {
  it('produit sans lien fournisseur : rattaché à la fiche, à la référence et à l\'identifiant Mobilax', async () => {
    const id = produit()
    expect(await rattacherProduitMobilax(db, 1, id, FOURNISSEUR)).toBe(true)
    expect(ligne(id)).toMatchObject({
      fournisseur_id: 3, fournisseur: 'MOBILAX', reference_fournisseur: 'BATTIP12', mobilax_id: 17,
    })
  })

  it('le nom de fournisseur saisi à la main n\'est pas écrasé', async () => {
    const id = produit({ fournisseur: 'Grossiste local' })
    await rattacherProduitMobilax(db, 1, id, FOURNISSEUR)
    expect(ligne(id).fournisseur).toBe('Grossiste local')
  })

  it('référence déjà portée par un autre produit (0046) : aucun rattachement, sans erreur', async () => {
    produit({ fournisseur_id: 3, reference_fournisseur: 'BATTIP12' })
    const id = produit()
    expect(await rattacherProduitMobilax(db, 1, id, FOURNISSEUR)).toBe(false)
    expect(ligne(id)).toMatchObject({ fournisseur_id: null, reference_fournisseur: null, mobilax_id: null })
  })

  it('produit déjà lié à une autre pièce : laissé tel quel', async () => {
    const id = produit({ fournisseur_id: 3, reference_fournisseur: 'AUTRE-REF' })
    expect(await rattacherProduitMobilax(db, 1, id, FOURNISSEUR)).toBe(false)
    expect(ligne(id)).toMatchObject({ reference_fournisseur: 'AUTRE-REF', mobilax_id: null })
  })

  it('produit déjà importé avant 0050 (même pièce, pas d\'identifiant) : l\'identifiant est posé', async () => {
    const id = produit({ fournisseur_id: 3, reference_fournisseur: 'BATTIP12' })
    expect(await rattacherProduitMobilax(db, 1, id, FOURNISSEUR)).toBe(true)
    expect(ligne(id)).toMatchObject({ reference_fournisseur: 'BATTIP12', mobilax_id: 17 })
  })

  it('identifiant Mobilax déjà porté : jamais réécrit', async () => {
    const id = produit({ mobilax_id: 99 })
    expect(await rattacherProduitMobilax(db, 1, id, FOURNISSEUR)).toBe(false)
    expect(ligne(id).mobilax_id).toBe(99)
  })

  it('produit d\'une autre boutique : intouché', async () => {
    const id = produit({ boutique_id: 2 })
    expect(await rattacherProduitMobilax(db, 1, id, FOURNISSEUR)).toBe(false)
    expect(ligne(id).mobilax_id).toBeNull()
  })
})

describe('completerDescriptionSiVide()', () => {
  it('description vide ou blanche : reprise du fournisseur', async () => {
    const a = produit({ description: null })
    const b = produit({ description: '   ' })
    expect(await completerDescriptionSiVide(db, 1, a, 'Batterie 12')).toBe(true)
    expect(await completerDescriptionSiVide(db, 1, b, 'Batterie 12')).toBe(true)
    expect(ligne(a).description).toBe('Batterie 12')
    expect(ligne(b).description).toBe('Batterie 12')
  })

  it('description saisie à la main : jamais écrasée', async () => {
    const id = produit({ description: 'Note de l\'atelier' })
    expect(await completerDescriptionSiVide(db, 1, id, 'Batterie 12')).toBe(false)
    expect(ligne(id).description).toBe('Note de l\'atelier')
  })

  it('rien à reprendre (description fournisseur absente) : le produit reste inchangé', async () => {
    const id = produit({ description: null })
    expect(await completerDescriptionSiVide(db, 1, id, null)).toBe(false)
    expect(ligne(id).description).toBeNull()
  })

  it('produit d\'une autre boutique : intouché', async () => {
    const id = produit({ boutique_id: 2 })
    expect(await completerDescriptionSiVide(db, 1, id, 'Batterie 12')).toBe(false)
    expect(ligne(id).description).toBeNull()
  })
})

describe('ajouterStockPieceImportee()', () => {
  it('ajoute la quantité par UNE entrée tracée, et rend l\'ancien et le nouveau stock', async () => {
    const id = produit({ stock_actuel: 4 })
    const r = await ajouterStockPieceImportee(db, 1, 9, id, 5)
    expect(r).toEqual({ stock_avant: 4, stock_apres: 9 })
    expect(ligne(id).stock_actuel).toBe(9)
    const mouvements = sqlite.prepare('SELECT * FROM mouvements_stock WHERE produit_id = ?').all(id)
    expect(mouvements).toHaveLength(1)
    expect(mouvements[0]).toMatchObject({
      boutique_id: 1, type_mouvement: 'entree', quantite: 5, stock_avant: 4, stock_apres: 9,
      user_id: 9, motif: 'Import fournisseur — déjà en stock',
    })
  })

  it('produit d\'une autre boutique : refusé, stock et journal intacts', async () => {
    const id = produit({ boutique_id: 2, stock_actuel: 4 })
    expect(await ajouterStockPieceImportee(db, 1, 9, id, 5)).toBeNull()
    expect(ligne(id).stock_actuel).toBe(4)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM mouvements_stock').get().n).toBe(0)
  })

  it.each([0, -3, 1.5, NaN])('quantité %s : refusée, rien n\'est écrit', async (q) => {
    const id = produit({ stock_actuel: 4 })
    await expect(ajouterStockPieceImportee(db, 1, 9, id, q)).rejects.toThrow(/entier/)
    expect(ligne(id).stock_actuel).toBe(4)
  })
})
