import { describe, it, expect, beforeEach } from 'vitest'
import type { Database } from '../src/ports/database'
import { lireFavorisVente, PLAFOND_FAVORIS_VENTE } from '../src/services/catalogueService'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'

/**
 * Favoris de la caisse (recette 001 A′, décision de l'exploitant du 2026-10-02) : les articles et
 * services **les plus vendus de la boutique sur 90 jours**, lus dans les lignes des factures
 * émises. La règle vit dans le SQL (jointures, période, statut, isolation) : prouvée contre un
 * VRAI SQLite au schéma réel (`baseAuSchemaReel()`), jamais contre un mock.
 */

let base: BaseReelle
let db:   Database

/** Port `Database` au-dessus du SQLite réel — même adaptateur que les autres tests SQLite. */
function portSur(sqlite: any): Database {
  return {
    async all<T>(sql: string, params: unknown[] = []) { return sqlite.prepare(sql).all(...params) as T[] },
    async get<T>(sql: string, params: unknown[] = []) { return (sqlite.prepare(sql).get(...params) ?? null) as T | null },
    // Port enrichi de batch() le 2026-10-03 (clôture NF525) : ce test ne l'utilise pas
    async batch(): Promise<unknown[][]> { throw new Error('batch() non utilisé par ce test') },
    async run(sql: string, params: unknown[] = []) {
      const r = sqlite.prepare(sql).run(...params)
      return { id: Number(r.lastInsertRowid), changes: Number(r.changes) }
    },
  }
}

function produit(nom: string, o: { boutique?: number; prix?: number; actif?: number } = {}): number {
  return Number(base.sqlite.prepare(
    'INSERT INTO produits (boutique_id, nom, prix_vente_ht, tva_taux, stock_actuel, actif) VALUES (?, ?, ?, 20, 5, ?)',
  ).run(o.boutique ?? 1, nom, o.prix ?? 10, o.actif ?? 1).lastInsertRowid)
}

function service(nom: string, o: { boutique?: number; prix?: number } = {}): number {
  return Number(base.sqlite.prepare(
    'INSERT INTO services (boutique_id, nom, prix_ht, tva_taux, actif) VALUES (?, ?, ?, 20, 1)',
  ).run(o.boutique ?? 1, nom, o.prix ?? 30).lastInsertRowid)
}

let numero = 0
/**
 * Facture et ses lignes. Par défaut : émise (`locked = 1`) aujourd'hui, payée, boutique 1.
 * `lignes` : `[produit_id | null, service_id | null, quantite]`.
 */
function facture(
  lignes: [number | null, number | null, number][],
  o: { boutique?: number; locked?: number; statut?: string; ilYaJours?: number } = {},
): void {
  const id = Number(base.sqlite.prepare(`
    INSERT INTO factures (boutique_id, client_id, numero, total_ht, total_tva, total_ttc, statut, locked, issued_at)
    VALUES (?, ?, ?, 0, 0, 0, ?, ?, datetime('now', ?))
  `).run(o.boutique ?? 1, o.boutique ?? 1, `F-${++numero}`, o.statut ?? 'payee', o.locked ?? 1, `-${o.ilYaJours ?? 0} days`).lastInsertRowid)
  for (const [p, s, q] of lignes) {
    base.sqlite.prepare(`
      INSERT INTO lignes_document (document_type, document_id, description, quantite, prix_unitaire_ht, tva_taux, produit_id, service_id)
      VALUES ('facture', ?, 'ligne', ?, 10, 20, ?, ?)
    `).run(id, q, p, s)
  }
}

beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec("INSERT INTO boutiques (id, nom) VALUES (1, 'B1'), (2, 'B2')")
  base.sqlite.exec("INSERT INTO clients (id, boutique_id, nom, prenom) VALUES (1, 1, 'Comptoir', 'C'), (2, 2, 'Comptoir', 'C')")
  db = portSur(base.sqlite)
  numero = 0
})

describe('lireFavorisVente()', () => {
  it('classe produits et services ensemble par quantité vendue, au prix courant de la fiche', async () => {
    const verre = produit('Verre trempé', { prix: 8.25 })
    const coque = produit('Coque')
    const pose  = service('Pose de film', { prix: 15 })
    facture([[verre, null, 2], [coque, null, 1]])
    facture([[verre, null, 3], [null, pose, 4]])

    const fav = await lireFavorisVente(db, 1)
    expect(fav.map(f => f.nom)).toEqual(['Verre trempé', 'Pose de film', 'Coque'])
    expect(fav[0]).toEqual({
      type: 'produit', id: verre, nom: 'Verre trempé', sku: null, code_barre: null,
      prix_vente_ht: 8.25, tva_taux: 20, stock_actuel: 5,
      dernier_prix_vendu_ht: 10,   // recette 002 D : prix de la ligne vendue (fixture : 10 € HT)
      // Ticket 02 prix TTC : fiche créée sans TTC (fixture HT seule) ; ligne vendue en HT → 10 × 1,20
      prix_vente_ttc: 0,
      dernier_prix_vendu_ttc: 12,
    })
    expect(fav[1]).toEqual({ type: 'service', id: pose, nom: 'Pose de film', reference: null, prix_ht: 15, tva_taux: 20 })
  })

  it('ignore brouillons, factures annulées, ventes de plus de 90 jours et lignes libres', async () => {
    const vendu     = produit('Vendu')
    const brouillon = produit('En brouillon')
    const annule    = produit('Annulé')
    const ancien    = produit('Ancien')
    facture([[vendu, null, 1], [null, null, 50]])
    facture([[brouillon, null, 9]], { locked: 0, statut: 'brouillon' })
    facture([[annule, null, 9]], { statut: 'annulee' })
    facture([[ancien, null, 9]], { ilYaJours: 91 })

    expect((await lireFavorisVente(db, 1)).map(f => f.nom)).toEqual(['Vendu'])
  })

  it('isolation : ne lit que les ventes de la boutique, et pas un produit désactivé', async () => {
    const chezMoi   = produit('Chez moi')
    const desactive = produit('Désactivé', { actif: 0 })
    const ailleurs  = produit('Ailleurs', { boutique: 2 })
    facture([[chezMoi, null, 1], [desactive, null, 5]])
    facture([[ailleurs, null, 9]], { boutique: 2 })

    expect((await lireFavorisVente(db, 1)).map(f => f.nom)).toEqual(['Chez moi'])
    expect((await lireFavorisVente(db, 2)).map(f => f.nom)).toEqual(['Ailleurs'])
  })

  it(`plafonné à ${PLAFOND_FAVORIS_VENTE}, à égalité par nom`, async () => {
    const ids = Array.from({ length: PLAFOND_FAVORIS_VENTE + 3 }, (_, i) => produit(`P${String(i).padStart(2, '0')}`))
    facture(ids.map(id => [id, null, 1] as [number, null, number]))

    const fav = await lireFavorisVente(db, 1)
    expect(fav).toHaveLength(PLAFOND_FAVORIS_VENTE)
    expect(fav[0].nom).toBe('P00')
  })

  it('boutique sans historique → aucun favori', async () => {
    produit('Jamais vendu')
    expect(await lireFavorisVente(db, 1)).toEqual([])
  })
})
