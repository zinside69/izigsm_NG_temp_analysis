import { describe, it, expect, beforeEach } from 'vitest'
import type { Database } from '../src/ports/database'
import {
  rechercherCatalogue, rechercherParCode, rechercherParImei, lireFavorisVente,
} from '../src/services/catalogueService'
import type { ResultatProduit } from '../src/services/catalogueService'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'

/**
 * Dernier prix vendu (recette 002 D, décision de l'exploitant du 2026-10-03) : une pièce importée
 * sans prix de vente (fiche à 0,00 €) s'affichait à 0 en caisse alors qu'elle avait été vendue
 * 220 € HT. Chaque résultat produit porte `dernier_prix_vendu_ht` : prix HT de la ligne la plus
 * récente de ce produit dans une facture **émise non annulée de la même boutique**, ou `null`.
 * L'écran le prend quand la fiche est à 0. Règle portée par le SQL → vrai SQLite au schéma réel.
 */

let base: BaseReelle
let db:   Database

function portSur(sqlite: any): Database {
  return {
    async all<T>(sql: string, params: unknown[] = []) { return sqlite.prepare(sql).all(...params) as T[] },
    async get<T>(sql: string, params: unknown[] = []) { return (sqlite.prepare(sql).get(...params) ?? null) as T | null },
    async run(sql: string, params: unknown[] = []) {
      const r = sqlite.prepare(sql).run(...params)
      return { id: Number(r.lastInsertRowid), changes: Number(r.changes) }
    },
  }
}

const EAN  = '3000000388952'
const IMEI = '356938035643809'

function produit(o: { boutique?: number; prix?: number; nom?: string; ean?: string | null; imei?: string | null } = {}): number {
  return Number(base.sqlite.prepare(`
    INSERT INTO produits (boutique_id, nom, code_barre, imei, prix_vente_ht, tva_taux, stock_actuel, actif)
    VALUES (?, ?, ?, ?, ?, 20, 1, 1)
  `).run(o.boutique ?? 1, o.nom ?? 'Ecran Tactile Hard Oled', o.ean ?? null, o.imei ?? null, o.prix ?? 0).lastInsertRowid)
}

let numero = 0
/** Une facture d'une ligne `produitId` vendue `prixHt`, émise il y a `ilYaJours`. */
function vente(produitId: number, prixHt: number, o: { boutique?: number; locked?: number; statut?: string; ilYaJours?: number } = {}) {
  const boutique = o.boutique ?? 1
  const id = Number(base.sqlite.prepare(`
    INSERT INTO factures (boutique_id, client_id, numero, total_ht, total_tva, total_ttc, statut, locked, issued_at)
    VALUES (?, ?, ?, 0, 0, 0, ?, ?, datetime('now', ?))
  `).run(boutique, boutique, `F-${++numero}`, o.statut ?? 'payee', o.locked ?? 1, `-${o.ilYaJours ?? 0} days`).lastInsertRowid)
  base.sqlite.prepare(`
    INSERT INTO lignes_document (document_type, document_id, description, quantite, prix_unitaire_ht, tva_taux, produit_id)
    VALUES ('facture', ?, 'ligne', 1, ?, 20, ?)
  `).run(id, prixHt, produitId)
}

beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec("INSERT INTO boutiques (id, nom) VALUES (1, 'B1'), (2, 'B2')")
  base.sqlite.exec("INSERT INTO clients (id, boutique_id, nom, prenom) VALUES (1, 1, 'Comptoir', 'C'), (2, 2, 'Comptoir', 'C')")
  db = portSur(base.sqlite)
  numero = 0
})

/** `dernier_prix_vendu_ht` du produit `id` dans chacun des quatre chemins de lecture. */
async function parChemin(id: number) {
  const prix = (liste: any[]) => liste.find(r => r.type === 'produit' && r.id === id)?.dernier_prix_vendu_ht
  return {
    recherche: prix(await rechercherCatalogue(db, 1, 'Ecran')),
    code:      prix(await rechercherParCode(db, 1, EAN)),
    imei:      prix(await rechercherParImei(db, 1, IMEI)),
    favoris:   prix(await lireFavorisVente(db, 1)),
  }
}

describe('dernier_prix_vendu_ht — résultats produit', () => {
  it('le plus récent des prix vendus, dans les quatre chemins de lecture', async () => {
    const id = produit({ ean: EAN, imei: IMEI })
    vente(id, 200, { ilYaJours: 10 })
    vente(id, 220, { ilYaJours: 1 })
    expect(await parChemin(id)).toEqual({ recherche: 220, code: 220, imei: 220, favoris: 220 })
  })

  it('ignore brouillon, facture annulée et ventes d\'une autre boutique', async () => {
    const id = produit({ ean: EAN, imei: IMEI })
    vente(id, 220, { ilYaJours: 5 })
    vente(id, 999, { locked: 0, statut: 'brouillon' })
    vente(id, 888, { statut: 'annulee' })
    vente(id, 777, { boutique: 2 })
    expect(await parChemin(id)).toEqual({ recherche: 220, code: 220, imei: 220, favoris: 220 })
  })

  it('jamais vendu → null (prix à saisir), fiche inchangée', async () => {
    const id = produit({ ean: EAN, imei: IMEI })
    // `rechercherParCode()` ne rend que des produits : on le dit au typage pour lire leurs champs
    const resultats = await rechercherParCode(db, 1, EAN)
    const r = resultats[0] as ResultatProduit
    expect(r.dernier_prix_vendu_ht).toBeNull()
    expect(r.prix_vente_ht).toBe(0)
    expect((await rechercherCatalogue(db, 1, 'Ecran')).find(x => x.id === id)).toMatchObject({ dernier_prix_vendu_ht: null })
  })
})
