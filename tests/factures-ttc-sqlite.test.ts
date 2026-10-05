import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { createFacture, createAvoir, emettreFacture } from '../src/services/factureService'
import { convertirDevis } from '../src/services/devisService'
import { verifierIntegriteChaine } from '../src/services/caisseService'
import { D1DatabaseAdapter } from '../src/adapters/cloudflare/d1Database'

/**
 * Factures et avoirs en TTC (ticket 03 du chantier prix TTC, décisions Q2 et Q19 de l'exploitant du
 * 2026-10-04) : une facture manuelle se saisit en prix unitaire TTC et se calcule depuis le TTC,
 * comme la caisse (ticket 02) ; la conversion d'un devis garde le mode de chaque ligne ; un avoir
 * en TTC rend exactement les montants des lignes qu'il reprend. Une ligne envoyée en HT seul garde
 * l'ancien calcul. La chaîne NF525 reste intègre.
 *
 * Contre un vrai SQLite au schéma réel (migrations 0062 et 0063 comprises). Montants à la main.
 */

let base: BaseReelle

beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec(`
    INSERT INTO boutiques (id, nom) VALUES (1, 'Boutique 1');
    INSERT INTO users (id, email, password_hash, prenom, nom, role_id, boutique_id, actif)
      VALUES (1, 'manager@b1.fr', 'x', 'Man', 'Ager', 2, 1, 1);
    INSERT INTO clients (id, boutique_id, prenom, nom) VALUES (1, 1, 'Jeanne', 'Client');
  `)
})

/** Facture manuelle de la boutique 1, pour le client 1. */
function facturer(lignes: unknown[], action: 'brouillon' | 'emettre' = 'emettre') {
  return createFacture(base.d1, 1, { boutique_id: 1, client_id: 1, lignes, action } as any)
}

const factureEnBase = (id: number) =>
  base.sqlite.prepare('SELECT total_ht, total_tva, total_ttc FROM factures WHERE id = ?').get(id)
const lignesDeLaFacture = (id: number) => base.sqlite.prepare(
  `SELECT prix_unitaire_ht, prix_unitaire_ttc, mode_calcul, total_ht, total_tva, total_ttc
   FROM lignes_document WHERE document_type = 'facture' AND document_id = ? ORDER BY ordre`,
).all(id)

describe('createFacture() — lignes saisies en TTC', () => {
  it('19,99 € TTC × 3 → 59,97 € facturés, ligne stockée en mode TTC (PU HT déduit 16,66)', async () => {
    const { facture_id } = await facturer([{ description: 'Câble', quantite: 3, prix_unitaire_ttc: 19.99, tva_taux: 20 }])
    expect(factureEnBase(facture_id)).toEqual({ total_ht: 49.98, total_tva: 9.99, total_ttc: 59.97 })
    expect(lignesDeLaFacture(facture_id)).toEqual([{
      prix_unitaire_ht: 16.66, prix_unitaire_ttc: 19.99, mode_calcul: 'ttc',
      total_ht: 49.98, total_tva: 9.99, total_ttc: 59.97,
    }])
  })

  it('émise : journal NF525 à 59,97 € TTC, chaîne intègre', async () => {
    await facturer([{ description: 'Câble', quantite: 3, prix_unitaire_ttc: 19.99, tva_taux: 20 }])
    const journal = base.sqlite.prepare('SELECT montant_ht, montant_tva, montant_ttc FROM journal_nf525').all()
    expect(journal).toEqual([{ montant_ht: 49.98, montant_tva: 9.99, montant_ttc: 59.97 }])
    expect((await verifierIntegriteChaine(new D1DatabaseAdapter(base.d1), 1)).integre).toBe(true)
  })

  it('document mêlant une ligne HT (ancienne page) et une ligne TTC : totaux = somme des lignes', async () => {
    const { facture_id } = await facturer([
      { description: 'Main d\'œuvre', quantite: 1, prix_unitaire_ht: 40, tva_taux: 20 },     // 40 + 8 = 48
      { description: 'Livre',         quantite: 2, prix_unitaire_ttc: 7.77, tva_taux: 5.5 }, // 15,54 TTC
    ])
    expect(lignesDeLaFacture(facture_id).map((l: any) => l.mode_calcul)).toEqual(['ht', 'ttc'])
    // Ligne TTC : HT = arrondi(15,54 ÷ 1,055) = 14,73 ; TVA = 0,81
    expect(factureEnBase(facture_id)).toEqual({ total_ht: 54.73, total_tva: 8.81, total_ttc: 63.54 })
  })

  it('ligne HT seule : ancien calcul inchangé (220 € HT → 264 €), mode HT', async () => {
    const { facture_id } = await facturer([{ description: 'Écran', quantite: 1, prix_unitaire_ht: 220, tva_taux: 20 }])
    expect(lignesDeLaFacture(facture_id)).toEqual([{
      prix_unitaire_ht: 220, prix_unitaire_ttc: null, mode_calcul: 'ht',
      total_ht: 220, total_tva: 44, total_ttc: 264,
    }])
  })

  it('prix TTC négatif : refusé, rien écrit', async () => {
    await expect(facturer([{ description: 'Câble', quantite: 1, prix_unitaire_ttc: -1, tva_taux: 20 }])).rejects.toThrow(/prix/i)
    expect(base.sqlite.prepare('SELECT COUNT(*) AS nombre FROM factures').get()).toEqual({ nombre: 0 })
  })
})

