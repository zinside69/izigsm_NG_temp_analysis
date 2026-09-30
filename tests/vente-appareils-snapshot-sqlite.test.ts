import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { createVente } from '../src/services/caisseService'

/**
 * Vente d'occasion en caisse (ticket 07 `vente-lit-catalogue`, story 22) : la facture d'une vente
 * POS **fige** l'identité des appareils vendus — marque, modèle (nom du produit), IMEI — pour la
 * garantie légale. Corriger ensuite la fiche produit ne change pas le document émis.
 *
 * Règle portée par l'ORDRE des écritures (`CLAUDE.md` § Factures) : l'instantané est écrit par
 * l'UPDATE post-journal existant, dans la même instruction que le verrouillage — jamais avant le
 * journal NF525, jamais par un troisième site. Prouvé contre un vrai SQLite au schéma réel (toutes
 * les migrations) : un mock rendrait ce qu'on lui configure, quel que soit l'ordre.
 */

const IMEI_A = '356938035643809'
const IMEI_B = '490154203237518'

let base: BaseReelle

beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec(`
    INSERT INTO boutiques (id, nom) VALUES (1, 'Boutique 1');
    INSERT INTO users (id, email, password_hash, prenom, nom, role_id, boutique_id, actif)
      VALUES (1, 'vendeur@b1.fr', 'x', 'Vente', 'Deur', 2, 1, 1);
  `)
})

function produit(p: { nom: string; marque?: string | null; imei?: string | null }): number {
  return Number(base.sqlite.prepare(
    'INSERT INTO produits (boutique_id, nom, marque, imei, prix_vente_ht, tva_taux, stock_actuel) VALUES (1, ?, ?, ?, 250, 20, 1)',
  ).run(p.nom, p.marque ?? null, p.imei ?? null).lastInsertRowid)
}

function vendre(lignes: { produit_id?: number; designation: string }[]) {
  return createVente(base.d1, 1, 1, {
    lignes: lignes.map(l => ({ ...l, quantite: 1, prix_unitaire_ht: 250, tva_taux: 20 })),
    mode_paiement: 'cb',
  } as any)
}

const factureDe = (id: number) =>
  base.sqlite.prepare('SELECT locked, appareils_snapshot FROM factures WHERE id = ?').get(id)

describe('createVente() — identité des appareils figée', () => {
  it('fige marque, modèle (nom du produit) et IMEI d\'un appareil vendu, avec le verrouillage', async () => {
    const id = produit({ nom: 'iPhone 12 128 Go noir — occasion', marque: 'Apple', imei: IMEI_A })
    const { facture } = await vendre([{ produit_id: id, designation: 'iPhone 12 occasion' }])

    const f = factureDe(facture.id)
    expect(f.locked).toBe(1)
    expect(JSON.parse(f.appareils_snapshot)).toEqual([
      { produit_id: id, designation: 'iPhone 12 occasion', marque: 'Apple', modele: 'iPhone 12 128 Go noir — occasion', imei: IMEI_A },
    ])
  })

  it('deux appareils dans la même vente → deux entrées ; une ligne sans IMEI n\'en crée pas', async () => {
    const a = produit({ nom: 'iPhone 12', marque: 'Apple', imei: IMEI_A })
    const b = produit({ nom: 'Galaxy S21', marque: 'Samsung', imei: IMEI_B })
    const coque = produit({ nom: 'Coque' })
    const { facture } = await vendre([
      { produit_id: a, designation: 'iPhone' },
      { produit_id: coque, designation: 'Coque' },
      { produit_id: b, designation: 'Galaxy' },
    ])
    const snapshot = JSON.parse(factureDe(facture.id).appareils_snapshot)
    expect(snapshot.map((e: any) => e.imei)).toEqual([IMEI_A, IMEI_B])
  })

  it('aucune ligne portant un IMEI → colonne NULL', async () => {
    const coque = produit({ nom: 'Coque' })
    const { facture } = await vendre([{ produit_id: coque, designation: 'Coque' }, { designation: 'Ligne libre' }])
    expect(factureDe(facture.id).appareils_snapshot).toBeNull()
  })

  it('journal NF525 en échec → ni verrouillage ni instantané (comportement inchangé)', async () => {
    const id = produit({ nom: 'iPhone 12', marque: 'Apple', imei: IMEI_A })
    base.sqlite.exec(`CREATE TRIGGER journal_en_panne BEFORE INSERT ON journal_nf525
                      BEGIN SELECT RAISE(ABORT, 'journal en panne'); END;`)
    await expect(vendre([{ produit_id: id, designation: 'iPhone' }])).rejects.toThrow()
    const f = base.sqlite.prepare('SELECT locked, appareils_snapshot FROM factures ORDER BY id DESC LIMIT 1').get()
    expect(f).toEqual({ locked: 0, appareils_snapshot: null })
  })

  it('la fiche produit corrigée après la vente ne change pas la facture émise', async () => {
    const id = produit({ nom: 'iPhone 12', marque: 'Apple', imei: IMEI_A })
    const { facture } = await vendre([{ produit_id: id, designation: 'iPhone' }])
    const avant = factureDe(facture.id).appareils_snapshot

    base.sqlite.prepare('UPDATE produits SET nom = ?, marque = ?, imei = ? WHERE id = ?')
      .run('Nom corrigé', 'Autre', IMEI_B, id)
    expect(factureDe(facture.id).appareils_snapshot).toBe(avant)
    expect(JSON.parse(avant)[0]).toMatchObject({ modele: 'iPhone 12', marque: 'Apple', imei: IMEI_A })
  })

  it('l\'instantané n\'entre pas dans les données hashées du journal (format A inchangé)', async () => {
    const id = produit({ nom: 'iPhone 12', marque: 'Apple', imei: IMEI_A })
    const { journal } = await vendre([{ produit_id: id, designation: 'iPhone' }])
    expect(journal.donnees_hash).not.toContain(IMEI_A)
    expect(journal.donnees_hash.split('|')[0]).toBe('vente')
  })
})
