import { describe, it, expect, beforeEach } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync, readdirSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'

/**
 * Migration 0068 (ticket 01 du chantier avoirs, décisions Q9, Q10, Q15 de l'exploitant du 2026-10-06) :
 * - les lignes d'avoir reçoivent un prix unitaire TTC et un mode de calcul (lignes existantes : `ht`) ;
 * - la clôture reçoit trois colonnes « avoirs émis » (clôtures existantes : 0, rien d'autre ne change) ;
 * - reprise : une facture entièrement couverte par ses avoirs passe « annulee » ; une facture partiellement
 *   couverte, ou sans avoir, n'est pas touchée.
 *
 * Contre un vrai SQLite au schéma réel, arrêté juste avant 0068.
 */

// @ts-ignore process types not available without @types/node
const DOSSIER_MIGRATIONS = join(process.cwd(), 'migrations')
const FICHIER_0068 = (readdirSync(DOSSIER_MIGRATIONS) as string[]).find(nom => nom.startsWith('0068_'))!
const MIGRATION_0068 = readFileSync(join(DOSSIER_MIGRATIONS, FICHIER_0068), 'utf8')

let base: BaseReelle

/** Facture émise de la boutique 1, de `totalTtc` €, à l'état donné. */
function facture(id: number, totalTtc: number, statut: string) {
  base.sqlite.prepare(`
    INSERT INTO factures (id, boutique_id, numero, client_id, total_ttc, statut, locked)
    VALUES (?, 1, ?, 1, ?, ?, 1)
  `).run(id, `FAC-2026-0000${id}`, totalTtc, statut)
}

/** Avoir de `totalTtc` € sur la facture. */
function avoir(id: number, factureId: number, totalTtc: number) {
  base.sqlite.prepare(`
    INSERT INTO avoirs (id, boutique_id, numero, facture_id, client_id, motif, total_ttc)
    VALUES (?, 1, ?, ?, 1, 'Retour', ?)
  `).run(id, `AV-2026-0000${id}`, factureId, totalTtc)
}

const etat = (factureId: number) =>
  (base.sqlite.prepare('SELECT statut FROM factures WHERE id = ?').get(factureId) as any).statut

beforeEach(() => {
  base = baseAuSchemaReel('0068')
  base.sqlite.exec(`
    INSERT INTO boutiques (id, nom) VALUES (1, 'B1');
    INSERT INTO users (id, email, password_hash, prenom, nom, role_id, boutique_id, actif)
      VALUES (1, 'manager@b1.fr', 'x', 'Man', 'Ager', 2, 1, 1);
    INSERT INTO clients (id, boutique_id, prenom, nom) VALUES (1, 1, 'Jeanne', 'Client');
  `)
  facture(1, 70.52, 'en_attente')   // couverte par un avoir total (cas de FAC-2026-00009)
  avoir(1, 1, 70.52)
  facture(2, 59.97, 'payee')        // couverte par deux avoirs partiels
  avoir(2, 2, 30)
  avoir(3, 2, 29.97)
  facture(3, 59.97, 'en_attente')   // partiellement couverte
  avoir(4, 3, 30)
  facture(4, 12, 'en_attente')      // sans avoir
  base.sqlite.exec(`
    INSERT INTO lignes_avoir (avoir_id, description, quantite, prix_unitaire_ht, total_ttc) VALUES (1, 'Câble', 1, 58.77, 70.52);
    INSERT INTO clotures_journalieres (boutique_id, date_cloture, nb_transactions, total_ttc, hash_cloture, user_id)
      VALUES (1, '2026-10-03', 3, 106.8, 'empreinte-n1', 1);
  `)
})

describe('migration 0068 — reprise : facture couverte → annulee', () => {
  it('couverte par un avoir total → annulee ; par deux avoirs qui couvrent → annulee', () => {
    base.sqlite.exec(MIGRATION_0068)
    expect(etat(1)).toBe('annulee')
    expect(etat(2)).toBe('annulee')
  })

  it('partiellement couverte, ou sans avoir → état inchangé', () => {
    base.sqlite.exec(MIGRATION_0068)
    expect(etat(3)).toBe('en_attente')
    expect(etat(4)).toBe('en_attente')
  })

  it('le contenu des factures ne bouge pas (seul l\'état change)', () => {
    const lire = () => base.sqlite.prepare('SELECT id, numero, total_ttc, locked FROM factures ORDER BY id').all()
    const avant = lire()
    base.sqlite.exec(MIGRATION_0068)
    expect(lire()).toEqual(avant)
  })
})

describe('migration 0068 — colonnes ajoutées', () => {
  it('ligne d\'avoir existante : prix_unitaire_ttc absent, mode ht', () => {
    base.sqlite.exec(MIGRATION_0068)
    expect(base.sqlite.prepare('SELECT prix_unitaire_ht, prix_unitaire_ttc, mode_calcul FROM lignes_avoir').all())
      .toEqual([{ prix_unitaire_ht: 58.77, prix_unitaire_ttc: null, mode_calcul: 'ht' }])
  })

  it('mode de calcul hors ttc / ht : refusé par la base', () => {
    base.sqlite.exec(MIGRATION_0068)
    expect(() => base.sqlite.exec(
      "INSERT INTO lignes_avoir (avoir_id, description, mode_calcul) VALUES (1, 'X', 'autre')",
    )).toThrow(/CHECK/)
  })

  it('clôture existante : avoirs à 0, total et empreinte intacts', () => {
    base.sqlite.exec(MIGRATION_0068)
    expect(base.sqlite.prepare(
      'SELECT total_ttc, hash_cloture, avoirs_ht, avoirs_tva, avoirs_ttc FROM clotures_journalieres',
    ).all()).toEqual([{ total_ttc: 106.8, hash_cloture: 'empreinte-n1', avoirs_ht: 0, avoirs_tva: 0, avoirs_ttc: 0 }])
  })
})
