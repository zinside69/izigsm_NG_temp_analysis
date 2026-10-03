import { describe, it, expect, beforeEach } from 'vitest'
import type { Database } from '../src/ports/database'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { rechercherParImei } from '../src/services/catalogueService'

/**
 * Scan d'un IMEI en caisse (ticket 07 `vente-lit-catalogue`, story 21) : un téléphone d'occasion
 * en vente se retrouve par l'IMEI de sa fiche. Égalité stricte, produits actifs de la boutique.
 * Contre un vrai SQLite au schéma réel (colonne et index de 0054).
 */

const IMEI = '356938035643809'

let base: BaseReelle
let db: Database

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

function produit(p: { boutique?: number; nom?: string; imei?: string | null; actif?: number }): number {
  return Number(base.sqlite.prepare(
    'INSERT INTO produits (boutique_id, nom, imei, actif, prix_vente_ht, tva_taux) VALUES (?, ?, ?, ?, 300, 20)',
  ).run(p.boutique ?? 1, p.nom ?? 'iPhone 12 occasion', p.imei ?? null, p.actif ?? 1).lastInsertRowid)
}

beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec("INSERT INTO boutiques (id, nom) VALUES (1, 'B1'), (2, 'B2')")
  db = portSur(base.sqlite)
})

describe('rechercherParImei()', () => {
  it('trouve le produit actif portant cet IMEI', async () => {
    const id = produit({ imei: IMEI })
    const res = await rechercherParImei(db, 1, IMEI)
    expect(res.map(r => r.id)).toEqual([id])
    expect(res[0]).toMatchObject({ type: 'produit', nom: 'iPhone 12 occasion', prix_vente_ht: 300 })
  })

  it('ignore un produit inactif et une autre boutique', async () => {
    produit({ imei: IMEI, actif: 0 })
    produit({ boutique: 2, imei: IMEI })
    expect(await rechercherParImei(db, 1, IMEI)).toEqual([])
  })

  it('égalité stricte : un IMEI voisin ne remonte pas', async () => {
    produit({ imei: '490154203237518' })
    expect(await rechercherParImei(db, 1, IMEI)).toEqual([])
  })
})