describe('convertirDevis() — chaque ligne garde son mode et son prix unitaire', () => {
  it('une ligne de devis en TTC devient une ligne de facture en TTC, au même prix', async () => {
    base.sqlite.exec(`
      INSERT INTO devis (id, boutique_id, client_id, numero, statut, total_ht, total_tva, total_ttc)
        VALUES (1, 1, 1, 'DEV-1', 'envoye', 49.98, 9.99, 59.97);
      INSERT INTO lignes_document (document_type, document_id, ordre, description, quantite,
          prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc, prix_unitaire_ttc, mode_calcul)
        VALUES ('devis', 1, 1, 'Câble', 3, 16.66, 20, 49.98, 9.99, 59.97, 19.99, 'ttc');
    `)
    const { facture_id } = await convertirDevis(base.d1, 1, 1)
    expect(lignesDeLaFacture(facture_id)).toEqual([{
      prix_unitaire_ht: 16.66, prix_unitaire_ttc: 19.99, mode_calcul: 'ttc',
      total_ht: 49.98, total_tva: 9.99, total_ttc: 59.97,
    }])
  })
})

describe('createAvoir() — en TTC, rend exactement les montants des lignes', () => {
  /** Facture émise de 3 câbles à 19,99 € TTC (59,97 €). */
  async function factureEmise() {
    return (await facturer([{ description: 'Câble', quantite: 3, prix_unitaire_ttc: 19.99, tva_taux: 20 }])).facture_id
  }

  it('avoir de la ligne entière : 49,98 HT / 9,99 TVA / 59,97 TTC, comme la ligne de facture', async () => {
    const factureId = await factureEmise()
    const { id } = await createAvoir(base.d1, 1, {
      facture_id: factureId, motif: 'Retour',
      lignes: [{ description: 'Câble', quantite: 3, prix_unitaire_ttc: 19.99, tva_taux: 20 }],
    } as any)
    expect(base.sqlite.prepare('SELECT total_ht, total_tva, total_ttc FROM avoirs WHERE id = ?').get(id))
      .toEqual({ total_ht: 49.98, total_tva: 9.99, total_ttc: 59.97 })
    expect(base.sqlite.prepare('SELECT prix_unitaire_ht, total_ht, total_tva, total_ttc FROM lignes_avoir WHERE avoir_id = ?').all(id))
      .toEqual([{ prix_unitaire_ht: 16.66, total_ht: 49.98, total_tva: 9.99, total_ttc: 59.97 }])
    expect((await verifierIntegriteChaine(new D1DatabaseAdapter(base.d1), 1)).integre).toBe(true)
  })

  it('prix illisible ou négatif : refusé avant tout numéro d\'avoir, rien au journal', async () => {
    const factureId = await factureEmise()
    for (const prix of [Number.NaN, -1]) {
      await expect(createAvoir(base.d1, 1, {
        facture_id: factureId, motif: 'Retour',
        lignes: [{ description: 'Câble', quantite: 1, prix_unitaire_ttc: prix, tva_taux: 20 }],
      } as any)).rejects.toThrow(/prix/i)
    }
    expect(base.sqlite.prepare('SELECT COUNT(*) AS nombre FROM avoirs').get()).toEqual({ nombre: 0 })
    expect(base.sqlite.prepare("SELECT COUNT(*) AS nombre FROM journal_nf525 WHERE type_transaction = 'avoir'").get()).toEqual({ nombre: 0 })
  })

  it.each([
    ['en texte', '20'],
    ['hors liste', 7],
    ['à -100 % (division par zéro)', -100],
  ])('taux de TVA %s : refusé avant tout numéro d\'avoir (revue du ticket 03)', async (_cas, taux) => {
    const factureId = await factureEmise()
    await expect(createAvoir(base.d1, 1, {
      facture_id: factureId, motif: 'Retour',
      lignes: [{ description: 'Câble', quantite: 1, prix_unitaire_ttc: 120, tva_taux: taux }],
    } as any)).rejects.toThrow(/tva/i)
    expect(base.sqlite.prepare('SELECT COUNT(*) AS nombre FROM avoirs').get()).toEqual({ nombre: 0 })
  })

  it('avoir à 5,5 % sur une ligne à 5,5 % : 2 × 7,77 € TTC → 14,73 HT / 0,81 TVA / 15,54 TTC', async () => {
    const { facture_id } = await facturer([{ description: 'Livre', quantite: 2, prix_unitaire_ttc: 7.77, tva_taux: 5.5 }])
    const { id } = await createAvoir(base.d1, 1, {
      facture_id, motif: 'Retour',
      lignes: [{ description: 'Livre', quantite: 2, prix_unitaire_ttc: 7.77, tva_taux: 5.5 }],
    } as any)
    expect(base.sqlite.prepare('SELECT total_ht, total_tva, total_ttc FROM avoirs WHERE id = ?').get(id))
      .toEqual({ total_ht: 14.73, total_tva: 0.81, total_ttc: 15.54 })
  })

  it('avoir d\'une ligne HT (acompte annulé depuis un ticket) : ancien calcul inchangé', async () => {
    const factureId = await factureEmise()
    const { id } = await createAvoir(base.d1, 1, {
      facture_id: factureId, motif: 'Acompte annulé',
      lignes: [{ description: 'Acompte', quantite: 1, prix_unitaire_ht: 41.67, tva_taux: 20 }],
    } as any)
    expect(base.sqlite.prepare('SELECT total_ht, total_tva, total_ttc FROM avoirs WHERE id = ?').get(id))
      .toEqual({ total_ht: 41.67, total_tva: 8.33, total_ttc: 50 })
  })
})

describe('emettreFacture() — brouillon d\'avant la bascule', () => {
  it('un brouillon tout en HT s\'émet avec ses montants d\'origine', async () => {
    const { facture_id } = await facturer([{ description: 'Écran', quantite: 1, prix_unitaire_ht: 220, tva_taux: 20 }], 'brouillon')
    await emettreFacture(base.d1, facture_id, 1)
    expect(factureEnBase(facture_id)).toEqual({ total_ht: 220, total_tva: 44, total_ttc: 264 })
  })
})
