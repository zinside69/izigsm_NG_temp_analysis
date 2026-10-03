import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { D1DatabaseAdapter } from '../src/adapters/cloudflare/d1Database'
import { cloturerJournee } from '../src/services/caisseService'

/**
 * Clôture journalière NF525 « tout ou rien » (défaut ouvert le 2026-10-02, `bugs.md` ; décision de
 * l'exploitant du 2026-10-03 : `batch()` ajouté au port `Database`).
 *
 * `cloturerJournee()` écrit deux choses : le marquage des ventes du jour au journal
 * (`est_cloture = 1`) et la ligne de clôture. Écrites l'une après l'autre, un échec de la seconde
 * laissait les ventes « clôturées » sans clôture — et un nouvel essai répondait « Aucune transaction
 * à clôturer » : la journée ne pouvait plus jamais être clôturée.
 *
 * Preuve contre un vrai SQLite au schéma réel : un déclencheur fait échouer l'enregistrement de la
 * clôture ; le marquage doit être annulé avec lui, et un nouvel essai doit réussir.
 */

let base: BaseReelle

beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec(`INSERT INTO boutiques (id, nom) VALUES (1, 'B1')`)
  base.sqlite.exec(`INSERT INTO users (id, email, password_hash, prenom, nom, role_id, boutique_id, actif)
    VALUES (1, 'm1@b1.fr', 'x', 'M', 'Un', 2, 1, 1)`)
  base.sqlite.exec(`INSERT INTO journal_nf525
    (boutique_id, type_transaction, reference_id, reference_numero, montant_ht, montant_tva, montant_ttc,
     date_transaction, hash_precedent, donnees_hash, hash_courant, user_id)
    VALUES (1, 'vente', 101, 'FAC-101', 10, 2, 12, '2026-10-03 10:00:00', '', 'x', 'h101', 1)`)
})

/** Nombre de ventes du jour encore à clôturer au journal. */
function ventesNonCloturees(): number {
  return base.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM journal_nf525 WHERE boutique_id = 1 AND est_cloture = 0",
  ).get().n
}

describe('cloturerJournee() — tout ou rien', () => {
  it('l\'enregistrement de la clôture échoue → le journal n\'est pas marqué, un nouvel essai réussit', async () => {
    const db = new D1DatabaseAdapter(base.d1)

    // Panne simulée au moment d'enregistrer la clôture
    base.sqlite.exec(`CREATE TRIGGER panne_cloture BEFORE INSERT ON clotures_journalieres
      BEGIN SELECT RAISE(ABORT, 'panne simulée'); END`)
    await expect(cloturerJournee(db, 1, 1, '2026-10-03')).rejects.toThrow(/panne simulée/)

    expect(ventesNonCloturees(), 'le marquage doit être annulé avec la clôture').toBe(1)
    expect(base.sqlite.prepare('SELECT COUNT(*) AS n FROM clotures_journalieres').get().n).toBe(0)

    // La panne passée, la journée se clôture normalement
    base.sqlite.exec('DROP TRIGGER panne_cloture')
    const cloture = await cloturerJournee(db, 1, 1, '2026-10-03')
    expect(cloture.nb_transactions).toBe(1)
    expect(cloture.total_ttc).toBe(12)
    expect(ventesNonCloturees()).toBe(0)
  })
})
