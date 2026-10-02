import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { D1DatabaseAdapter } from '../src/adapters/cloudflare/d1Database'
import { cloturerJournee } from '../src/services/caisseService'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync } from 'node:fs'

/**
 * Clôture journalière NF525 — une par boutique ET par jour (trouvé le 2026-10-02, `bugs.md`).
 *
 * La migration 0008 déclarait `date_cloture TEXT NOT NULL UNIQUE` : unicité sur TOUTE la plateforme.
 * La première boutique qui clôturait un jour bloquait toutes les autres, en erreur SQL brute — et,
 * l'`UPDATE` du journal précédant l'`INSERT`, ses ventes restaient marquées clôturées sans clôture.
 * Exposé dès que les managers ont pu clôturer (déploiement du 2026-10-02, rôle `gerant` remplacé).
 *
 * Prouvé contre un vrai SQLite au schéma réel : la règle vit dans une contrainte de table.
 */

let base: BaseReelle

/** Une vente au journal NF525 de la boutique, datée du jour visé. */
function venteAuJournal(boutiqueId: number, id: number) {
  base.sqlite.exec(`INSERT INTO journal_nf525
    (boutique_id, type_transaction, reference_id, reference_numero, montant_ht, montant_tva, montant_ttc,
     date_transaction, hash_precedent, donnees_hash, hash_courant, user_id)
    VALUES (${boutiqueId}, 'vente', ${id}, 'FAC-${id}', 10, 2, 12, '2026-10-02 10:00:00', '', 'x', 'h${id}', ${boutiqueId})`)
}

beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec(`INSERT INTO boutiques (id, nom) VALUES (1, 'B1'), (2, 'B2')`)
  base.sqlite.exec(`INSERT INTO users (id, email, password_hash, prenom, nom, role_id, boutique_id, actif)
    VALUES (1, 'm1@b1.fr', 'x', 'M', 'Un', 2, 1, 1), (2, 'm2@b2.fr', 'x', 'M', 'Deux', 2, 2, 1)`)
  venteAuJournal(1, 101)
  venteAuJournal(2, 201)
})

describe('clôture journalière — une par boutique et par jour', () => {
  it('deux boutiques clôturent le même jour, chacune la sienne', async () => {
    const db = new D1DatabaseAdapter(base.d1)
    const c1 = await cloturerJournee(db, 1, 1, '2026-10-02')
    const c2 = await cloturerJournee(db, 2, 2, '2026-10-02')
    expect(c1.total_ttc).toBe(12)
    expect(c2.total_ttc).toBe(12)
    const n = base.sqlite.prepare(`SELECT COUNT(*) AS n FROM clotures_journalieres WHERE date_cloture = '2026-10-02'`).get() as any
    expect(n.n).toBe(2)
  })

  it('la même boutique ne clôture pas deux fois le même jour (garde de service ET contrainte de table)', async () => {
    const db = new D1DatabaseAdapter(base.d1)
    await cloturerJournee(db, 1, 1, '2026-10-02')
    await expect(cloturerJournee(db, 1, 1, '2026-10-02')).rejects.toThrow(/déjà clôturée/)
    // La contrainte elle-même, sans passer par la garde du service
    expect(() => base.sqlite.exec(`INSERT INTO clotures_journalieres
      (boutique_id, date_cloture, hash_cloture, user_id) VALUES (1, '2026-10-02', 'h', 1)`)).toThrow(/UNIQUE/)
  })
})

describe('migration 0060 — recopie à l\'identique, table append-only', () => {
  it('une clôture existante est conservée telle quelle, identifiant et hash compris', () => {
    const avant = baseAuSchemaReel('0060_clotures_unique_par_boutique.sql')
    avant.sqlite.exec(`INSERT INTO boutiques (id, nom) VALUES (1, 'B1')`)
    avant.sqlite.exec(`INSERT INTO users (id, email, password_hash, prenom, nom, role_id, boutique_id, actif)
      VALUES (1, 'm@b1.fr', 'x', 'M', 'Un', 2, 1, 1)`)
    avant.sqlite.exec(`INSERT INTO clotures_journalieres
      (id, boutique_id, date_cloture, nb_transactions, total_ht, total_tva, total_ttc, hash_cloture, hash_precedent, user_id, created_at)
      VALUES (7, 1, '2026-09-30', 3, 30, 6, 36, 'abc123', 'prev', 1, '2026-09-30 19:00:00')`)

    // @ts-ignore process types not available without @types/node
    avant.sqlite.exec(readFileSync(`${process.cwd()}/migrations/0060_clotures_unique_par_boutique.sql`, 'utf8'))

    const ligne = avant.sqlite.prepare('SELECT * FROM clotures_journalieres WHERE id = 7').get() as any
    expect(ligne).toMatchObject({ boutique_id: 1, date_cloture: '2026-09-30', nb_transactions: 3, total_ttc: 36,
      hash_cloture: 'abc123', hash_precedent: 'prev', user_id: 1, created_at: '2026-09-30 19:00:00' })
    const transit = avant.sqlite.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'clotures_journalieres_transit'`).get() as any
    expect(transit.n).toBe(0)
  })
})
