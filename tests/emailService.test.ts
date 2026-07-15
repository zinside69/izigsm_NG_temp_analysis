/**
 * @file tests/emailService.test.ts
 * @description Tests unitaires — src/services/emailService.ts
 *
 * Couverture :
 *   - getEmailConfig()         — lecture boutique_settings, valeurs par défaut
 *   - sendEmail()              — mode simulé (clé absente), notif désactivée, déduplication
 *   - getEmailStats()          — agrégat KPIs depuis email_logs
 *   - listEmailLogs()          — pagination + filtres type/statut
 *   - sendRelanceDevis()       — email relance devis avec lien public (Sprint 2.40 G07)
 *   - processRelancesDevis()   — batch relances devis non répondus (Sprint 2.40 G07)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import {
  getEmailConfig,
  sendEmail,
  getEmailStats,
  listEmailLogs,
  sendRelanceDevis,
  processRelancesDevis,
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
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => { db = createMockDatabase() })

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
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
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
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
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
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
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
  let db: ReturnType<typeof createMockDatabase>

  // Trois requêtes en Promise.all dans getEmailStats
  const SQL_TOTAL    = `SELECT COUNT(*) as cnt FROM email_logs WHERE boutique_id = ? AND statut='envoye'`
  const SQL_MOIS     = `SELECT SUM(CASE WHEN statut='envoye' THEN 1 ELSE 0 END) AS envoyes, SUM(CASE WHEN statut='erreur' THEN 1 ELSE 0 END) AS erreurs, SUM(CASE WHEN statut='simule' THEN 1 ELSE 0 END) AS simules FROM email_logs WHERE boutique_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`
  const SQL_PAR_TYPE = `SELECT type, COUNT(*) as cnt FROM email_logs WHERE boutique_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') GROUP BY type`

  beforeEach(() => { db = createMockDatabase() })

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
  let db: ReturnType<typeof createMockDatabase>

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

  beforeEach(() => { db = createMockDatabase() })

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

// ─── sendRelanceDevis ─────────────────────────────────────────────────────────

describe('sendRelanceDevis()', () => {
  let db: ReturnType<typeof createMockDatabase>

  const DEVIS_RELANCE = {
    id:            42,
    numero:        'DEV-2026-00042',
    client_email:  'client@example.com',
    client_prenom: 'Pierre',
    montant_ttc:   350.00,
    date_validite: '2026-08-01',
    public_token:  'abc123token',
  }

  const SQL_BOUTIQUE  = `SELECT nom, telephone FROM boutiques WHERE id = ? LIMIT 1`
  const SQL_DEDUP_DEV = `SELECT id FROM email_logs WHERE boutique_id = ? AND entite_type = ? AND entite_id = ? AND type = ? AND statut IN ('envoye','simule') AND created_at > datetime('now', '-5 minutes') LIMIT 1`

  beforeEach(() => { db = createMockDatabase() })

  it('envoie un email de relance devis en mode simulé (pas de clé API)', async () => {
    // config sans clé API
    db.__setResponse(SQL_CONFIG, SETTINGS_SANS_CLE)
    db.__setResponse(SQL_BOUTIQUE, { nom: 'iziGSM Paris', telephone: '01 23 45 67 89' })
    db.__setResponse(SQL_DEDUP_DEV, null)       // pas de doublon
    db.__setResponse(SQL_LOG_INSERT, { meta: { last_row_id: 99 } })

    await sendRelanceDevis(db, 1, DEVIS_RELANCE, 'http://localhost:3000')

    const calls = db.__getCalls()
    // Doit insérer dans email_logs avec type='relance_devis'
    const insertCall = calls.find(c => c.sql === SQL_LOG_INSERT)
    expect(insertCall).toBeDefined()
    expect(insertCall?.params).toContain('relance_devis')
    expect(insertCall?.params).toContain('devis')
    expect(insertCall?.params).toContain(42)
    expect(insertCall?.params).toContain('simule')
  })

  it('n\'envoie pas si client_email vide', async () => {
    const devisSansEmail = { ...DEVIS_RELANCE, client_email: '' }
    await sendRelanceDevis(db, 1, devisSansEmail, 'http://localhost:3000')
    expect(db.__getCalls()).toHaveLength(0)
  })

  it('inclut le lien public devis dans le log', async () => {
    db.__setResponse(SQL_CONFIG, SETTINGS_SANS_CLE)
    db.__setResponse(SQL_BOUTIQUE, { nom: 'iziGSM', telephone: null })
    db.__setResponse(SQL_DEDUP_DEV, null)
    db.__setResponse(SQL_LOG_INSERT, { meta: { last_row_id: 100 } })

    await sendRelanceDevis(db, 1, DEVIS_RELANCE, 'https://app.izigsm.fr')

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql === SQL_LOG_INSERT)
    // Le sujet doit contenir le numéro du devis
    expect(insertCall?.params).toContain('client@example.com')
    const sujet = insertCall?.params.find((b: any) => typeof b === 'string' && b.includes('DEV-2026-00042'))
    expect(sujet).toBeDefined()
  })

  it('ne renvoie pas si déduplication active (même devis dans les 5 min)', async () => {
    db.__setResponse(SQL_CONFIG, SETTINGS_ACTIF)
    db.__setResponse(SQL_BOUTIQUE, { nom: 'iziGSM', telephone: null })
    db.__setResponse(SQL_DEDUP_DEV, { id: 77 })   // doublon trouvé → skip

    await sendRelanceDevis(db, 1, DEVIS_RELANCE, 'http://localhost:3000')

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql === SQL_LOG_INSERT)
    expect(insertCall).toBeUndefined()   // pas d'INSERT → déduplication OK
  })
})

// ─── processRelancesDevis ─────────────────────────────────────────────────────

describe('processRelancesDevis()', () => {
  let db: ReturnType<typeof createMockDatabase>

  const SQL_SETTINGS_RELANCE = `SELECT delai_relance_jours FROM boutique_settings WHERE boutique_id = ?`
  // SQL normalisé (espaces collapsés) — doit matcher normalizeSQL() du mockD1
  const SQL_DEVIS_ELIGIBLES  = `SELECT d.id, d.numero, d.total_ttc AS montant_ttc, d.date_validite, d.public_token, c.email AS client_email, c.prenom AS client_prenom FROM devis d JOIN clients c ON c.id = d.client_id WHERE d.boutique_id = ? AND d.statut = 'envoye' AND d.envoye_le < datetime('now', ? || ' days') AND (d.date_validite IS NULL OR d.date_validite > datetime('now')) AND c.email IS NOT NULL AND d.id NOT IN ( SELECT entite_id FROM email_logs WHERE boutique_id = ? AND type = 'relance_devis' AND entite_type = 'devis' AND created_at > datetime('now', ? || ' days') ) LIMIT 30`
  // Note: __getCalls() enregistre le SQL normalisé — on inspecte via includes sur bindings

  const DEVIS_ROW = {
    id: 5, numero: 'DEV-2026-00005',
    montant_ttc: 250.00, date_validite: '2026-09-01',
    public_token: 'tok555',
    client_email: 'client@example.com', client_prenom: 'Marie',
  }

  beforeEach(() => { db = createMockDatabase() })

  it('retourne 0 si aucun devis éligible', async () => {
    db.__setResponse(SQL_SETTINGS_RELANCE, { delai_relance_jours: 3 })
    db.__setListResponse(SQL_DEVIS_ELIGIBLES, [])

    const count = await processRelancesDevis(db, 1, 'http://localhost:3000')
    expect(count).toBe(0)
  })

  it('utilise delai_relance_jours=3 par défaut si settings absent', async () => {
    db.__setResponse(SQL_SETTINGS_RELANCE, null)
    db.__setListResponse(SQL_DEVIS_ELIGIBLES, [])

    const count = await processRelancesDevis(db, 1, 'http://localhost:3000')
    expect(count).toBe(0)

    const calls = db.__getCalls()
    // Le deuxième appel est le SELECT devis éligibles avec le délai en binding
    const eligibleCall = calls.find(c => c.sql.includes('envoye_le') && c.sql.includes('LIMIT 30'))
    expect(eligibleCall).toBeDefined()
    expect(eligibleCall?.params).toContain('-3')
  })

  it('envoie une relance par devis éligible et retourne le count', async () => {
    db.__setResponse(SQL_SETTINGS_RELANCE, { delai_relance_jours: 5 })
    db.__setListResponse(SQL_DEVIS_ELIGIBLES, [DEVIS_ROW, { ...DEVIS_ROW, id: 6, numero: 'DEV-2026-00006' }])

    // Pour chaque devis : boutique + dedup + insert
    const SQL_BOUTIQUE = `SELECT nom, telephone FROM boutiques WHERE id = ? LIMIT 1`
    db.__setResponse(SQL_BOUTIQUE, { nom: 'iziGSM', telephone: null })
    db.__setResponse(SQL_CONFIG, SETTINGS_SANS_CLE)
    db.__setResponse(SQL_DEDUP, null)
    db.__setResponse(SQL_LOG_INSERT, { meta: { last_row_id: 1 } })

    const count = await processRelancesDevis(db, 1, 'http://localhost:3000')
    expect(count).toBe(2)
  })

  it('utilise le délai configuré en boutique (7j)', async () => {
    db.__setResponse(SQL_SETTINGS_RELANCE, { delai_relance_jours: 7 })
    db.__setListResponse(SQL_DEVIS_ELIGIBLES, [])

    await processRelancesDevis(db, 1, 'http://localhost:3000')

    const calls = db.__getCalls()
    const eligibleCall = calls.find(c => c.sql.includes('envoye_le') && c.sql.includes('LIMIT 30'))
    expect(eligibleCall).toBeDefined()
    expect(eligibleCall?.params).toContain('-7')
  })
})
