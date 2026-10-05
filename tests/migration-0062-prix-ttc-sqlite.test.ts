import { describe, it, expect, beforeEach } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'

/**
 * Prix de vente TTC des pièces (ticket 01 du chantier prix TTC, décisions Q1 et Q8 de l'exploitant
 * du 2026-10-04) : la migration 0062 ajoute le prix de vente TTC à côté du HT, et le reprend une fois
 * pour toutes — TTC = HT × (1 + taux), arrondi au centime. L'ancien HT reste intact (marche arrière).
 *
 * Avant la migration, une requête compte en production les fiches dont le TTC repris ne sera pas
 * « rond » (centimes ni 00 ni 90), pour remettre la liste à l'exploitant.
 *
 * Contre un vrai SQLite au schéma réel, arrêté juste avant 0062.
 */

// @ts-ignore process types not available without @types/node
const RACINE = process.cwd()
const MIGRATION_0062 = readFileSync(join(RACINE, 'migrations', '0062_produits_prix_vente_ttc.sql'), 'utf8')
const REQUETE_NON_RONDS = readFileSync(join(RACINE, 'scripts', 'sql', 'prix-ttc-non-ronds.sql'), 'utf8')

let base: BaseReelle

/** Une pièce de la boutique 1 : identifiant, prix de vente HT, taux de TVA. */
function piece(id: number, prixVenteHt: number, tauxTva: number) {
  base.sqlite.prepare(`INSERT INTO produits (id, boutique_id, nom, prix_vente_ht, tva_taux) VALUES (?, 1, ?, ?, ?)`)
    .run(id, `Pièce ${id}`, prixVenteHt, tauxTva)
}

beforeEach(() => {
  base = baseAuSchemaReel('0062')
  base.sqlite.exec(`INSERT INTO boutiques (id, nom) VALUES (1, 'B1')`)
  piece(1, 8.25, 20)      // 8,25 × 1,2 = 9,90 → rond (,90)
  piece(2, 16.66, 20)     // 16,66 × 1,2 = 19,992 → 19,99, pas rond
  piece(3, 100, 20)       // 120,00 → rond (,00)
  piece(4, 10, 5.5)       // 10,55 → pas rond
  piece(5, 0, 20)         // prix non saisi : 0,00
})

describe('requête des TTC non ronds — jouée AVANT la migration', () => {
  it('liste les fiches dont le TTC repris n\'aura ni 00 ni 90 centimes, avec ce TTC', () => {
    const lignes = base.sqlite.prepare(REQUETE_NON_RONDS).all()
    expect(lignes.map((l: any) => [l.produit_id, l.prix_vente_ttc_repris])).toEqual([[2, 19.99], [4, 10.55]])
  })
})

describe('migration 0062 — prix de vente TTC repris au centime', () => {
  it('écrit le TTC repris et laisse le HT intact', () => {
    base.sqlite.exec(MIGRATION_0062)
    const lignes = base.sqlite.prepare('SELECT id, prix_vente_ht, prix_vente_ttc FROM produits ORDER BY id').all()
    expect(lignes.map((l: any) => [l.id, l.prix_vente_ht, l.prix_vente_ttc])).toEqual([
      [1, 8.25, 9.9],
      [2, 16.66, 19.99],
      [3, 100, 120],
      [4, 10, 10.55],
      [5, 0, 0],
    ])
  })
})
