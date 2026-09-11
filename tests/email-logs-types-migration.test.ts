import { describe, it, expect, beforeEach } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync, readdirSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
// @ts-ignore node:sqlite types not available without @types/node — moteur SQLite intégré à Node 24
import { DatabaseSync } from 'node:sqlite'

/**
 * Migration du CHECK de `email_logs.type` — 🔴 P1 du 2026-09-11 (`bugs.md`).
 *
 * La migration 0020 n'admet que `ticket_cree | ticket_termine | sav_ouvert | relance | autre`,
 * alors que le code écrit aussi `ticket_livre` et `relance_devis`. Ces emails partaient sans
 * ligne, et l'anti-doublon des relances de devis — qui lit cette ligne — ne pouvait pas
 * fonctionner : chaque lancement relançait le même client.
 *
 * Testé contre un VRAI moteur SQLite (`node:sqlite`), jamais un mock : une contrainte CHECK et
 * une recréation de table ne se simulent pas. Les migrations sont rejouées depuis leurs
 * fichiers, chacune dans une transaction — comme D1, qui ignore alors `PRAGMA foreign_keys=OFF`
 * (piège mesuré le 2026-08-02, `CLAUDE.md` § Factures).
 */

// @ts-ignore process types not available without @types/node
const DOSSIER_MIGRATIONS = join(process.cwd(), 'migrations')

/** Instructions de 0020 qui concernent `email_logs` (0020 modifie aussi boutique_settings). */
function schemaInitialEmailLogs(): string {
  const sql = readFileSync(join(DOSSIER_MIGRATIONS, '0020_email_notifications.sql'), 'utf8')
  return sql.split(';').filter((instr: string) => instr.includes('email_logs')).join(';\n') + ';'
}

/** Migrations postérieures à 0020 qui touchent `email_logs`, dans l'ordre d'application. */
function migrationsSuivantes(): string[] {
  return readdirSync(DOSSIER_MIGRATIONS)
    .filter((f: string) => f.endsWith('.sql') && f > '0020_' && !f.startsWith('0020_'))
    .sort()
    .filter((f: string) => readFileSync(join(DOSSIER_MIGRATIONS, f), 'utf8').includes('email_logs'))
}

/** Insère une ligne minimale ; lève si une contrainte la refuse. */
function inserer(db: any, type: string, statut = 'envoye') {
  db.prepare(
    `INSERT INTO email_logs (boutique_id, destinataire, sujet, type, statut) VALUES (1, 'c@example.com', 'Sujet', ?, ?)`,
  ).run(type, statut)
}

describe('email_logs — types admis après migration', () => {
  let db: any

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')                        // comme D1
    db.exec('CREATE TABLE boutiques (id INTEGER PRIMARY KEY)')
    db.exec('INSERT INTO boutiques (id) VALUES (1)')
    db.exec(schemaInitialEmailLogs())

    // Une ligne antérieure à la migration, qui doit lui survivre à l'identique.
    db.exec(`INSERT INTO email_logs (id, boutique_id, destinataire, sujet, type, entite_type, entite_id, statut, provider_id, created_at)
             VALUES (7, 1, 'ancien@example.com', 'Ancien', 'ticket_cree', 'ticket', 42, 'envoye', 're_ancien', '2026-07-15 16:40:40')`)

    for (const fichier of migrationsSuivantes()) {
      db.exec('BEGIN')
      db.exec(readFileSync(join(DOSSIER_MIGRATIONS, fichier), 'utf8'))
      db.exec('COMMIT')
    }
  })

  for (const type of ['ticket_livre', 'relance_devis']) {
    it(`accepte le type ${type}, écrit par le code`, () => {
      expect(() => inserer(db, type), `${type} doit pouvoir être journalisé`).not.toThrow()
    })
  }

  it('conserve à l\'identique les lignes antérieures à la migration', () => {
    const ligne = db.prepare('SELECT * FROM email_logs WHERE id = 7').get()
    expect(ligne).toMatchObject({
      boutique_id: 1, destinataire: 'ancien@example.com', type: 'ticket_cree',
      entite_type: 'ticket', entite_id: 42, statut: 'envoye', provider_id: 're_ancien',
      created_at: '2026-07-15 16:40:40',
    })
  })

  it('garde les trois index', () => {
    const index = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'email_logs' AND sql IS NOT NULL ORDER BY name`,
    ).all().map((r: any) => r.name)
    expect(index).toEqual(['idx_email_logs_boutique', 'idx_email_logs_entite', 'idx_email_logs_type'])
  })

  it('refuse toujours un type inconnu — la contrainte est élargie, pas supprimée', () => {
    expect(() => inserer(db, 'typo_inconnu')).toThrow(/CHECK constraint failed/)
  })

  it('laisse le statut inchangé — « desactive » reste refusé (décision du 2026-09-11)', () => {
    expect(() => inserer(db, 'autre', 'desactive')).toThrow(/CHECK constraint failed/)
  })
})
