import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { createFacture, createAvoir } from '../src/services/factureService'
import { verifierIntegriteChaine } from '../src/services/caisseService'
import { D1DatabaseAdapter } from '../src/adapters/cloudflare/d1Database'

/**
 * Avoir plafonné et facture couverte « annulée » (ticket 01 du chantier avoirs, décisions Q5, Q6, Q12
 * de l'exploitant du 2026-10-06) :
 * - le cumul des avoirs d'une facture ne dépasse jamais son total TTC ; un avoir qui le dépasserait est
 *   refusé AVANT l'attribution du numéro (la série d'avoirs reste sans trou) ;
 * - une facture entièrement couverte par ses avoirs passe `annulee`, payée ou non ; un avoir partiel ne
 *   change pas son état ;
 * - une ligne d'avoir saisie en TTC garde son prix unitaire TTC.
 *
 * Contre un vrai SQLite au schéma réel. Montants calculés à la main.
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

// ═══════════════════════════════════════════════════════════════════════════════
// Aides
// ═══════════════════════════════════════════════════════════════════════════════

/** Facture émise de 3 câbles à 19,99 € TTC = 59,97 € (ou émise et encaissée). */
async function factureDe5997(action: 'emettre' | 'emettre_encaisser' = 'emettre'): Promise<number> {
  const resultat = await createFacture(base.d1, 1, {
    boutique_id: 1, client_id: 1, action, mode_paiement: 'Espèces',
    lignes: [{ description: 'Câble', quantite: 3, prix_unitaire_ttc: 19.99, tva_taux: 20 }],
  } as any)
  return resultat.facture_id
}

/** Avoir d'une seule ligne de `montantTtc` € TTC à 20 % sur la facture. */
function avoirDe(factureId: number, montantTtc: number) {
  return createAvoir(base.d1, 1, {
    facture_id: factureId, motif: 'Retour',
    lignes: [{ description: 'Câble', quantite: 1, prix_unitaire_ttc: montantTtc, tva_taux: 20 }],
  } as any)
}

const etatDeLaFacture = (id: number) =>
  (base.sqlite.prepare('SELECT statut FROM factures WHERE id = ?').get(id) as any).statut
const nombreAvoirs = () =>
  (base.sqlite.prepare('SELECT COUNT(*) AS nombre FROM avoirs').get() as any).nombre
/** Dernier numéro d'avoir consommé par la boutique 1 (0 si aucun). */
const dernierNumeroAvoir = () =>
  (base.sqlite.prepare("SELECT dernier_num FROM sequences WHERE boutique_id = 1 AND type = 'avoir'").get() as any)
    ?.dernier_num ?? 0

// ═══════════════════════════════════════════════════════════════════════════════
// Plafond
// ═══════════════════════════════════════════════════════════════════════════════

