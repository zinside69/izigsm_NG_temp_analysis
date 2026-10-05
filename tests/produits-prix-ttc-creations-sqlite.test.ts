import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { importCatalogueCsv } from '../src/services/stockService'
import { terminerOrdre } from '../src/services/reconditionnementService'
import { D1DatabaseAdapter } from '../src/adapters/cloudflare/d1Database'

/**
 * Tout chemin de création de produit écrit le prix de vente TTC (ticket 01 du chantier prix TTC,
 * 2026-10-04). En attendant les tickets 06 et 07 (prix calculé par la marge, colonne TTC du CSV),
 * un prix de vente HT reçu donne TTC = HT × (1 + taux), arrondi au centime.
 *
 * Import CSV : il écrit ses produits lui-même (pas par `createProduit()`), en création comme en mise
 * à jour d'une fiche de même SKU. Contre un vrai SQLite au schéma réel.
 */

let base: BaseReelle

function prixEnBase(sku: string): { ht: number; ttc: number } {
  const ligne = base.sqlite.prepare('SELECT prix_vente_ht, prix_vente_ttc FROM produits WHERE sku = ?').get(sku)
  return { ht: ligne.prix_vente_ht, ttc: ligne.prix_vente_ttc }
}

beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec(`INSERT INTO boutiques (id, nom) VALUES (1, 'B1')`)
  base.sqlite.exec(`INSERT INTO users (id, email, password_hash, prenom, nom, role_id, boutique_id, actif)
    VALUES (7, 'manager@b1.fr', 'x', 'Man', 'Ager', 2, 1, 1)`)
})

describe('clôture d\'un reconditionnement — produit occasion créé avec son TTC', () => {
  it('prix de revente 100 € HT (TVA 20 % codée par la clôture) → 120 € TTC', async () => {
    base.sqlite.exec(`INSERT INTO ordres_reconditionnement (id, boutique_id, numero, statut, appareil_marque)
      VALUES (1, 1, 'REC-001', 'en_cours', 'Apple')`)
    await terminerOrdre(new D1DatabaseAdapter(base.d1), 1, 1, { prix_revente_ht: 100, grade: 'A' })
    expect(prixEnBase('OCC-REC-001')).toEqual({ ht: 100, ttc: 120 })
  })
})

describe('import CSV — prix de vente TTC écrit', () => {
  it('création : 16,66 € HT à 20 % → 19,99 € TTC', async () => {
    await importCatalogueCsv(base.d1, 1, 7, 'sku;nom;prix_vente_ht;tva_taux\nBAT-1;Batterie;16,66;20')
    expect(prixEnBase('BAT-1')).toEqual({ ht: 16.66, ttc: 19.99 })
  })

  it('mise à jour d\'une fiche de même SKU : 8,25 € HT → 9,90 € TTC', async () => {
    await importCatalogueCsv(base.d1, 1, 7, 'sku;nom;prix_vente_ht;tva_taux\nECR-1;Écran;1;20')
    await importCatalogueCsv(base.d1, 1, 7, 'sku;nom;prix_vente_ht;tva_taux\nECR-1;Écran;8,25;20')
    expect(prixEnBase('ECR-1')).toEqual({ ht: 8.25, ttc: 9.9 })
  })
})
