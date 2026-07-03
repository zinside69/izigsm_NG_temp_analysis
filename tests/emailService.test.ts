/**
 * @file tests/emailService.test.ts
 * @description Tests unitaires — src/services/emailService.ts
 *
 * Couverture :
 *   - getEmailConfig()  — lecture boutique_settings, valeurs par défaut
 *   - sendEmail()       — mode simulé (clé absente), notif désactivée, déduplication
 *   - getEmailStats()   — agrégat KPIs depuis email_logs
 *   - listEmailLogs()   — pagination + filtres type/statut
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import {
  getEmailConfig,
  sendEmail,
  getEmailStats,
  listEmailLogs,
  type EmailConfig,
} from '../src/services/emailService'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SETTINGS_ACTIF = {
  email_provider:              'resend',
  email_api_key:               're_test_key_123',
  email_from:                  'iziGSM <noreply@izigsm.fr>',
  email_notif_ticket_cree:     1,
  email_notif_ticket_termine:  1,
  email_notif_sav_ouvert:      1,
  email_notif_relance:         1,
  boutique_nom:                'iziGSM Paris',
  boutique_email:              'contact@izigsm.fr',
}

const SETTINGS_SANS_CLE = {
  ...SETTINGS_ACTIF,
  email_api_key: null,
}

const SQL_CONFIG = `SELECT email_provider, email_api_key, email_from, email_notif_ticket_cree, email_notif_ticket_termine, email_notif_sav_ouvert, email_notif_relance, b.nom AS boutique_nom, b.email AS boutique_email FROM boutique_settings bs JOIN boutiques b ON b.id = bs.boutique_id WHERE bs.boutique_id = ?`

const SQL_DEDUP = `SELECT id FROM email_logs WHERE boutique_id = ? AND entite_type = ? AND entite_id = ? AND type = ? AND statut IN ('envoye','simule') AND created_at > datetime('now', '-5 minutes') LIMIT 1`

const SQL_LOG_INSERT = `INSERT INTO email_logs (boutique_id, destinataire, sujet, type, entite_type, entite_id, statut, erreur, provider_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

// ─── getEmailConfig ───────────────────────────────────────────────────────────

describe('getEmailConfig()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => { db = createMockD1() })

  it('retourne la config complète quand boutique_settings existe', async () => {
    db.__setResponse(SQL_CONFIG, SETTINGS_ACTIF)
    const config = await getEmailConfig(db, 1)
    expect(config.api_key).toBe('re_test_key_123')
    expect(config.from).toBe('iziGSM <noreply@izigsm.fr>')
    expect(config.notif_ticket_cree).toBe(true)
    expect(config.notif_ticket_termine).toBe(true)
    expect(config.notif_relance).toBe(true)
    expect(config.provider).toBe('resend')
  })

  it('retourne api_key null si clé absente', async () => {
    db.__setResponse(SQL_CONFIG, SETTINGS_SANS_CLE)
    const config = await getEmailConfig(db, 1)
    expect(config.api_key).toBeNull()
  })

  it('applique les valeurs par défaut si boutique_settings est absent', async () => {
    db.__setNotFound(SQL_CONFIG)
    const config = await getEmailConfig(db, 99)
    expect(config.api_key).toBeNull()
    expect(config.provider).toBe('resend')
    // Toutes les notifs actives par défaut
    expect(config.notif_ticket_cree).toBe(true)
    expect(config.notif_ticket_termine).toBe(true)
    expect(config.notif_sav_ouvert).toBe(true)
    expect(config.notif_relance).toBe(true)
  })

  it('notif désactivée si flag = 0 en DB', async () => {
    db.__setResponse(SQL_CONFIG, {
      ...SETTINGS_ACTIF,
      email_notif_relance: 0,
      email_notif_sav_ouvert: 0,
    })
    const config = await getEmailConfig(db, 1)
    expect(config.notif_relance).toBe(false)
    expect(config.notif_sav_ouvert).toBe(false)
    expect(config.notif_ticket_cree).toBe(true)
  })

  it('construit from par défaut depuis nom + email boutique', async () => {
    db.__setResponse(SQL_CONFIG, {
      ...SETTINGS_ACTIF,
      email_from: null,
      boutique_nom: 'Test Shop', boutique_email: 'shop@test.fr',
    })
    const config = await getEmailConfig(db, 1)
    expect(config.from).toBe('Test Shop <shop@test.fr>')
  })
})

// ─── sendEmail — mode simulé ──────────────────────────────────────────────────

describe('sendEmail() — mode simulé (sans clé API)', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setNotFound(SQL_DEDUP)                    // pas de dédup
    db.__setResponse(SQL_CONFIG, SETTINGS_SANS_CLE) // clé absente
  })

  it('retourne success=true, simulated=true', async () => {
    const res = await sendEmail({
      db, boutiqueId: 1,
      to: 'client@example.com',
      sujet: 'Votre réparation',
      html: '<p>Test</p>',
      type: 'ticket_cree',
      entiteType: 'ticket', entiteId: 42,
    })
    expect(res.success).toBe(true)
    expect(res.simulated).toBe(true)
  })

  it('logue statut=simule dans email_logs', async () => {
    await sendEmail({
      db, boutiqueId: 1,
      to: 'client@example.com',
      sujet: 'Votre réparation',
      html: '<p>Test</p>',
      type: 'ticket_cree',
    })
    const calls = db.__getCalls()
    const logCall = calls.find(c => c.sql.includes('INSERT INTO email_logs'))
    expect(logCall).toBeDefined()
    expect(logCall?.params).toContain('simule')
  })
})

// ─── sendEmail — notif désactivée ─────────────────────────────────────────────

describe('sendEmail() — notif désactivée', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setNotFound(SQL_DEDUP)
    db.__setResponse(SQL_CONFIG, {
      ...SETTINGS_ACTIF,
      email_notif_relance: 0,  // relance désactivée
    })
  })

  it('retourne success=true, simulated=true sans loger', async () => {
    const res = await sendEmail({
      db, boutiqueId: 1,
      to: 'client@example.com',
      sujet: 'Relance',
      html: '<p>Relance</p>',
      type: 'relance',
      entiteType: 'ticket', entiteId: 42,
    })
    expect(res.success).toBe(true)
    expect(res.simulated).toBe(true)
    // Pas de log INSERT puisque notif désactivée (retour immédiat avant logEmail)
    const calls = db.__getCalls()
    const logCall = calls.find(c => c.sql.includes('INSERT INTO email_logs'))
    expect(logCall).toBeUndefined()
  })

  it('type "autre" est toujours actif même avec notif=0', async () => {
    // "autre" ignore les flags de notif → passe toujours
    // Mais sans clé : simule quand même
    db.__setResponse(SQL_CONFIG, {
      ...SETTINGS_SANS_CLE,
      email_notif_relance: 0,
    })
    const res = await sendEmail({
      db, boutiqueId: 1,
      to: 'client@example.com',
      sujet: 'Test manuel',
      html: '<p>Test</p>',
      type: 'autre',
    })
    // Sans clé + type autre → simule
    expect(res.success).toBe(true)
    expect(res.simulated).toBe(true)
  })
})

// ─── sendEmail — déduplication ────────────────────────────────────────────────

describe('sendEmail() — déduplication 5 minutes', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse(SQL_CONFIG, SETTINGS_ACTIF)
  })

  it('skip si même (entite_id, type) dans les 5 dernières minutes', async () => {
    db.__setResponse(SQL_DEDUP, { id: 77 }) // dédup trouvé
    const res = await sendEmail({
      db, boutiqueId: 1,
      to: 'client@example.com',
      sujet: 'Doublon',
      html: '<p>Test</p>',
      type: 'ticket_cree',
      entiteType: 'ticket', entiteId: 42,
    })
    // Retour immédiat, pas de log
    expect(res.success).toBe(true)
    expect(res.simulated).toBe(false)
    const calls = db.__getCalls()
    const logCall = calls.find(c => c.sql.includes('INSERT INTO email_logs'))
    expect(logCall).toBeUndefined()
  })

  it('ne déduplique pas si entiteId absent', async () => {
    db.__setNotFound(SQL_DEDUP)
    db.__setResponse(SQL_CONFIG, SETTINGS_SANS_CLE)
    const res = await sendEmail({
      db, boutiqueId: 1,
      to: 'test@example.com',
      sujet: 'Test sans entite',
      html: '<p>Test</p>',
      type: 'autre',
      // pas de entiteId → pas de check dédup
    })
    expect(res.success).toBe(true)
  })
})

// ─── getEmailStats ────────────────────────────────────────────────────────────

describe('getEmailStats()', () => {
  let db: ReturnType<typeof createMockD1>

  // Trois requêtes en Promise.all dans getEmailStats
  const SQL_TOTAL    = `SELECT COUNT(*) as cnt FROM email_logs WHERE boutique_id = ? AND statut='envoye'`
  const SQL_MOIS     = `SELECT SUM(CASE WHEN statut='envoye' THEN 1 ELSE 0 END) AS envoyes, SUM(CASE WHEN statut='erreur' THEN 1 ELSE 0 END) AS erreurs, SUM(CASE WHEN statut='simule' THEN 1 ELSE 0 END) AS simules FROM email_logs WHERE boutique_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`
  const SQL_PAR_TYPE = `SELECT type, COUNT(*) as cnt FROM email_logs WHERE boutique_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') GROUP BY type`

  beforeEach(() => { db = createMockD1() })

  it('retourne les KPIs correctement', async () => {
    db.__setResponse(SQL_TOTAL, { cnt: 120 })
    db.__setResponse(SQL_MOIS, { envoyes: 25, erreurs: 3, simules: 8 })
    db.__setListResponse(SQL_PAR_TYPE, [
      { type: 'ticket_cree', cnt: 50 },
      { type: 'ticket_termine', cnt: 40 },
      { type: 'relance', cnt: 30 },
    ])

    const res = await getEmailStats(db, 1)
    expect(res.envoyes_total).toBe(120)
    expect(res.envoyes_mois).toBe(25)
    expect(res.erreurs_mois).toBe(3)
    expect(res.simules_mois).toBe(8)
    // par_type est un Record<string, number> (pas un tableau)
    expect(res.par_type['ticket_cree']).toBe(50)
    expect(res.par_type['relance']).toBe(30)
  })

  it('retourne 0 pour tous les KPIs si aucun log', async () => {
    db.__setResponse(SQL_TOTAL, { cnt: 0 })
    db.__setResponse(SQL_MOIS, { envoyes: 0, erreurs: 0, simules: 0 })
    db.__setListResponse(SQL_PAR_TYPE, [])

    const res = await getEmailStats(db, 1)
    expect(res.envoyes_total).toBe(0)
    expect(res.envoyes_mois).toBe(0)
    // par_type est un Record vide
    expect(Object.keys(res.par_type)).toHaveLength(0)
  })

  it('config.api_key_set non inclus dans getEmailStats (s\'obtient via getEmailConfig)', async () => {
    // getEmailStats ne retourne pas config — c'est routes/notifications.ts qui combine les deux
    db.__setResponse(SQL_TOTAL, { cnt: 5 })
    db.__setResponse(SQL_MOIS, { envoyes: 5, erreurs: 0, simules: 0 })
    db.__setListResponse(SQL_PAR_TYPE, [])

    const res = await getEmailStats(db, 1)
    expect(res.envoyes_total).toBe(5)
    // Pas de propriété config ici
    expect((res as any).config).toBeUndefined()
  })
})

// ─── listEmailLogs ────────────────────────────────────────────────────────────

describe('listEmailLogs()', () => {
  let db: ReturnType<typeof createMockD1>

  const LOG_ROW = {
    id: 1, boutique_id: 1,
    destinataire: 'client@example.com',
    sujet: 'Votre ticket TKT-2026-00001',
    type: 'ticket_cree', statut: 'envoye',
    erreur: null, provider_id: 'abc123',
    created_at: '2026-07-01T10:00:00',
  }

  // listEmailLogs utilise des WHERE dynamiques selon opts
  const SQL_COUNT = `SELECT COUNT(*) as cnt FROM email_logs WHERE boutique_id = ?`
  const SQL_LIST  = `SELECT id, destinataire, sujet, type, entite_type, entite_id, statut, erreur, created_at FROM email_logs WHERE boutique_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`

  beforeEach(() => { db = createMockD1() })

  it('retourne rows + total', async () => {
    db.__setResponse(SQL_COUNT, { cnt: 3 })
    db.__setListResponse(SQL_LIST, [LOG_ROW, { ...LOG_ROW, id: 2 }, { ...LOG_ROW, id: 3 }])
    // listEmailLogs retourne { rows, total } (pas data/pagination)
    const res = await listEmailLogs(db, 1, { limit: 20, offset: 0 })
    expect(res.rows).toHaveLength(3)
    expect(res.total).toBe(3)
  })

  it('retourne rows vide si aucun log', async () => {
    db.__setResponse(SQL_COUNT, { cnt: 0 })
    db.__setListResponse(SQL_LIST, [])
    const res = await listEmailLogs(db, 1, { limit: 20, offset: 0 })
    expect(res.rows).toEqual([])
    expect(res.total).toBe(0)
  })
})
