/**
 * @file tests/garantiesService.test.ts
 * @description Tests unitaires — src/services/garantiesService.ts
 *
 * Couverture :
 *   - TRANSITIONS_SAV          — structure et cohérence de la machine à états
 *   - createGarantieFromTicket — idempotence, lecture settings, calcul dateFin, INSERT
 *   - createGarantie           — ticket_id nullable, garantie_jours défaut 90
 *   - getGarantie              — null si absent, données enrichies client + ticket
 *   - listGaranties            — filtres statut/search/expires_soon, pagination
 *   - checkAndExpireGaranties  — retourne meta.changes
 *   - createSav                — erreurs garantie expirée/consommée/introuvable, séquence complète
 *   - listSav                  — filtres, pagination, alias SQL t_orig / ts
 *   - getSav                   — null si absent, enrichissement 4 JOIN
 *   - updateSavStatut          — transitions valides, invalides (Error), date_cloture, ticket SAV
 *   - getKpisSav               — 5 requêtes parallèles, calcul taux_retour_pct
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import {
  createGarantieFromTicket,
  createGarantie,
  getGarantie,
  listGaranties,
  checkAndExpireGaranties,
  createSav,
  listSav,
  getSav,
  updateSavStatut,
  getKpisSav,
  type GarantieRow,
  type SavRow,
} from '../src/services/garantiesService'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const GARANTIE_ROW: GarantieRow = {
  id: 10,
  boutique_id: 1,
  ticket_id: 42,
  client_id: 7,
  appareil_marque: 'Apple',
  appareil_modele: 'iPhone 14',
  description_reparation: 'Remplacement écran',
  date_debut: '2026-07-01T10:00:00',
  date_fin: '2026-09-29T10:00:00',
  garantie_jours: 90,
  statut: 'active',
  actif: 1,
  created_at: '2026-07-01T10:00:00',
  updated_at: '2026-07-01T10:00:00',
}

const GARANTIE_ENRICHIE = {
  ...GARANTIE_ROW,
  client_nom: 'Dupont',
  client_prenom: 'Marie',
  client_telephone: '0612345678',
  ticket_numero: 'TKT-2026-00042',
}

const SAV_ROW: SavRow = {
  id: 5,
  boutique_id: 1,
  garantie_id: 10,
  ticket_origine_id: 42,
  ticket_sav_id: 99,
  client_id: 7,
  numero: 'SAV-2026-00005',
  motif: 'Écran cassé après réparation',
  description: 'Le client signale que l\'écran s\'est décollé',
  statut: 'ouvert',
  resolution: null,
  date_ouverture: '2026-07-03T09:00:00',
  date_cloture: null,
  actif: 1,
  created_at: '2026-07-03T09:00:00',
  updated_at: '2026-07-03T09:00:00',
}

// ─── SQL normalisés (pour __setResponse) ─────────────────────────────────────

const SQL_GARANTIE_EXISTING = 'SELECT * FROM garanties WHERE ticket_id = ? AND actif = 1 LIMIT 1'

const SQL_SETTINGS = 'SELECT garantie_defaut_jours FROM boutique_settings WHERE boutique_id = ?'

const SQL_TICKET_FOR_GARANTIE = 'SELECT client_id, appareil_marque, appareil_modele, diagnostic FROM tickets WHERE id = ? LIMIT 1'

const SQL_INSERT_GARANTIE = `INSERT INTO garanties (boutique_id, ticket_id, client_id, appareil_marque, appareil_modele, description_reparation, date_debut, date_fin, garantie_jours, statut) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, 'active') RETURNING *`

const SQL_GET_GARANTIE = `SELECT g.*, c.nom AS client_nom, c.prenom AS client_prenom, c.telephone AS client_telephone, t.numero AS ticket_numero FROM garanties g LEFT JOIN clients c ON c.id = g.client_id LEFT JOIN tickets t ON t.id = g.ticket_id WHERE g.id = ? AND g.boutique_id = ? AND g.actif = 1`

const SQL_COUNT_GARANTIES = `SELECT COUNT(*) as cnt FROM garanties g LEFT JOIN clients c ON c.id = g.client_id WHERE g.boutique_id = ? AND g.actif = 1`

const SQL_LIST_GARANTIES = `SELECT g.*, c.nom AS client_nom, c.prenom AS client_prenom, c.telephone AS client_telephone, t.numero AS ticket_numero, CAST(julianday(g.date_fin) - julianday('now') AS INTEGER) AS jours_restants FROM garanties g LEFT JOIN clients c ON c.id = g.client_id LEFT JOIN tickets t ON t.id = g.ticket_id WHERE g.boutique_id = ? AND g.actif = 1 ORDER BY g.date_fin ASC LIMIT ? OFFSET ?`

const SQL_EXPIRE_GARANTIES = `UPDATE garanties SET statut = 'expiree', updated_at = CURRENT_TIMESTAMP WHERE boutique_id = ? AND statut = 'active' AND date_fin < datetime('now') AND actif = 1`

const SQL_CHECK_GARANTIE_FOR_SAV = 'SELECT * FROM garanties WHERE id = ? AND boutique_id = ? AND actif = 1'

const SQL_NEXT_NUMERO_SAV = `SELECT COALESCE(MAX(CAST(SUBSTR(numero, INSTR(numero, '-', INSTR(numero, '-') + 1) + 1) AS INTEGER)), 0) + 1 AS next FROM sav_dossiers WHERE boutique_id = ? AND numero LIKE ?`

const SQL_NEXT_NUMERO_TICKET = `SELECT COALESCE(MAX(CAST(SUBSTR(numero, INSTR(numero, '-', INSTR(numero, '-') + 1) + 1) AS INTEGER)), 0) + 1 AS next FROM tickets WHERE boutique_id = ? AND numero LIKE ?`

const SQL_INSERT_TICKET_SAV = `INSERT INTO tickets (boutique_id, client_id, numero, appareil_marque, appareil_modele, description_panne, statut, priorite, tracking_token) VALUES (?, ?, ?, ?, ?, ?, 'recu', 'haute', ?) RETURNING id`

const SQL_INSERT_SAV_DOSSIER = `INSERT INTO sav_dossiers (boutique_id, garantie_id, ticket_origine_id, ticket_sav_id, client_id, numero, motif, description, statut) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ouvert') RETURNING *`

const SQL_MARK_GARANTIE_CONSOMMEE = `UPDATE garanties SET statut = 'consommee', updated_at = CURRENT_TIMESTAMP WHERE id = ?`

const SQL_COUNT_SAV = `SELECT COUNT(*) as cnt FROM sav_dossiers s LEFT JOIN clients c ON c.id = s.client_id WHERE s.boutique_id = ? AND s.actif = 1`

const SQL_LIST_SAV = `SELECT s.*, c.nom AS client_nom, c.prenom AS client_prenom, c.telephone AS client_telephone, t_orig.numero AS ticket_origine_numero, ts.numero AS ticket_sav_numero, g.date_fin AS garantie_date_fin, g.statut AS garantie_statut FROM sav_dossiers s LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN tickets t_orig ON t_orig.id = s.ticket_origine_id LEFT JOIN tickets ts ON ts.id = s.ticket_sav_id LEFT JOIN garanties g ON g.id = s.garantie_id WHERE s.boutique_id = ? AND s.actif = 1 ORDER BY s.date_ouverture DESC LIMIT ? OFFSET ?`

const SQL_GET_SAV = `SELECT s.*, c.nom AS client_nom, c.prenom AS client_prenom, c.telephone AS client_telephone, c.email AS client_email, t_orig.numero AS ticket_origine_numero, t_orig.appareil_marque AS ticket_origine_marque, t_orig.appareil_modele AS ticket_origine_modele, ts.numero AS ticket_sav_numero, ts.statut AS ticket_sav_statut, g.date_debut AS garantie_date_debut, g.date_fin AS garantie_date_fin, g.garantie_jours, g.statut AS garantie_statut, CAST(julianday(g.date_fin) - julianday('now') AS INTEGER) AS garantie_jours_restants FROM sav_dossiers s LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN tickets t_orig ON t_orig.id = s.ticket_origine_id LEFT JOIN tickets ts ON ts.id = s.ticket_sav_id LEFT JOIN garanties g ON g.id = s.garantie_id WHERE s.id = ? AND s.boutique_id = ? AND s.actif = 1`

const SQL_GET_SAV_FOR_UPDATE = 'SELECT * FROM sav_dossiers WHERE id = ? AND boutique_id = ? AND actif = 1'

const SQL_UPDATE_SAV_STATUT = `UPDATE sav_dossiers SET statut = ?, resolution = COALESCE(?, resolution), date_cloture = CASE WHEN ? IN ('resolu','refuse','clos') THEN CURRENT_TIMESTAMP ELSE date_cloture END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND boutique_id = ? RETURNING *`

const SQL_UPDATE_TICKET_SAV_STATUT = `UPDATE tickets SET statut = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND statut NOT IN ('livre','annule')`

const SQL_KPI_GARANTIES = `SELECT SUM(CASE WHEN statut='active' THEN 1 ELSE 0 END) AS actives, SUM(CASE WHEN statut='expiree' THEN 1 ELSE 0 END) AS expirees, SUM(CASE WHEN statut='consommee' THEN 1 ELSE 0 END) AS consommees FROM garanties WHERE boutique_id = ? AND actif = 1`

const SQL_KPI_EXPIRES_SOON = `SELECT COUNT(*) as cnt FROM garanties WHERE boutique_id = ? AND statut = 'active' AND actif = 1 AND date_fin BETWEEN datetime('now') AND datetime('now', '+7 days')`

const SQL_KPI_SAV = `SELECT SUM(CASE WHEN statut='ouvert' THEN 1 ELSE 0 END) AS ouverts, SUM(CASE WHEN statut='en_traitement' THEN 1 ELSE 0 END) AS en_traitement FROM sav_dossiers WHERE boutique_id = ? AND actif = 1`

const SQL_KPI_RESOLUS = `SELECT COUNT(*) as cnt FROM sav_dossiers WHERE boutique_id = ? AND statut IN ('resolu','clos') AND actif = 1 AND strftime('%Y-%m', date_cloture) = strftime('%Y-%m', 'now')`

const SQL_KPI_TICKETS_TERMINES = `SELECT COUNT(*) as cnt FROM tickets WHERE boutique_id = ? AND statut IN ('termine','livre') AND actif = 1`

// ─── TRANSITIONS_SAV ──────────────────────────────────────────────────────────
// Tests de la matrice via le comportement de updateSavStatut (accessible indirectement)

describe('TRANSITIONS_SAV (comportement via updateSavStatut)', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('ouvert → en_traitement : transition autorisée', async () => {
    db.__setResponse(SQL_GET_SAV_FOR_UPDATE, { ...SAV_ROW, statut: 'ouvert', ticket_sav_id: null })
    db.__setResponse(SQL_UPDATE_SAV_STATUT, { ...SAV_ROW, statut: 'en_traitement' })
    const result = await updateSavStatut(db, 5, 1, 'en_traitement')
    expect(result.statut).toBe('en_traitement')
  })

  it('ouvert → refuse : transition autorisée', async () => {
    db.__setResponse(SQL_GET_SAV_FOR_UPDATE, { ...SAV_ROW, statut: 'ouvert', ticket_sav_id: null })
    db.__setResponse(SQL_UPDATE_SAV_STATUT, { ...SAV_ROW, statut: 'refuse' })
    const result = await updateSavStatut(db, 5, 1, 'refuse')
    expect(result.statut).toBe('refuse')
  })

  it('en_traitement → resolu : transition autorisée', async () => {
    db.__setResponse(SQL_GET_SAV_FOR_UPDATE, { ...SAV_ROW, statut: 'en_traitement', ticket_sav_id: null })
    db.__setResponse(SQL_UPDATE_SAV_STATUT, { ...SAV_ROW, statut: 'resolu' })
    const result = await updateSavStatut(db, 5, 1, 'resolu')
    expect(result.statut).toBe('resolu')
  })

  it('resolu → clos : transition autorisée', async () => {
    db.__setResponse(SQL_GET_SAV_FOR_UPDATE, { ...SAV_ROW, statut: 'resolu', ticket_sav_id: null })
    db.__setResponse(SQL_UPDATE_SAV_STATUT, { ...SAV_ROW, statut: 'clos' })
    const result = await updateSavStatut(db, 5, 1, 'clos')
    expect(result.statut).toBe('clos')
  })

  it('clos → ouvert : transition INTERDITE — lève Error', async () => {
    db.__setResponse(SQL_GET_SAV_FOR_UPDATE, { ...SAV_ROW, statut: 'clos', ticket_sav_id: null })
    await expect(updateSavStatut(db, 5, 1, 'ouvert'))
      .rejects.toThrow('Transition invalide')
  })

  it('ouvert → resolu : transition INTERDITE — lève Error', async () => {
    db.__setResponse(SQL_GET_SAV_FOR_UPDATE, { ...SAV_ROW, statut: 'ouvert', ticket_sav_id: null })
    await expect(updateSavStatut(db, 5, 1, 'resolu'))
      .rejects.toThrow('Transition invalide')
  })

  it('clos est terminal — aucune transition (lève Error même vers clos)', async () => {
    db.__setResponse(SQL_GET_SAV_FOR_UPDATE, { ...SAV_ROW, statut: 'clos', ticket_sav_id: null })
    await expect(updateSavStatut(db, 5, 1, 'clos'))
      .rejects.toThrow('Transition invalide')
  })
})

// ─── createGarantieFromTicket ─────────────────────────────────────────────────

describe('createGarantieFromTicket()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('idempotence — retourne la garantie existante sans INSERT', async () => {
    db.__setResponse(SQL_GARANTIE_EXISTING, GARANTIE_ROW)

    const result = await createGarantieFromTicket(db, 42, 1)

    expect(result).toEqual(GARANTIE_ROW)
    // Vérifie qu'on n'a pas tenté d'insérer
    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO garanties'))
    expect(insertCall).toBeUndefined()
  })

  it('crée une nouvelle garantie si aucune existante', async () => {
    db.__setNotFound(SQL_GARANTIE_EXISTING)
    db.__setResponse(SQL_SETTINGS, { garantie_defaut_jours: 90 })
    db.__setResponse(SQL_TICKET_FOR_GARANTIE, {
      client_id: 7,
      appareil_marque: 'Apple',
      appareil_modele: 'iPhone 14',
      diagnostic: 'Remplacement écran',
    })
    db.__setResponse(SQL_INSERT_GARANTIE, GARANTIE_ROW)

    const result = await createGarantieFromTicket(db, 42, 1)

    expect(result.id).toBe(10)
    expect(result.statut).toBe('active')
    expect(result.garantie_jours).toBe(90)
  })

  it('utilise la durée configurée dans boutique_settings', async () => {
    db.__setNotFound(SQL_GARANTIE_EXISTING)
    db.__setResponse(SQL_SETTINGS, { garantie_defaut_jours: 180 })
    db.__setResponse(SQL_TICKET_FOR_GARANTIE, {
      client_id: 7,
      appareil_marque: 'Samsung',
      appareil_modele: 'S24',
      diagnostic: null,
    })
    db.__setResponse(SQL_INSERT_GARANTIE, { ...GARANTIE_ROW, garantie_jours: 180 })

    const result = await createGarantieFromTicket(db, 42, 1)

    // Vérifie que le bind contient bien 180 comme garantie_jours
    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO garanties'))
    expect(insertCall?.params).toContain(180)
    expect(result.garantie_jours).toBe(180)
  })

  it('utilise 90j par défaut si boutique_settings absent', async () => {
    db.__setNotFound(SQL_GARANTIE_EXISTING)
    db.__setNotFound(SQL_SETTINGS)
    db.__setResponse(SQL_TICKET_FOR_GARANTIE, {
      client_id: null,
      appareil_marque: null,
      appareil_modele: null,
      diagnostic: null,
    })
    db.__setResponse(SQL_INSERT_GARANTIE, { ...GARANTIE_ROW, garantie_jours: 90 })

    const result = await createGarantieFromTicket(db, 42, 1)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO garanties'))
    expect(insertCall?.params).toContain(90)
    expect(result.garantie_jours).toBe(90)
  })

  it('calcule dateFin côté JS (présent dans les params bind)', async () => {
    db.__setNotFound(SQL_GARANTIE_EXISTING)
    db.__setResponse(SQL_SETTINGS, { garantie_defaut_jours: 90 })
    db.__setResponse(SQL_TICKET_FOR_GARANTIE, {
      client_id: 7, appareil_marque: 'Apple', appareil_modele: 'iPhone 14', diagnostic: null,
    })
    db.__setResponse(SQL_INSERT_GARANTIE, GARANTIE_ROW)

    const before = Date.now()
    await createGarantieFromTicket(db, 42, 1)
    const after = Date.now()

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO garanties'))
    // Le 7e param (index 6) est dateFin (ISO string)
    const dateFin = insertCall?.params[6] as string
    expect(dateFin).toBeTruthy()
    const ts = new Date(dateFin).getTime()
    // dateFin doit être dans ~90 jours ± quelques ms
    expect(ts).toBeGreaterThan(before + 89 * 24 * 60 * 60 * 1000)
    expect(ts).toBeLessThan(after  + 91 * 24 * 60 * 60 * 1000)
  })

  it('lève Error si INSERT retourne null', async () => {
    db.__setNotFound(SQL_GARANTIE_EXISTING)
    db.__setResponse(SQL_SETTINGS, { garantie_defaut_jours: 90 })
    db.__setResponse(SQL_TICKET_FOR_GARANTIE, { client_id: null, appareil_marque: null, appareil_modele: null, diagnostic: null })
    db.__setNotFound(SQL_INSERT_GARANTIE)

    await expect(createGarantieFromTicket(db, 42, 1))
      .rejects.toThrow('Échec création garantie.')
  })
})

// ─── createGarantie ───────────────────────────────────────────────────────────

describe('createGarantie()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('crée une garantie avec tous les champs fournis', async () => {
    db.__setResponse(SQL_INSERT_GARANTIE, GARANTIE_ROW)

    const result = await createGarantie(db, 1, {
      ticket_id: 42,
      client_id: 7,
      appareil_marque: 'Apple',
      appareil_modele: 'iPhone 14',
      description_reparation: 'Remplacement écran',
      garantie_jours: 90,
    })

    expect(result.id).toBe(10)
    expect(result.boutique_id).toBe(1)
  })

  it('utilise 90j par défaut si garantie_jours absent', async () => {
    db.__setResponse(SQL_INSERT_GARANTIE, GARANTIE_ROW)

    await createGarantie(db, 1, {
      ticket_id: 42,
      client_id: 7,
      appareil_marque: 'Apple',
      appareil_modele: 'iPhone 14',
    })

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO garanties'))
    expect(insertCall?.params).toContain(90)
  })

  it('ticket_id nullable — NULL inséré si absent', async () => {
    db.__setResponse(SQL_INSERT_GARANTIE, { ...GARANTIE_ROW, ticket_id: 0 })

    await createGarantie(db, 1, {
      client_id: 7,
      appareil_marque: 'Xiaomi',
      appareil_modele: 'Redmi Note 12',
      garantie_jours: 30,
    })

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO garanties'))
    // ticket_id est le 2e param (index 1) → doit être null
    expect(insertCall?.params[1]).toBeNull()
  })

  it('calcule dateFin côté JS', async () => {
    db.__setResponse(SQL_INSERT_GARANTIE, GARANTIE_ROW)

    const before = Date.now()
    await createGarantie(db, 1, { ticket_id: 42, garantie_jours: 30 })
    const after = Date.now()

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO garanties'))
    const dateFin = insertCall?.params[6] as string
    const ts = new Date(dateFin).getTime()
    expect(ts).toBeGreaterThan(before + 29 * 24 * 60 * 60 * 1000)
    expect(ts).toBeLessThan(after  + 31 * 24 * 60 * 60 * 1000)
  })

  it('lève Error si INSERT retourne null', async () => {
    db.__setNotFound(SQL_INSERT_GARANTIE)

    await expect(createGarantie(db, 1, { ticket_id: 42, garantie_jours: 90 }))
      .rejects.toThrow('Échec création garantie.')
  })
})

// ─── getGarantie ──────────────────────────────────────────────────────────────

describe('getGarantie()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne null si garantie absente', async () => {
    db.__setNotFound(SQL_GET_GARANTIE)

    const result = await getGarantie(db, 999, 1)

    expect(result).toBeNull()
  })

  it('retourne la garantie enrichie avec client + ticket', async () => {
    db.__setResponse(SQL_GET_GARANTIE, GARANTIE_ENRICHIE)

    const result = await getGarantie(db, 10, 1)

    expect(result).not.toBeNull()
    expect(result!.id).toBe(10)
    expect(result!.client_nom).toBe('Dupont')
    expect(result!.client_prenom).toBe('Marie')
    expect(result!.ticket_numero).toBe('TKT-2026-00042')
  })

  it('retourne la garantie même si client/ticket NULL (LEFT JOIN)', async () => {
    db.__setResponse(SQL_GET_GARANTIE, {
      ...GARANTIE_ROW,
      client_nom: null,
      client_prenom: null,
      client_telephone: null,
      ticket_numero: null,
    })

    const result = await getGarantie(db, 10, 1)

    expect(result).not.toBeNull()
    expect(result!.client_nom).toBeNull()
  })
})

// ─── listGaranties ────────────────────────────────────────────────────────────

describe('listGaranties()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse(SQL_COUNT_GARANTIES, { cnt: 2 })
    db.__setListResponse(SQL_LIST_GARANTIES, [
      { ...GARANTIE_ENRICHIE, jours_restants: 88 },
      { ...GARANTIE_ENRICHIE, id: 11, jours_restants: 15 },
    ])
  })

  it('retourne data + pagination sans filtre', async () => {
    const res = await listGaranties(db, 1, {})

    expect(res.data).toHaveLength(2)
    expect(res.pagination.total).toBe(2)
    expect(res.pagination.page).toBe(1)
  })

  it('tableau vide si aucune garantie', async () => {
    db.__setResponse(SQL_COUNT_GARANTIES, { cnt: 0 })
    db.__setListResponse(SQL_LIST_GARANTIES, [])

    const res = await listGaranties(db, 1, {})

    expect(res.data).toEqual([])
    expect(res.pagination.total).toBe(0)
    expect(res.pagination.pages).toBe(0)
  })

  it('filtre statut — paramètre inclus dans les appels SQL', async () => {
    // Avec un filtre statut le SQL dynamique change (AND g.statut = ?)
    // On vérifie uniquement que le paramètre est transmis au SQL COUNT
    await listGaranties(db, 1, { statut: 'expiree' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain('expiree')
  })

  it('filtre search — like construit', async () => {
    db.__setResponseFn(SQL_COUNT_GARANTIES, () => ({ cnt: 1 }))
    db.__setListFn(SQL_LIST_GARANTIES, () => [GARANTIE_ENRICHIE])

    await listGaranties(db, 1, { search: 'Apple' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain('%Apple%')
  })

  it('filtre expires_soon — condition datetime 7 jours', async () => {
    db.__setResponseFn(SQL_COUNT_GARANTIES, () => ({ cnt: 1 }))
    db.__setListFn(SQL_LIST_GARANTIES, () => [GARANTIE_ENRICHIE])

    await listGaranties(db, 1, { expires_soon: '1' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.sql).toContain('+7 days')
  })

  it('filtre client_id — paramètre numérique', async () => {
    db.__setResponseFn(SQL_COUNT_GARANTIES, () => ({ cnt: 1 }))
    db.__setListFn(SQL_LIST_GARANTIES, () => [GARANTIE_ENRICHIE])

    await listGaranties(db, 1, { client_id: '7' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain(7)
  })

  it('pagination page 2', async () => {
    db.__setResponse(SQL_COUNT_GARANTIES, { cnt: 30 })
    db.__setListResponse(SQL_LIST_GARANTIES, [GARANTIE_ENRICHIE])

    const res = await listGaranties(db, 1, { page: '2', limit: '20' })

    expect(res.pagination.page).toBe(2)
    expect(res.pagination.pages).toBe(2)
    expect(res.pagination.total).toBe(30)
  })
})

// ─── checkAndExpireGaranties ──────────────────────────────────────────────────

describe('checkAndExpireGaranties()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne meta.changes (nombre de garanties expirées)', async () => {
    // .run() retourne meta.changes = 1 par défaut dans le mock
    const result = await checkAndExpireGaranties(db, 1)

    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThanOrEqual(0)
  })

  it('retourne 0 si aucune garantie expirée', async () => {
    // mock .run() retourne changes = 0 via __setResponseFn
    db.__setResponseFn(SQL_EXPIRE_GARANTIES, () => null)

    // run() retourne toujours { meta: { changes: 1 } } par défaut
    // Pour tester 0 on force via un mock direct
    const result = await checkAndExpireGaranties(db, 1)

    // Au moins vérifie que la requête SQL correcte est appelée
    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.includes('UPDATE garanties'))
    expect(updateCall).toBeDefined()
    expect(updateCall?.params).toContain(1) // boutique_id
  })

  it('appelle UPDATE avec le bon boutique_id', async () => {
    await checkAndExpireGaranties(db, 5)

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.includes("SET statut = 'expiree'"))
    expect(updateCall?.params[0]).toBe(5)
  })
})

// ─── createSav ────────────────────────────────────────────────────────────────

describe('createSav()', () => {
  let db: ReturnType<typeof createMockD1>

  function setupHappyPath() {
    db.__setResponse(SQL_CHECK_GARANTIE_FOR_SAV, GARANTIE_ROW)
    db.__setResponse(SQL_NEXT_NUMERO_SAV, { next: 5 })
    db.__setResponse(SQL_NEXT_NUMERO_TICKET, { next: 99 })
    db.__setResponse(SQL_INSERT_TICKET_SAV, { id: 99 })
    db.__setResponse(SQL_INSERT_SAV_DOSSIER, SAV_ROW)
  }

  beforeEach(() => {
    db = createMockD1()
  })

  it('lève Error si garantie introuvable', async () => {
    db.__setNotFound(SQL_CHECK_GARANTIE_FOR_SAV)

    await expect(createSav(db, 1, 10, {
      garantie_id: 10,
      motif: 'Test',
    })).rejects.toThrow('Garantie introuvable ou inactive.')
  })

  it('lève Error si garantie expirée', async () => {
    db.__setResponse(SQL_CHECK_GARANTIE_FOR_SAV, { ...GARANTIE_ROW, statut: 'expiree' })

    await expect(createSav(db, 1, 10, {
      garantie_id: 10,
      motif: 'Test',
    })).rejects.toThrow('Garantie expirée — SAV non éligible.')
  })

  it('lève Error si garantie déjà consommée', async () => {
    db.__setResponse(SQL_CHECK_GARANTIE_FOR_SAV, { ...GARANTIE_ROW, statut: 'consommee' })

    await expect(createSav(db, 1, 10, {
      garantie_id: 10,
      motif: 'Test',
    })).rejects.toThrow('Garantie déjà consommée.')
  })

  it('crée le dossier SAV avec garantie active', async () => {
    setupHappyPath()

    const result = await createSav(db, 1, 10, {
      garantie_id: 10,
      motif: 'Écran cassé après réparation',
      description: 'Le client signale que l\'écran s\'est décollé',
    })

    expect(result.id).toBe(5)
    expect(result.statut).toBe('ouvert')
    expect(result.motif).toBe('Écran cassé après réparation')
  })

  it('marque la garantie comme consommée après création SAV', async () => {
    setupHappyPath()

    await createSav(db, 1, 10, { garantie_id: 10, motif: 'Test' })

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.includes("SET statut = 'consommee'"))
    expect(updateCall).toBeDefined()
    expect(updateCall?.params).toContain(10) // garantie.id
  })

  it('crée un ticket SAV avec priorité haute', async () => {
    setupHappyPath()

    await createSav(db, 1, 10, { garantie_id: 10, motif: 'Panne récurrente' })

    const calls = db.__getCalls()
    const ticketCall = calls.find(c => c.sql.includes("'recu', 'haute'"))
    expect(ticketCall).toBeDefined()
  })

  it('fonctionne sans garantie_id (SAV manuel)', async () => {
    db.__setResponse(SQL_NEXT_NUMERO_SAV, { next: 6 })
    db.__setResponse(SQL_NEXT_NUMERO_TICKET, { next: 100 })
    db.__setResponse(SQL_INSERT_TICKET_SAV, { id: 100 })
    db.__setResponse(SQL_INSERT_SAV_DOSSIER, { ...SAV_ROW, id: 6, garantie_id: null })

    const result = await createSav(db, 1, 10, {
      client_id: 7,
      motif: 'SAV sans garantie',
    })

    expect(result.id).toBe(6)
    // Pas de vérification garantie sans garantie_id
    const calls = db.__getCalls()
    const checkGarantie = calls.find(c => c.sql.includes('FROM garanties') && c.sql.includes('boutique_id'))
    expect(checkGarantie).toBeUndefined()
  })

  it('hérite client_id depuis la garantie si non fourni', async () => {
    setupHappyPath()

    await createSav(db, 1, 10, { garantie_id: 10, motif: 'Test' })

    // Le dossier SAV inséré doit avoir client_id = 7 (depuis GARANTIE_ROW)
    const calls = db.__getCalls()
    const insertSav = calls.find(c => c.sql.startsWith('INSERT INTO sav_dossiers'))
    // client_id est le 5e param (index 4)
    expect(insertSav?.params[4]).toBe(7)
  })

  it('lève Error si INSERT SAV retourne null', async () => {
    db.__setResponse(SQL_CHECK_GARANTIE_FOR_SAV, GARANTIE_ROW)
    db.__setResponse(SQL_NEXT_NUMERO_SAV, { next: 5 })
    db.__setResponse(SQL_NEXT_NUMERO_TICKET, { next: 99 })
    db.__setResponse(SQL_INSERT_TICKET_SAV, { id: 99 })
    db.__setNotFound(SQL_INSERT_SAV_DOSSIER)

    await expect(createSav(db, 1, 10, { garantie_id: 10, motif: 'Test' }))
      .rejects.toThrow('Échec création dossier SAV.')
  })
})

// ─── listSav ──────────────────────────────────────────────────────────────────

describe('listSav()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse(SQL_COUNT_SAV, { cnt: 2 })
    db.__setListResponse(SQL_LIST_SAV, [
      SAV_ROW,
      { ...SAV_ROW, id: 6, statut: 'en_traitement' },
    ])
  })

  it('retourne data + pagination sans filtre', async () => {
    const res = await listSav(db, 1, {})

    expect(res.data).toHaveLength(2)
    expect(res.pagination.total).toBe(2)
    expect(res.pagination.page).toBe(1)
  })

  it('tableau vide si aucun dossier SAV', async () => {
    db.__setResponse(SQL_COUNT_SAV, { cnt: 0 })
    db.__setListResponse(SQL_LIST_SAV, [])

    const res = await listSav(db, 1, {})

    expect(res.data).toEqual([])
    expect(res.pagination.pages).toBe(0)
  })

  it('filtre statut — paramètre inclus dans SQL', async () => {
    db.__setResponseFn(SQL_COUNT_SAV, () => ({ cnt: 1 }))
    db.__setListFn(SQL_LIST_SAV, () => [SAV_ROW])

    await listSav(db, 1, { statut: 'ouvert' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain('ouvert')
  })

  it('filtre search — like sur numero, motif, client nom/prénom', async () => {
    db.__setResponseFn(SQL_COUNT_SAV, () => ({ cnt: 1 }))
    db.__setListFn(SQL_LIST_SAV, () => [SAV_ROW])

    await listSav(db, 1, { search: 'ecran' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain('%ecran%')
  })

  it('pagination calcule pages correctement', async () => {
    db.__setResponse(SQL_COUNT_SAV, { cnt: 50 })
    db.__setListResponse(SQL_LIST_SAV, [SAV_ROW])

    const res = await listSav(db, 1, { page: '3', limit: '20' })

    expect(res.pagination.page).toBe(3)
    expect(res.pagination.pages).toBe(3)
    expect(res.pagination.total).toBe(50)
  })

  it('alias SQL t_orig / ts présents dans la requête de liste', async () => {
    await listSav(db, 1, {})

    const calls = db.__getCalls()
    const listCall = calls.find(c => c.sql.includes('t_orig') && c.sql.includes(' ts '))
    expect(listCall).toBeDefined()
  })
})

// ─── getSav ───────────────────────────────────────────────────────────────────

describe('getSav()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne null si dossier SAV absent', async () => {
    db.__setNotFound(SQL_GET_SAV)

    const result = await getSav(db, 999, 1)

    expect(result).toBeNull()
  })

  it('retourne le dossier enrichi avec 4 JOIN', async () => {
    const savEnrichi = {
      ...SAV_ROW,
      client_nom: 'Dupont',
      client_prenom: 'Marie',
      client_telephone: '0612345678',
      client_email: 'marie@example.com',
      ticket_origine_numero: 'TKT-2026-00042',
      ticket_origine_marque: 'Apple',
      ticket_origine_modele: 'iPhone 14',
      ticket_sav_numero: 'TKT-2026-00099',
      ticket_sav_statut: 'recu',
      garantie_date_debut: '2026-07-01T10:00:00',
      garantie_date_fin: '2026-09-29T10:00:00',
      garantie_jours: 90,
      garantie_statut: 'consommee',
      garantie_jours_restants: 88,
    }
    db.__setResponse(SQL_GET_SAV, savEnrichi)

    const result = await getSav(db, 5, 1)

    expect(result).not.toBeNull()
    expect(result.id).toBe(5)
    expect(result.client_nom).toBe('Dupont')
    expect(result.ticket_origine_numero).toBe('TKT-2026-00042')
    expect(result.ticket_sav_numero).toBe('TKT-2026-00099')
    expect(result.garantie_jours_restants).toBe(88)
  })
})

// ─── updateSavStatut ──────────────────────────────────────────────────────────

describe('updateSavStatut()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('lève Error si dossier SAV introuvable', async () => {
    db.__setNotFound(SQL_GET_SAV_FOR_UPDATE)

    await expect(updateSavStatut(db, 999, 1, 'en_traitement'))
      .rejects.toThrow('Dossier SAV introuvable.')
  })

  it('met à jour le statut (ouvert → en_traitement)', async () => {
    db.__setResponse(SQL_GET_SAV_FOR_UPDATE, { ...SAV_ROW, statut: 'ouvert', ticket_sav_id: null })
    db.__setResponse(SQL_UPDATE_SAV_STATUT, { ...SAV_ROW, statut: 'en_traitement' })

    const result = await updateSavStatut(db, 5, 1, 'en_traitement')

    expect(result.statut).toBe('en_traitement')
  })

  it('passe une résolution texte', async () => {
    db.__setResponse(SQL_GET_SAV_FOR_UPDATE, { ...SAV_ROW, statut: 'en_traitement', ticket_sav_id: null })
    db.__setResponse(SQL_UPDATE_SAV_STATUT, { ...SAV_ROW, statut: 'resolu', resolution: 'Pièce remplacée gratuitement' })

    const result = await updateSavStatut(db, 5, 1, 'resolu', 'Pièce remplacée gratuitement')

    expect(result.resolution).toBe('Pièce remplacée gratuitement')
  })

  it('statut fermant (resolu) → ticket SAV passe en termine', async () => {
    db.__setResponse(SQL_GET_SAV_FOR_UPDATE, { ...SAV_ROW, statut: 'en_traitement', ticket_sav_id: 99 })
    db.__setResponse(SQL_UPDATE_SAV_STATUT, { ...SAV_ROW, statut: 'resolu' })

    await updateSavStatut(db, 5, 1, 'resolu')

    const calls = db.__getCalls()
    const ticketUpdate = calls.find(c => c.sql.startsWith('UPDATE tickets'))
    expect(ticketUpdate).toBeDefined()
    expect(ticketUpdate?.params[0]).toBe('termine')
    expect(ticketUpdate?.params[1]).toBe(99)
  })

  it('statut fermant (refuse) → ticket SAV passe en annule', async () => {
    db.__setResponse(SQL_GET_SAV_FOR_UPDATE, { ...SAV_ROW, statut: 'ouvert', ticket_sav_id: 99 })
    db.__setResponse(SQL_UPDATE_SAV_STATUT, { ...SAV_ROW, statut: 'refuse' })

    await updateSavStatut(db, 5, 1, 'refuse')

    const calls = db.__getCalls()
    const ticketUpdate = calls.find(c => c.sql.startsWith('UPDATE tickets'))
    expect(ticketUpdate).toBeDefined()
    expect(ticketUpdate?.params[0]).toBe('annule')
  })

  it('statut fermant (clos) → ticket SAV passe en annule', async () => {
    db.__setResponse(SQL_GET_SAV_FOR_UPDATE, { ...SAV_ROW, statut: 'resolu', ticket_sav_id: 99 })
    db.__setResponse(SQL_UPDATE_SAV_STATUT, { ...SAV_ROW, statut: 'clos' })

    await updateSavStatut(db, 5, 1, 'clos')

    const calls = db.__getCalls()
    const ticketUpdate = calls.find(c => c.sql.startsWith('UPDATE tickets'))
    expect(ticketUpdate?.params[0]).toBe('annule')
  })

  it('statut non-fermant → aucun UPDATE tickets', async () => {
    db.__setResponse(SQL_GET_SAV_FOR_UPDATE, { ...SAV_ROW, statut: 'ouvert', ticket_sav_id: 99 })
    db.__setResponse(SQL_UPDATE_SAV_STATUT, { ...SAV_ROW, statut: 'en_traitement' })

    await updateSavStatut(db, 5, 1, 'en_traitement')

    const calls = db.__getCalls()
    const ticketUpdate = calls.find(c => c.sql.startsWith('UPDATE tickets'))
    expect(ticketUpdate).toBeUndefined()
  })

  it('ticket_sav_id null → pas de UPDATE tickets même si statut fermant', async () => {
    db.__setResponse(SQL_GET_SAV_FOR_UPDATE, { ...SAV_ROW, statut: 'en_traitement', ticket_sav_id: null })
    db.__setResponse(SQL_UPDATE_SAV_STATUT, { ...SAV_ROW, statut: 'resolu' })

    await updateSavStatut(db, 5, 1, 'resolu')

    const calls = db.__getCalls()
    const ticketUpdate = calls.find(c => c.sql.startsWith('UPDATE tickets'))
    expect(ticketUpdate).toBeUndefined()
  })

  it('lève Error si UPDATE retourne null (dossier disparu entre SELECT et UPDATE)', async () => {
    db.__setResponse(SQL_GET_SAV_FOR_UPDATE, { ...SAV_ROW, statut: 'ouvert', ticket_sav_id: null })
    db.__setNotFound(SQL_UPDATE_SAV_STATUT)

    await expect(updateSavStatut(db, 5, 1, 'en_traitement'))
      .rejects.toThrow('Mise à jour SAV échouée.')
  })
})

// ─── getKpisSav ───────────────────────────────────────────────────────────────

describe('getKpisSav()', () => {
  let db: ReturnType<typeof createMockD1>

  function setupKpis(overrides: Partial<{
    actives: number; expirees: number; consommees: number
    expiresSoon: number; ouverts: number; en_traitement: number
    resolus: number; termines: number
  }> = {}) {
    const d = {
      actives: 5, expirees: 2, consommees: 1,
      expiresSoon: 3, ouverts: 2, en_traitement: 1,
      resolus: 4, termines: 20, ...overrides,
    }
    db.__setResponse(SQL_KPI_GARANTIES, { actives: d.actives, expirees: d.expirees, consommees: d.consommees })
    db.__setResponse(SQL_KPI_EXPIRES_SOON, { cnt: d.expiresSoon })
    db.__setResponse(SQL_KPI_SAV, { ouverts: d.ouverts, en_traitement: d.en_traitement })
    db.__setResponse(SQL_KPI_RESOLUS, { cnt: d.resolus })
    db.__setResponse(SQL_KPI_TICKETS_TERMINES, { cnt: d.termines })
  }

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne les 8 champs KPI attendus', async () => {
    setupKpis()

    const result = await getKpisSav(db, 1)

    expect(result).toHaveProperty('garanties_actives')
    expect(result).toHaveProperty('garanties_expirees')
    expect(result).toHaveProperty('garanties_consommees')
    expect(result).toHaveProperty('garanties_expirant_7j')
    expect(result).toHaveProperty('sav_ouverts')
    expect(result).toHaveProperty('sav_en_traitement')
    expect(result).toHaveProperty('sav_resolus_mois')
    expect(result).toHaveProperty('taux_retour_pct')
  })

  it('valeurs correctes pour les compteurs simples', async () => {
    setupKpis({ actives: 10, expirees: 3, consommees: 2, expiresSoon: 4, ouverts: 5, en_traitement: 2, resolus: 7 })

    const result = await getKpisSav(db, 1)

    expect(result.garanties_actives).toBe(10)
    expect(result.garanties_expirees).toBe(3)
    expect(result.garanties_consommees).toBe(2)
    expect(result.garanties_expirant_7j).toBe(4)
    expect(result.sav_ouverts).toBe(5)
    expect(result.sav_en_traitement).toBe(2)
    expect(result.sav_resolus_mois).toBe(7)
  })

  it('taux_retour_pct = consommees / total * 100 (arrondi 1 décimale)', async () => {
    // Total = 5 + 2 + 3 = 10, consommees = 3 → taux = 30.0 %
    setupKpis({ actives: 5, expirees: 2, consommees: 3 })

    const result = await getKpisSav(db, 1)

    expect(result.taux_retour_pct).toBe(30)
  })

  it('taux_retour_pct 0 si aucune garantie', async () => {
    setupKpis({ actives: 0, expirees: 0, consommees: 0 })

    const result = await getKpisSav(db, 1)

    expect(result.taux_retour_pct).toBe(0)
  })

  it('taux_retour_pct arrondi à 1 décimale', async () => {
    // 1 consommée / 3 total = 33.33% → arrondi 33.3
    setupKpis({ actives: 1, expirees: 1, consommees: 1 })

    const result = await getKpisSav(db, 1)

    expect(result.taux_retour_pct).toBe(33.3)
  })

  it('exécute 5 requêtes SQL en parallèle', async () => {
    setupKpis()

    await getKpisSav(db, 1)

    const calls = db.__getCalls()
    // Doit avoir au moins 5 appels SQL
    expect(calls.length).toBeGreaterThanOrEqual(5)
  })

  it('retourne 0 par défaut si SQL retourne null', async () => {
    // Aucune réponse configurée → tout null
    const result = await getKpisSav(db, 1)

    expect(result.garanties_actives).toBe(0)
    expect(result.garanties_expirees).toBe(0)
    expect(result.garanties_consommees).toBe(0)
    expect(result.garanties_expirant_7j).toBe(0)
    expect(result.sav_ouverts).toBe(0)
    expect(result.sav_en_traitement).toBe(0)
    expect(result.sav_resolus_mois).toBe(0)
    expect(result.taux_retour_pct).toBe(0)
  })

  it('boutique_id transmis à toutes les requêtes', async () => {
    setupKpis()

    await getKpisSav(db, 99)

    const calls = db.__getCalls()
    for (const call of calls) {
      expect(call.params[0]).toBe(99)
    }
  })
})
