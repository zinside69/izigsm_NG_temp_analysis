import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { D1DatabaseAdapter } from '../src/adapters/cloudflare/d1Database'
import { cloturerJournee, verifierIntegriteChaine, getKpisCaisse, getCaisseJournal } from '../src/services/caisseService'
import { createFacture, createAvoir } from '../src/services/factureService'
import { todayParis } from '../src/lib/timezone'

/**
 * Clôture du jour : ventes et avoirs émis séparés (ticket 02 du chantier avoirs, décisions Q9 et Q14 de
 * l'exploitant du 2026-10-06). La clôture additionnait toutes les écritures du journal NF525 du jour, avoirs
 * compris, EN POSITIF : un jour où un avoir est émis, le total clôturé était faux.
 * - total de la clôture = ventes seules ;
 * - avoirs du jour dans `avoirs_ht`, `avoirs_tva`, `avoirs_ttc` (migration 0068) ;
 * - l'empreinte garde son format : toutes les écritures du jour enchaînées, avoirs compris.
 *
 * Contre un vrai SQLite au schéma réel. Montants calculés à la main.
 */

let base: BaseReelle

/** Une écriture du journal NF525 de la boutique 1, le 2026-10-07. */
function ecriture(id: number, type: string, ht: number, tva: number, ttc: number) {
  base.sqlite.prepare(`
    INSERT INTO journal_nf525
      (boutique_id, type_transaction, reference_id, reference_numero, montant_ht, montant_tva, montant_ttc,
       date_transaction, hash_precedent, donnees_hash, hash_courant, user_id)
    VALUES (1, ?, ?, ?, ?, ?, ?, '2026-10-07 10:00:00', '', 'x', ?, 1)
  `).run(type, id, `REF-${id}`, ht, tva, ttc, `h${id}`)
}

beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec(`
    INSERT INTO boutiques (id, nom) VALUES (1, 'B1');
    INSERT INTO users (id, email, password_hash, prenom, nom, role_id, boutique_id, actif)
      VALUES (1, 'm1@b1.fr', 'x', 'M', 'Un', 2, 1, 1);
    INSERT INTO clients (id, boutique_id, prenom, nom) VALUES (1, 1, 'Jeanne', 'Client');
  `)
})

describe('cloturerJournee() — ventes et avoirs émis séparés', () => {
  it('une vente de 120 € et un avoir de 30 € : total des ventes 120 €, avoirs 30 € à part', async () => {
    ecriture(1, 'vente', 100, 20, 120)
    ecriture(2, 'avoir', 25, 5, 30)
    const cloture: any = await cloturerJournee(new D1DatabaseAdapter(base.d1), 1, 1, '2026-10-07')
    expect([cloture.total_ht, cloture.total_tva, cloture.total_ttc]).toEqual([100, 20, 120])
    expect([cloture.avoirs_ht, cloture.avoirs_tva, cloture.avoirs_ttc]).toEqual([25, 5, 30])
    expect(cloture.nb_transactions).toBe(2)
    expect(base.sqlite.prepare('SELECT total_ttc, avoirs_ttc FROM clotures_journalieres').get())
      .toEqual({ total_ttc: 120, avoirs_ttc: 30 })
  })

  it('l\'empreinte enchaîne toutes les écritures du jour, avoir compris (format inchangé)', async () => {
    ecriture(1, 'vente', 100, 20, 120)
    ecriture(2, 'avoir', 25, 5, 30)
    const cloture: any = await cloturerJournee(new D1DatabaseAdapter(base.d1), 1, 1, '2026-10-07')
    const attendue = Array.from(new Uint8Array(await crypto.subtle.digest(
      // Première clôture de la boutique : clôture précédente = genèse (64 zéros)
      'SHA-256', new TextEncoder().encode(`cloture|2026-10-07|2|12000|h1|h2|${'0'.repeat(64)}`),
    ))).map(octet => octet.toString(16).padStart(2, '0')).join('')
    expect(cloture.hash_cloture).toBe(attendue)
  })

  it('jour sans avoir : résultat identique à avant (avoirs à 0)', async () => {
    ecriture(1, 'vente', 10, 2, 12)
    const cloture: any = await cloturerJournee(new D1DatabaseAdapter(base.d1), 1, 1, '2026-10-07')
    expect([cloture.total_ttc, cloture.avoirs_ttc]).toEqual([12, 0])
  })

  it('CA du jour et totaux du journal = ventes seules ; avoirs du jour rendus à part', async () => {
    const { facture_id } = await createFacture(base.d1, 1, {
      boutique_id: 1, client_id: 1, action: 'emettre',
      lignes: [{ description: 'Câble', quantite: 3, prix_unitaire_ttc: 19.99, tva_taux: 20 }],
    } as any)
    await createAvoir(base.d1, 1, {
      facture_id, motif: 'Retour',
      lignes: [{ description: 'Câble', quantite: 1, prix_unitaire_ttc: 19.99, tva_taux: 20 }],
    } as any)
    const db = new D1DatabaseAdapter(base.d1)
    expect((await getKpisCaisse(db, 1)).today.total_ttc).toBe(59.97)
    const journal = await getCaisseJournal(db, 1, todayParis())
    expect(journal.totaux.total_ttc).toBe(59.97)
    expect(journal.totaux_avoirs.total_ttc).toBe(19.99)
  })

  it('journée réelle (facture émise puis avoir) : clôture juste et chaîne NF525 intègre', async () => {
    const { facture_id } = await createFacture(base.d1, 1, {
      boutique_id: 1, client_id: 1, action: 'emettre',
      lignes: [{ description: 'Câble', quantite: 3, prix_unitaire_ttc: 19.99, tva_taux: 20 }],
    } as any)
    await createAvoir(base.d1, 1, {
      facture_id, motif: 'Retour',
      lignes: [{ description: 'Câble', quantite: 1, prix_unitaire_ttc: 19.99, tva_taux: 20 }],
    } as any)
    const db = new D1DatabaseAdapter(base.d1)
    const cloture: any = await cloturerJournee(db, 1, 1, todayParis())
    expect([cloture.total_ttc, cloture.avoirs_ttc]).toEqual([59.97, 19.99])
    expect((await verifierIntegriteChaine(db, 1)).integre).toBe(true)
  })
})
