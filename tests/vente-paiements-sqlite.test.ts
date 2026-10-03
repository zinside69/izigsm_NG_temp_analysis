import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { createVente } from '../src/services/caisseService'

/**
 * Paiements d'une vente en caisse, écrits en base (recette 002 B et C, 2026-10-03), prouvés contre
 * un vrai SQLite au schéma réel — migration `0061` comprise (`paiements.montant_remis`,
 * `paiements.rendu_monnaie`) :
 *  - une vente mixte écrit UNE LIGNE `paiements` PAR PART, chacune dans son mode ;
 *  - le montant remis et le rendu sont conservés sur la part en espèces ;
 *  - une ventilation refusée n'écrit rien et ne consomme aucun numéro de facture.
 */

let base: BaseReelle

beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec(`
    INSERT INTO boutiques (id, nom) VALUES (1, 'Boutique 1');
    INSERT INTO users (id, email, password_hash, prenom, nom, role_id, boutique_id, actif)
      VALUES (1, 'vendeur@b1.fr', 'x', 'Vente', 'Deur', 2, 1, 1);
  `)
})

/** Vente d'une ligne à 220 € HT, TVA 20 % : 264,00 € TTC. */
function vendre(paiement: Record<string, unknown>) {
  return createVente(base.d1, 1, 1, {
    lignes: [{ designation: 'Ecran', quantite: 1, prix_unitaire_ht: 220, tva_taux: 20 }],
    ...paiement,
  } as any)
}

const paiementsDe = (factureId: number) => base.sqlite.prepare(
  'SELECT mode_paiement, montant, montant_remis, rendu_monnaie FROM paiements WHERE facture_id = ? ORDER BY id',
).all(factureId)

describe('createVente() — paiements écrits', () => {
  it('mixte espèces 100 + CB 164 : deux lignes, remis 120 et rendu 20 sur la part espèces', async () => {
    const { facture, rendu_monnaie } = await vendre({
      mode_paiement: 'mixte',
      paiements: [{ mode_paiement: 'especes', montant: 100 }, { mode_paiement: 'cb', montant: 164 }],
      montant_especes: 120,
    })
    expect(paiementsDe(facture.id)).toEqual([
      { mode_paiement: 'especes', montant: 100, montant_remis: 120, rendu_monnaie: 20 },
      { mode_paiement: 'cb',      montant: 164, montant_remis: null, rendu_monnaie: null },
    ])
    expect(rendu_monnaie).toBe(20)
  })

  it('espèces 300 remis pour 264 : une ligne, remis et rendu conservés', async () => {
    const { facture } = await vendre({ mode_paiement: 'especes', montant_especes: 300 })
    expect(paiementsDe(facture.id)).toEqual([
      { mode_paiement: 'especes', montant: 264, montant_remis: 300, rendu_monnaie: 36 },
    ])
  })

  it('ventilation refusée : aucune facture, aucun paiement, aucun numéro consommé', async () => {
    await expect(vendre({
      mode_paiement: 'mixte',
      paiements: [{ mode_paiement: 'especes', montant: 100 }, { mode_paiement: 'cb', montant: 100 }],
    })).rejects.toThrow(/total/i)
    expect(base.sqlite.prepare('SELECT COUNT(*) AS n FROM factures').get().n).toBe(0)
    expect(base.sqlite.prepare('SELECT COUNT(*) AS n FROM paiements').get().n).toBe(0)

    // La première vente valide prend le n° 1 de la série
    const { facture } = await vendre({ mode_paiement: 'cb' })
    expect(facture.numero).toMatch(/-0*1$/)
  })
})