describe('createAvoir() — plafond : le cumul des avoirs ne dépasse jamais le total TTC de la facture', () => {
  it('avoir de 1 000 € sur une facture de 59,97 € : refusé, aucun avoir, aucun numéro consommé', async () => {
    const factureId = await factureDe5997()
    await expect(avoirDe(factureId, 1000)).rejects.toMatchObject({
      code: 'plafond_depasse', message: expect.stringMatching(/encore annulable : 59,97 €/),
    })
    expect(nombreAvoirs()).toBe(0)
    expect(dernierNumeroAvoir()).toBe(0)
  })

  it('second avoir qui ferait dépasser le cumul : refusé, le message dit le montant encore annulable (29,97 €)', async () => {
    const factureId = await factureDe5997()
    await avoirDe(factureId, 30)
    await expect(avoirDe(factureId, 40)).rejects.toThrow(/29,97/)
    expect(nombreAvoirs()).toBe(1)
    expect(dernierNumeroAvoir()).toBe(1)
  })

  it('facture déjà créditée au-delà de son total (avant le plafond) : refus, montant encore annulable affiché 0,00 €, jamais négatif', async () => {
    const factureId = await factureDe5997()
    // Avoir de 80 € écrit directement, comme l'acceptait le code d'avant le plafond
    base.sqlite.prepare(`INSERT INTO avoirs (boutique_id, numero, facture_id, client_id, motif, total_ttc)
                         VALUES (1, 'AV-ANCIEN', ?, 1, 'Ancien', 80)`).run(factureId)
    await expect(avoirDe(factureId, 1)).rejects.toMatchObject({
      encoreAnnulableCentimes: 0, message: expect.stringMatching(/encore annulable : 0,00 €/),
    })
  })

  it('avoir exactement égal au montant encore annulable : accepté', async () => {
    const factureId = await factureDe5997()
    await avoirDe(factureId, 30)
    await avoirDe(factureId, 29.97)
    expect(nombreAvoirs()).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Facture couverte → « annulée »
// ═══════════════════════════════════════════════════════════════════════════════

describe('createAvoir() — une facture entièrement couverte par ses avoirs passe « annulee »', () => {
  it('avoir total sur une facture en attente → annulee', async () => {
    const factureId = await factureDe5997()
    expect(etatDeLaFacture(factureId)).toBe('en_attente')
    await avoirDe(factureId, 59.97)
    expect(etatDeLaFacture(factureId)).toBe('annulee')
  })

  it('avoir total sur une facture déjà payée → annulee, son paiement reste enregistré', async () => {
    const factureId = await factureDe5997('emettre_encaisser')
    expect(etatDeLaFacture(factureId)).toBe('payee')
    await avoirDe(factureId, 59.97)
    expect(etatDeLaFacture(factureId)).toBe('annulee')
    expect((base.sqlite.prepare('SELECT COUNT(*) AS nombre FROM paiements WHERE facture_id = ?').get(factureId) as any).nombre)
      .toBe(1)
  })

  it('avoir partiel → état inchangé ; le second avoir qui couvre le reste → annulee', async () => {
    const factureId = await factureDe5997()
    await avoirDe(factureId, 30)
    expect(etatDeLaFacture(factureId)).toBe('en_attente')
    await avoirDe(factureId, 29.97)
    expect(etatDeLaFacture(factureId)).toBe('annulee')
  })

  it('l\'avoir porte l\'empreinte NF525 de son écriture au journal (écrite avec l\'état de la facture, en un lot)', async () => {
    const factureId = await factureDe5997()
    const { id, hash_nf525 } = await avoirDe(factureId, 59.97)
    const empreinteDuJournal = (base.sqlite.prepare(
      "SELECT hash_courant FROM journal_nf525 WHERE type_transaction = 'avoir' AND reference_id = ?",
    ).get(id) as any).hash_courant
    expect((base.sqlite.prepare('SELECT hash_nf525 FROM avoirs WHERE id = ?').get(id) as any).hash_nf525)
      .toBe(empreinteDuJournal)
    expect(hash_nf525).toBe(empreinteDuJournal)
  })

  it('le contenu de la facture annulée reste figé (numéro, totaux, verrou, empreinte) et la chaîne NF525 reste intègre', async () => {
    const factureId = await factureDe5997()
    const lireFacture = () => base.sqlite.prepare(
      'SELECT numero, total_ht, total_tva, total_ttc, locked, hash_nf525, vendeur_snapshot, acheteur_snapshot FROM factures WHERE id = ?',
    ).get(factureId)
    const avant = lireFacture()
    await avoirDe(factureId, 59.97)
    expect(lireFacture()).toEqual(avant)
    expect((await verifierIntegriteChaine(new D1DatabaseAdapter(base.d1), 1)).integre).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Ligne d'avoir en TTC
// ═══════════════════════════════════════════════════════════════════════════════

describe('createAvoir() — une ligne saisie en TTC garde son prix unitaire TTC', () => {
  const lignesDeLAvoir = (avoirId: number) => base.sqlite.prepare(
    'SELECT prix_unitaire_ht, prix_unitaire_ttc, mode_calcul FROM lignes_avoir WHERE avoir_id = ? ORDER BY ordre',
  ).all(avoirId)

  it('ligne TTC → prix_unitaire_ttc 19,99 et mode ttc (PU HT déduit 16,66)', async () => {
    const factureId = await factureDe5997()
    const { id } = await avoirDe(factureId, 19.99)
    expect(lignesDeLAvoir(id)).toEqual([{ prix_unitaire_ht: 16.66, prix_unitaire_ttc: 19.99, mode_calcul: 'ttc' }])
  })

  it('ligne HT seule (acompte annulé depuis un ticket) → prix_unitaire_ttc absent, mode ht', async () => {
    const factureId = await factureDe5997()
    const { id } = await createAvoir(base.d1, 1, {
      facture_id: factureId, motif: 'Acompte annulé',
      lignes: [{ description: 'Acompte annulé', quantite: 1, prix_unitaire_ht: 25, tva_taux: 20 }],
    } as any)
    expect(lignesDeLAvoir(id)).toEqual([{ prix_unitaire_ht: 25, prix_unitaire_ttc: null, mode_calcul: 'ht' }])
  })
})
