import { describe, it, expect } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync, readdirSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
// @ts-ignore node:sqlite types not available without @types/node — moteur SQLite intégré à Node 24
import { DatabaseSync } from 'node:sqlite'
import { sqlSousSeuil } from '../src/lib/stockSeuil'

/**
 * Seuil d'alerte à 0 = produit non surveillé (décision du 2026-09-12, `decisions.md`).
 *
 * Le dépôt comparait `stock_actuel <= stock_minimum` à sept endroits : avec un seuil 0, un
 * produit à 0 en stock restait « à commander » — c'est le cas de toute pièce Mobilax importée
 * (stock 0, seuil 0), qui déclenchait l'alerte dès l'import.
 *
 * Deux volets :
 * - la règle, contre un VRAI SQLite (`node:sqlite`) : un mock rendrait ce qu'on lui configure,
 *   quelle que soit la condition SQL écrite (`CLAUDE.md` § Bons de commande) ;
 * - un garde-fou statique : plus aucune comparaison écrite à la main hors de `stockSeuil.ts`,
 *   sans quoi une requête future réintroduirait l'ancienne règle sans que rien ne le signale.
 */

describe('sqlSousSeuil — règle du seuil d\'alerte', () => {
  /** Noms des produits retenus par la condition, sur une table minimale. */
  function retenus(alias?: string): string[] {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE produits (nom TEXT, stock_actuel INTEGER, stock_minimum INTEGER)')
    const lignes: [string, number, number][] = [
      ['rupture seuil 0',   0, 0],   // pièce importée : ne doit PAS alerter
      ['en stock seuil 0',  3, 0],
      ['rupture seuil 2',   0, 2],   // rupture d'un produit surveillé : à commander
      ['au seuil',          2, 2],   // stock = seuil : alerte (règle ≤ conservée si seuil > 0)
      ['sous le seuil',     1, 2],
      ['au-dessus',         5, 2],
    ]
    const ins = db.prepare('INSERT INTO produits VALUES (?, ?, ?)')
    for (const l of lignes) ins.run(...l)
    const from = alias ? `produits ${alias}` : 'produits'
    return db.prepare(`SELECT nom FROM ${from} WHERE ${sqlSousSeuil(alias)} ORDER BY nom`)
      .all().map((r: any) => r.nom)
  }

  it('un seuil 0 n\'alerte jamais, un seuil > 0 alerte dès que stock ≤ seuil', () => {
    expect(retenus()).toEqual(['au seuil', 'rupture seuil 2', 'sous le seuil'])
  })

  it('fonctionne avec un alias de table (requêtes en jointure)', () => {
    expect(retenus('p')).toEqual(['au seuil', 'rupture seuil 2', 'sous le seuil'])
  })
})

describe('garde-fou — aucune comparaison stock/seuil écrite à la main', () => {
  // @ts-ignore process types not available without @types/node
  const SRC = join(process.cwd(), 'src')

  /** Source sans commentaires : les JSDoc qui décrivent la règle ne doivent pas déclencher. */
  function sansCommentaires(code: string): string {
    return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  }

  it('tout site passe par sqlSousSeuil()', () => {
    const fichiers = (readdirSync(SRC, { recursive: true }) as string[])
      .filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
      .filter(f => !f.replace(/\\/g, '/').endsWith('lib/stockSeuil.ts'))
    const motif = /stock_actuel\s*<=?\s*[\w.]*stock_minimum/
    const fautifs = fichiers.filter(f => motif.test(sansCommentaires(readFileSync(join(SRC, f), 'utf8'))))
    expect(fautifs).toEqual([])
  })
})
