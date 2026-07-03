/**
 * @file tests/agendaService.test.ts
 * @description Tests unitaires — src/services/agendaService.ts
 *
 * Couverture :
 *   - STATUTS_RDV / TYPES_RDV  — constantes exportées
 *   - listRendezVous()          — pagination, filtres date/statut/search/user_id/type_rdv/client_id
 *   - getRendezVous()           — null si absent, enrichissement client + tech + ticket
 *   - createRendezVous()        — calcul fin auto, ical_token, fallback user_id, statut par défaut
 *   - updateRendezVous()        — lève Error si RDV absent, mise à jour champs
 *   - updateStatutRdv()         — machine à états : transitions valides, invalides, terminaux
 *   - deleteRendezVous()        — soft delete actif=0, Error si absent
 *   - getAgendaView()           — regroupement par date, filtre CANCELLED, filtre user_id
 *   - getKpisAgenda()           — 5 requêtes parallèles, calcul taux_honore
 *   - getOrCreateIcalToken()    — retourne existing, crée si absent
 *   - generateIcal()            — format RFC 5545 : VCALENDAR, VEVENT, CRLF, UID stable
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import {
  STATUTS_RDV,
  TYPES_RDV,
  listRendezVous,
  getRendezVous,
  createRendezVous,
  updateRendezVous,
  updateStatutRdv,
  deleteRendezVous,
  getAgendaView,
  getKpisAgenda,
  getOrCreateIcalToken,
  generateIcal,
  type RendezVous,
} from '../src/services/agendaService'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RDV_ROW: RendezVous = {
  id: 1,
  boutique_id: 1,
  client_id: 7,
  ticket_id: null,
  user_id: 3,
  titre: 'Réparation iPhone 14',
  description: 'Remplacement écran',
  debut: '2026-07-10 14:30:00',
  fin: '2026-07-10 15:00:00',
  duree_minutes: 30,
  statut: 'SCHEDULED',
  type_rdv: 'reparation',
  nom_client: null,
  telephone_client: null,
  rappel_envoye: 0,
  rappel_minutes: 60,
  ical_token: 'abc123def456abc123def456abc123de',
  couleur: '#3B82F6',
  notes: null,
}

const RDV_ENRICHI = {
  ...RDV_ROW,
  client_nom: 'Dupont',
  client_prenom: 'Marie',
  client_tel: '0612345678',
  client_email: 'marie@example.com',
  tech_prenom: 'Jean',
  tech_nom: 'Martin',
  ticket_numero: null,
  ticket_statut: null,
}

// ─── SQL normalisés ───────────────────────────────────────────────────────────

const SQL_COUNT_RDV = `SELECT COUNT(*) as cnt FROM rendez_vous r LEFT JOIN clients c ON c.id = r.client_id WHERE r.boutique_id = ? AND r.actif = 1`

const SQL_LIST_RDV = `SELECT r.*, c.nom AS client_nom, c.prenom AS client_prenom, c.telephone AS client_tel, c.email AS client_email, u.prenom AS tech_prenom, u.nom AS tech_nom FROM rendez_vous r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN users u ON u.id = r.user_id WHERE r.boutique_id = ? AND r.actif = 1 ORDER BY r.debut ASC LIMIT ? OFFSET ?`

const SQL_GET_RDV = `SELECT r.*, c.nom AS client_nom, c.prenom AS client_prenom, c.telephone AS client_tel, c.email AS client_email, u.prenom AS tech_prenom, u.nom AS tech_nom, t.numero AS ticket_numero, t.statut AS ticket_statut FROM rendez_vous r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN users u ON u.id = r.user_id LEFT JOIN tickets t ON t.id = r.ticket_id WHERE r.id = ? AND r.boutique_id = ? AND r.actif = 1`

const SQL_INSERT_RDV = `INSERT INTO rendez_vous (boutique_id, client_id, ticket_id, user_id, titre, description, debut, fin, duree_minutes, statut, type_rdv, nom_client, telephone_client, rappel_minutes, ical_token, couleur, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`

const SQL_GET_RDV_FOR_UPDATE = 'SELECT * FROM rendez_vous WHERE id = ? AND boutique_id = ? AND actif = 1'

const SQL_UPDATE_RDV = `UPDATE rendez_vous SET client_id = ?, ticket_id = ?, user_id = ?, titre = ?, description = ?, debut = ?, fin = ?, duree_minutes = ?, statut = ?, type_rdv = ?, nom_client = ?, telephone_client = ?, rappel_minutes = ?, couleur = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND boutique_id = ?`

const SQL_GET_STATUT_FOR_UPDATE = 'SELECT statut FROM rendez_vous WHERE id = ? AND boutique_id = ? AND actif = 1'

const SQL_UPDATE_STATUT = `UPDATE rendez_vous SET statut = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND boutique_id = ?`

const SQL_GET_RDV_FOR_DELETE = 'SELECT id FROM rendez_vous WHERE id = ? AND boutique_id = ? AND actif = 1'

const SQL_SOFT_DELETE = 'UPDATE rendez_vous SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?'

const SQL_AGENDA_VIEW = `SELECT r.*, c.nom AS client_nom, c.prenom AS client_prenom, c.telephone AS client_tel, u.prenom AS tech_prenom, u.nom AS tech_nom FROM rendez_vous r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN users u ON u.id = r.user_id WHERE r.boutique_id = ? AND r.actif = 1 AND r.debut >= ? AND r.debut <= ? AND r.statut != 'CANCELLED' ORDER BY r.debut ASC`

const SQL_KPI_TOTAL     = "SELECT COUNT(*) as cnt FROM rendez_vous WHERE boutique_id=? AND actif=1 AND statut!='CANCELLED'"
const SQL_KPI_AUJ       = "SELECT COUNT(*) as cnt FROM rendez_vous WHERE boutique_id=? AND actif=1 AND DATE(debut)=? AND statut!='CANCELLED'"
const SQL_KPI_SEMAINE   = "SELECT COUNT(*) as cnt FROM rendez_vous WHERE boutique_id=? AND actif=1 AND debut>=? AND debut<=? AND statut!='CANCELLED'"
const SQL_KPI_EN_ATTENTE = "SELECT COUNT(*) as cnt FROM rendez_vous WHERE boutique_id=? AND actif=1 AND statut IN ('PENDING','SCHEDULED')"
const SQL_KPI_DONE      = "SELECT COUNT(*) as cnt FROM rendez_vous WHERE boutique_id=? AND actif=1 AND statut='DONE'"

const SQL_GET_ICAL_TOKEN = 'SELECT token FROM boutique_ical_tokens WHERE boutique_id = ?'
const SQL_INSERT_ICAL_TOKEN = 'INSERT INTO boutique_ical_tokens (boutique_id, token) VALUES (?, ?)'

const SQL_BOUTIQUE_NOM  = 'SELECT nom FROM boutiques WHERE id = ?'
const SQL_ICAL_ROWS     = `SELECT r.*, c.nom AS client_nom, c.prenom AS client_prenom FROM rendez_vous r LEFT JOIN clients c ON c.id = r.client_id WHERE r.boutique_id = ? AND r.actif = 1 AND r.statut IN ('SCHEDULED','PENDING','DONE') AND r.debut >= datetime('now', '-30 days') ORDER BY r.debut ASC LIMIT 500`

// ─── STATUTS_RDV / TYPES_RDV ─────────────────────────────────────────────────

describe('STATUTS_RDV', () => {
  it('contient exactement les 6 statuts attendus', () => {
    expect(STATUTS_RDV).toHaveLength(6)
    expect(STATUTS_RDV).toContain('PENDING')
    expect(STATUTS_RDV).toContain('SCHEDULED')
    expect(STATUTS_RDV).toContain('DONE')
    expect(STATUTS_RDV).toContain('NO_SHOW')
    expect(STATUTS_RDV).toContain('CANCELLED')
    expect(STATUTS_RDV).toContain('CONVERTED')
  })
})

describe('TYPES_RDV', () => {
  it('contient exactement les 5 types attendus', () => {
    expect(TYPES_RDV).toHaveLength(5)
    expect(TYPES_RDV).toContain('reparation')
    expect(TYPES_RDV).toContain('restitution')
    expect(TYPES_RDV).toContain('devis')
    expect(TYPES_RDV).toContain('diagnostic')
    expect(TYPES_RDV).toContain('autre')
  })
})

// ─── listRendezVous ───────────────────────────────────────────────────────────

describe('listRendezVous()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse(SQL_COUNT_RDV, { cnt: 2 })
    db.__setListResponse(SQL_LIST_RDV, [RDV_ENRICHI, { ...RDV_ENRICHI, id: 2 }])
  })

  it('retourne data + total + pagination sans filtre', async () => {
    const res = await listRendezVous(db, 1, {})

    expect(res.data).toHaveLength(2)
    expect(res.total).toBe(2)
    expect(res.page).toBe(1)
    expect(res.limit).toBe(20)
  })

  it('tableau vide si aucun RDV', async () => {
    db.__setResponse(SQL_COUNT_RDV, { cnt: 0 })
    db.__setListResponse(SQL_LIST_RDV, [])

    const res = await listRendezVous(db, 1, {})

    expect(res.data).toEqual([])
    expect(res.total).toBe(0)
  })

  it('filtre date_debut — paramètre transmis', async () => {
    await listRendezVous(db, 1, { date_debut: '2026-07-01' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain('2026-07-01')
    expect(countCall?.sql).toContain('debut >=')
  })

  it('filtre date_fin — paramètre transmis', async () => {
    await listRendezVous(db, 1, { date_fin: '2026-07-31' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain('2026-07-31')
    expect(countCall?.sql).toContain('debut <=')
  })

  it('filtre statut — paramètre transmis', async () => {
    await listRendezVous(db, 1, { statut: 'SCHEDULED' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain('SCHEDULED')
  })

  it('filtre user_id — converti en Number', async () => {
    await listRendezVous(db, 1, { user_id: '3' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain(3)
  })

  it('filtre type_rdv — paramètre transmis', async () => {
    await listRendezVous(db, 1, { type_rdv: 'devis' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain('devis')
  })

  it('filtre search — like construit sur 5 champs', async () => {
    await listRendezVous(db, 1, { search: 'iPhone' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain('%iPhone%')
    // 5 fois le même like (titre, nom_client, telephone, c.nom, c.prenom)
    expect(countCall?.params.filter(p => p === '%iPhone%')).toHaveLength(5)
  })

  it('filtre client_id — converti en Number', async () => {
    await listRendezVous(db, 1, { client_id: '7' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain(7)
  })

  it('pagination page 2', async () => {
    db.__setResponse(SQL_COUNT_RDV, { cnt: 40 })
    db.__setListResponse(SQL_LIST_RDV, [RDV_ENRICHI])

    const res = await listRendezVous(db, 1, { page: '2', limit: '20' })

    expect(res.page).toBe(2)
    expect(res.total).toBe(40)
  })
})

// ─── getRendezVous ────────────────────────────────────────────────────────────

describe('getRendezVous()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne null si RDV absent', async () => {
    db.__setNotFound(SQL_GET_RDV)

    const result = await getRendezVous(db, 999, 1)

    expect(result).toBeNull()
  })

  it('retourne RDV enrichi avec client + tech + ticket', async () => {
    db.__setResponse(SQL_GET_RDV, {
      ...RDV_ENRICHI,
      ticket_numero: 'TKT-2026-00042',
      ticket_statut: 'recu',
    })

    const result = await getRendezVous(db, 1, 1)

    expect(result.id).toBe(1)
    expect(result.client_nom).toBe('Dupont')
    expect(result.tech_nom).toBe('Martin')
    expect(result.ticket_numero).toBe('TKT-2026-00042')
  })

  it('LEFT JOIN — champs client/tech null si non associés', async () => {
    db.__setResponse(SQL_GET_RDV, {
      ...RDV_ROW,
      client_nom: null, client_prenom: null, client_tel: null, client_email: null,
      tech_prenom: null, tech_nom: null,
      ticket_numero: null, ticket_statut: null,
    })

    const result = await getRendezVous(db, 1, 1)

    expect(result.client_nom).toBeNull()
    expect(result.tech_nom).toBeNull()
  })
})

// ─── createRendezVous ─────────────────────────────────────────────────────────

describe('createRendezVous()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse(SQL_INSERT_RDV, { id: 42 })
  })

  it('retourne { id } du RDV créé', async () => {
    const result = await createRendezVous(db, 1, {
      titre: 'Test RDV',
      debut: '2026-07-10 14:30:00',
      duree_minutes: 30,
    }, 5)

    expect(result).toEqual({ id: 42 })
  })

  it('statut par défaut : PENDING', async () => {
    await createRendezVous(db, 1, {
      titre: 'Test', debut: '2026-07-10 14:30:00', duree_minutes: 30,
    }, 5)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO rendez_vous'))
    // statut est à l'index 9 dans le bind (0-indexed)
    expect(insertCall?.params[9]).toBe('PENDING')
  })

  it('type_rdv par défaut : reparation', async () => {
    await createRendezVous(db, 1, {
      titre: 'Test', debut: '2026-07-10 14:30:00',
    }, 5)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO rendez_vous'))
    // type_rdv est à l'index 10
    expect(insertCall?.params[10]).toBe('reparation')
  })

  it('couleur par défaut : #3B82F6', async () => {
    await createRendezVous(db, 1, {
      titre: 'Test', debut: '2026-07-10 14:30:00',
    }, 5)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO rendez_vous'))
    // couleur est à l'index 15
    expect(insertCall?.params[15]).toBe('#3B82F6')
  })

  it('user_id fallback : utilise userId si body.user_id absent', async () => {
    await createRendezVous(db, 1, {
      titre: 'Test', debut: '2026-07-10 14:30:00',
    }, 99)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO rendez_vous'))
    // user_id est à l'index 3
    expect(insertCall?.params[3]).toBe(99)
  })

  it('user_id explicite : prioritaire sur userId', async () => {
    await createRendezVous(db, 1, {
      titre: 'Test', debut: '2026-07-10 14:30:00', user_id: 7,
    }, 99)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO rendez_vous'))
    expect(insertCall?.params[3]).toBe(7)
  })

  it('calcule fin automatiquement si absent (debut + duree_minutes)', async () => {
    await createRendezVous(db, 1, {
      titre: 'Test', debut: '2026-07-10 14:30:00', duree_minutes: 45,
    }, 5)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO rendez_vous'))
    // fin est à l'index 7 (0-indexed) : boutique_id=0, client_id=1, ticket_id=2, user_id=3, titre=4, desc=5, debut=6, fin=7
    const fin = insertCall?.params[7] as string
    expect(fin).toBeTruthy()
    // 14:30 + 45 min = 15:15
    expect(fin).toContain('15:15')
  })

  it('fin explicite : utilisée telle quelle', async () => {
    await createRendezVous(db, 1, {
      titre: 'Test', debut: '2026-07-10 14:30:00', fin: '2026-07-10 16:00:00',
    }, 5)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO rendez_vous'))
    expect(insertCall?.params[7]).toBe('2026-07-10 16:00:00')
  })

  it('génère un ical_token (32 chars hex)', async () => {
    await createRendezVous(db, 1, {
      titre: 'Test', debut: '2026-07-10 14:30:00',
    }, 5)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO rendez_vous'))
    // ical_token est à l'index 14
    const token = insertCall?.params[14] as string
    expect(token).toMatch(/^[0-9a-f]{32}$/)
  })

  it('rappel_minutes par défaut : 60', async () => {
    await createRendezVous(db, 1, {
      titre: 'Test', debut: '2026-07-10 14:30:00',
    }, 5)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO rendez_vous'))
    // rappel_minutes est à l'index 13
    expect(insertCall?.params[13]).toBe(60)
  })

  it('lève Error si INSERT retourne null', async () => {
    db.__setNotFound(SQL_INSERT_RDV)

    await expect(createRendezVous(db, 1, {
      titre: 'Test', debut: '2026-07-10 14:30:00',
    }, 5)).rejects.toThrow('Erreur création RDV.')
  })
})

// ─── updateRendezVous ─────────────────────────────────────────────────────────

describe('updateRendezVous()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('lève Error si RDV introuvable', async () => {
    db.__setNotFound(SQL_GET_RDV_FOR_UPDATE)

    await expect(updateRendezVous(db, 999, 1, { titre: 'Nouveau titre' }))
      .rejects.toThrow('RDV introuvable.')
  })

  it('exécute UPDATE si RDV trouvé', async () => {
    db.__setResponse(SQL_GET_RDV_FOR_UPDATE, RDV_ROW)

    await updateRendezVous(db, 1, 1, { titre: 'Nouveau titre' })

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE rendez_vous'))
    expect(updateCall).toBeDefined()
  })

  it('titre mis à jour (trim appliqué)', async () => {
    db.__setResponse(SQL_GET_RDV_FOR_UPDATE, RDV_ROW)

    await updateRendezVous(db, 1, 1, { titre: '  Titre avec espaces  ' })

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE rendez_vous'))
    // titre est le 4e param (index 3)
    expect(updateCall?.params[3]).toBe('Titre avec espaces')
  })

  it('recalcule fin si debut change', async () => {
    db.__setResponse(SQL_GET_RDV_FOR_UPDATE, RDV_ROW)

    await updateRendezVous(db, 1, 1, { debut: '2026-07-15 10:00:00' })

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE rendez_vous'))
    // fin est à l'index 6 : client_id=0, ticket_id=1, user_id=2, titre=3, desc=4, debut=5, fin=6
    const fin = updateCall?.params[6] as string
    // debut=10:00 + duree=30 → fin=10:30
    expect(fin).toContain('10:30')
  })

  it('conserve les valeurs existantes si champ non fourni', async () => {
    db.__setResponse(SQL_GET_RDV_FOR_UPDATE, { ...RDV_ROW, notes: 'Note existante' })

    await updateRendezVous(db, 1, 1, { titre: 'Nouveau titre' })

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE rendez_vous'))
    // notes est à l'index 14
    expect(updateCall?.params[14]).toBe('Note existante')
  })
})

// ─── updateStatutRdv ──────────────────────────────────────────────────────────

describe('updateStatutRdv()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('lève Error si RDV introuvable', async () => {
    db.__setNotFound(SQL_GET_STATUT_FOR_UPDATE)

    await expect(updateStatutRdv(db, 999, 1, 'SCHEDULED'))
      .rejects.toThrow('RDV introuvable.')
  })

  it('PENDING → SCHEDULED : transition autorisée', async () => {
    db.__setResponse(SQL_GET_STATUT_FOR_UPDATE, { statut: 'PENDING' })

    await updateStatutRdv(db, 1, 1, 'SCHEDULED')

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE rendez_vous'))
    expect(updateCall?.params[0]).toBe('SCHEDULED')
  })

  it('PENDING → CANCELLED : transition autorisée', async () => {
    db.__setResponse(SQL_GET_STATUT_FOR_UPDATE, { statut: 'PENDING' })

    await updateStatutRdv(db, 1, 1, 'CANCELLED')

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE rendez_vous'))
    expect(updateCall?.params[0]).toBe('CANCELLED')
  })

  it('SCHEDULED → DONE : transition autorisée', async () => {
    db.__setResponse(SQL_GET_STATUT_FOR_UPDATE, { statut: 'SCHEDULED' })

    await updateStatutRdv(db, 1, 1, 'DONE')

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE rendez_vous'))
    expect(updateCall?.params[0]).toBe('DONE')
  })

  it('SCHEDULED → NO_SHOW : transition autorisée', async () => {
    db.__setResponse(SQL_GET_STATUT_FOR_UPDATE, { statut: 'SCHEDULED' })

    await updateStatutRdv(db, 1, 1, 'NO_SHOW')

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE rendez_vous'))
    expect(updateCall?.params[0]).toBe('NO_SHOW')
  })

  it('SCHEDULED → CONVERTED : transition autorisée', async () => {
    db.__setResponse(SQL_GET_STATUT_FOR_UPDATE, { statut: 'SCHEDULED' })

    await updateStatutRdv(db, 1, 1, 'CONVERTED')

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE rendez_vous'))
    expect(updateCall?.params[0]).toBe('CONVERTED')
  })

  it('NO_SHOW → SCHEDULED : re-planification autorisée', async () => {
    db.__setResponse(SQL_GET_STATUT_FOR_UPDATE, { statut: 'NO_SHOW' })

    await updateStatutRdv(db, 1, 1, 'SCHEDULED')

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE rendez_vous'))
    expect(updateCall?.params[0]).toBe('SCHEDULED')
  })

  it('DONE → SCHEDULED : transition INTERDITE', async () => {
    db.__setResponse(SQL_GET_STATUT_FOR_UPDATE, { statut: 'DONE' })

    await expect(updateStatutRdv(db, 1, 1, 'SCHEDULED'))
      .rejects.toThrow('Transition interdite')
  })

  it('CANCELLED → PENDING : transition INTERDITE', async () => {
    db.__setResponse(SQL_GET_STATUT_FOR_UPDATE, { statut: 'CANCELLED' })

    await expect(updateStatutRdv(db, 1, 1, 'PENDING'))
      .rejects.toThrow('Transition interdite')
  })

  it('CONVERTED est terminal — aucune transition autorisée', async () => {
    db.__setResponse(SQL_GET_STATUT_FOR_UPDATE, { statut: 'CONVERTED' })

    await expect(updateStatutRdv(db, 1, 1, 'SCHEDULED'))
      .rejects.toThrow('Transition interdite')
  })

  it('PENDING → DONE : transition INTERDITE (saut d\'étape)', async () => {
    db.__setResponse(SQL_GET_STATUT_FOR_UPDATE, { statut: 'PENDING' })

    await expect(updateStatutRdv(db, 1, 1, 'DONE'))
      .rejects.toThrow('Transition interdite')
  })

  it('message d\'erreur liste les transitions autorisées', async () => {
    db.__setResponse(SQL_GET_STATUT_FOR_UPDATE, { statut: 'DONE' })

    await expect(updateStatutRdv(db, 1, 1, 'PENDING'))
      .rejects.toThrow('aucune')
  })
})

// ─── deleteRendezVous ─────────────────────────────────────────────────────────

describe('deleteRendezVous()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('lève Error si RDV absent', async () => {
    db.__setNotFound(SQL_GET_RDV_FOR_DELETE)

    await expect(deleteRendezVous(db, 999, 1))
      .rejects.toThrow('RDV introuvable.')
  })

  it('effectue soft delete (actif = 0)', async () => {
    db.__setResponse(SQL_GET_RDV_FOR_DELETE, { id: 1 })

    await deleteRendezVous(db, 1, 1)

    const calls = db.__getCalls()
    const deleteCall = calls.find(c => c.sql.includes('actif = 0'))
    expect(deleteCall).toBeDefined()
    expect(deleteCall?.params[0]).toBe(1) // id
  })

  it('n\'exécute pas DELETE physique', async () => {
    db.__setResponse(SQL_GET_RDV_FOR_DELETE, { id: 1 })

    await deleteRendezVous(db, 1, 1)

    const calls = db.__getCalls()
    const deleteCall = calls.find(c => c.sql.startsWith('DELETE'))
    expect(deleteCall).toBeUndefined()
  })
})

// ─── getAgendaView ────────────────────────────────────────────────────────────

describe('getAgendaView()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne un objet vide si aucun RDV', async () => {
    db.__setListResponse(SQL_AGENDA_VIEW, [])

    const result = await getAgendaView(db, 1, '2026-07-01', '2026-07-07')

    expect(result).toEqual({})
  })

  it('groupe les RDV par date YYYY-MM-DD', async () => {
    db.__setListResponse(SQL_AGENDA_VIEW, [
      { ...RDV_ROW, debut: '2026-07-10 09:00:00' },
      { ...RDV_ROW, id: 2, debut: '2026-07-10 14:30:00' },
      { ...RDV_ROW, id: 3, debut: '2026-07-11 10:00:00' },
    ])

    const result = await getAgendaView(db, 1, '2026-07-10', '2026-07-11')

    expect(Object.keys(result)).toHaveLength(2)
    expect(result['2026-07-10']).toHaveLength(2)
    expect(result['2026-07-11']).toHaveLength(1)
  })

  it('RDV ordonnés par heure dans chaque groupe', async () => {
    db.__setListResponse(SQL_AGENDA_VIEW, [
      { ...RDV_ROW, debut: '2026-07-10 09:00:00' },
      { ...RDV_ROW, id: 2, debut: '2026-07-10 14:30:00' },
    ])

    const result = await getAgendaView(db, 1, '2026-07-10', '2026-07-10')

    expect(result['2026-07-10'][0].debut).toBe('2026-07-10 09:00:00')
    expect(result['2026-07-10'][1].debut).toBe('2026-07-10 14:30:00')
  })

  it('SQL exclut les RDV CANCELLED', async () => {
    db.__setListResponse(SQL_AGENDA_VIEW, [])

    await getAgendaView(db, 1, '2026-07-01', '2026-07-31')

    const calls = db.__getCalls()
    const sqlCall = calls.find(c => c.sql.includes('rendez_vous'))
    expect(sqlCall?.sql).toContain("statut != 'CANCELLED'")
  })

  it('filtre user_id — paramètre transmis si fourni', async () => {
    db.__setListResponse(SQL_AGENDA_VIEW, [])

    await getAgendaView(db, 1, '2026-07-01', '2026-07-31', 5)

    const calls = db.__getCalls()
    const sqlCall = calls.find(c => c.sql.includes('rendez_vous'))
    expect(sqlCall?.params).toContain(5)
  })

  it('sans user_id — paramètre non transmis', async () => {
    db.__setListResponse(SQL_AGENDA_VIEW, [])

    await getAgendaView(db, 1, '2026-07-01', '2026-07-31')

    const calls = db.__getCalls()
    const sqlCall = calls.find(c => c.sql.includes('rendez_vous'))
    // Sans userId, le SQL ne contient pas 'user_id = ?'
    expect(sqlCall?.sql).not.toContain('user_id = ?')
  })
})

// ─── getKpisAgenda ────────────────────────────────────────────────────────────

describe('getKpisAgenda()', () => {
  let db: ReturnType<typeof createMockD1>

  function setupKpis(overrides: Partial<{
    total: number; auj: number; semaine: number; en_attente: number; done: number
  }> = {}) {
    const d = { total: 20, auj: 3, semaine: 10, en_attente: 7, done: 15, ...overrides }
    db.__setResponse(SQL_KPI_TOTAL, { cnt: d.total })
    db.__setResponse(SQL_KPI_AUJ, { cnt: d.auj })
    db.__setResponse(SQL_KPI_SEMAINE, { cnt: d.semaine })
    db.__setResponse(SQL_KPI_EN_ATTENTE, { cnt: d.en_attente })
    db.__setResponse(SQL_KPI_DONE, { cnt: d.done })
  }

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne les 5 champs KPI attendus', async () => {
    setupKpis()

    const result = await getKpisAgenda(db, 1)

    expect(result).toHaveProperty('total_rdv')
    expect(result).toHaveProperty('rdv_auj')
    expect(result).toHaveProperty('rdv_semaine')
    expect(result).toHaveProperty('en_attente')
    expect(result).toHaveProperty('taux_honore')
  })

  it('valeurs correctes pour les compteurs simples', async () => {
    setupKpis({ total: 30, auj: 5, semaine: 15, en_attente: 8 })

    const result = await getKpisAgenda(db, 1)

    expect(result.total_rdv).toBe(30)
    expect(result.rdv_auj).toBe(5)
    expect(result.rdv_semaine).toBe(15)
    expect(result.en_attente).toBe(8)
  })

  it('taux_honore = round(done / total * 100)', async () => {
    // 15 DONE / 20 total = 75%
    setupKpis({ total: 20, done: 15 })

    const result = await getKpisAgenda(db, 1)

    expect(result.taux_honore).toBe(75)
  })

  it('taux_honore = 0 si aucun RDV', async () => {
    setupKpis({ total: 0, done: 0 })

    const result = await getKpisAgenda(db, 1)

    expect(result.taux_honore).toBe(0)
  })

  it('taux_honore = 100 si tous honorés', async () => {
    setupKpis({ total: 10, done: 10 })

    const result = await getKpisAgenda(db, 1)

    expect(result.taux_honore).toBe(100)
  })

  it('retourne 0 par défaut si SQL retourne null', async () => {
    // aucune réponse configurée → null partout

    const result = await getKpisAgenda(db, 1)

    expect(result.total_rdv).toBe(0)
    expect(result.taux_honore).toBe(0)
  })

  it('exécute exactement 5 requêtes SQL (Promise.all)', async () => {
    setupKpis()

    await getKpisAgenda(db, 1)

    const calls = db.__getCalls()
    expect(calls.length).toBeGreaterThanOrEqual(5)
  })

  it('boutique_id transmis à toutes les requêtes', async () => {
    setupKpis()

    await getKpisAgenda(db, 42)

    const calls = db.__getCalls()
    for (const call of calls) {
      expect(call.params[0]).toBe(42)
    }
  })
})

// ─── getOrCreateIcalToken ─────────────────────────────────────────────────────

describe('getOrCreateIcalToken()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne le token existant si présent', async () => {
    db.__setResponse(SQL_GET_ICAL_TOKEN, { token: 'existing_token_32chars_hex_here' })

    const result = await getOrCreateIcalToken(db, 1)

    expect(result).toBe('existing_token_32chars_hex_here')
    // Pas d'INSERT
    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO boutique_ical_tokens'))
    expect(insertCall).toBeUndefined()
  })

  it('crée un nouveau token si absent', async () => {
    db.__setNotFound(SQL_GET_ICAL_TOKEN)

    const result = await getOrCreateIcalToken(db, 1)

    // Token généré : 32 chars hex
    expect(result).toMatch(/^[0-9a-f]{32}$/)
  })

  it('insère le nouveau token en base', async () => {
    db.__setNotFound(SQL_GET_ICAL_TOKEN)

    const token = await getOrCreateIcalToken(db, 1)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO boutique_ical_tokens'))
    expect(insertCall).toBeDefined()
    expect(insertCall?.params[0]).toBe(1) // boutique_id
    expect(insertCall?.params[1]).toBe(token)
  })

  it('deux appels consécutifs — pas de doublon INSERT si token trouvé au 2ème', async () => {
    // 1er appel : absent → crée
    db.__setNotFound(SQL_GET_ICAL_TOKEN)
    const token1 = await getOrCreateIcalToken(db, 1)

    // 2ème appel : simule que le token est maintenant en base
    db.__setResponse(SQL_GET_ICAL_TOKEN, { token: token1 })
    const token2 = await getOrCreateIcalToken(db, 1)

    expect(token2).toBe(token1)
  })
})

// ─── generateIcal ─────────────────────────────────────────────────────────────

describe('generateIcal()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse(SQL_BOUTIQUE_NOM, { nom: 'iziGSM Paris' })
  })

  it('retourne un flux iCal valide (BEGIN:VCALENDAR ... END:VCALENDAR)', async () => {
    db.__setListResponse(SQL_ICAL_ROWS, [])

    const result = await generateIcal(db, 1)

    expect(result).toContain('BEGIN:VCALENDAR')
    expect(result).toContain('END:VCALENDAR')
    expect(result).toContain('VERSION:2.0')
  })

  it('utilise CRLF comme séparateur (RFC 5545)', async () => {
    db.__setListResponse(SQL_ICAL_ROWS, [])

    const result = await generateIcal(db, 1)

    expect(result).toContain('\r\n')
    // Pas de LF seul (toutes les fins de ligne sont CRLF)
    const lines = result.split('\r\n')
    expect(lines.length).toBeGreaterThan(5)
  })

  it('inclut le nom de la boutique dans X-WR-CALNAME', async () => {
    db.__setListResponse(SQL_ICAL_ROWS, [])

    const result = await generateIcal(db, 1)

    expect(result).toContain('X-WR-CALNAME:iziGSM Paris')
  })

  it('boutique null → nom par défaut iziGSM', async () => {
    db.__setNotFound(SQL_BOUTIQUE_NOM)
    db.__setListResponse(SQL_ICAL_ROWS, [])

    const result = await generateIcal(db, 1)

    expect(result).toContain('X-WR-CALNAME:iziGSM')
  })

  it('génère un VEVENT par RDV', async () => {
    db.__setListResponse(SQL_ICAL_ROWS, [
      { ...RDV_ROW, created_at: '2026-07-01T10:00:00', client_nom: null, client_prenom: null },
      { ...RDV_ROW, id: 2, titre: 'Devis Samsung', created_at: '2026-07-02T10:00:00', client_nom: null, client_prenom: null },
    ])

    const result = await generateIcal(db, 1)

    const vevents = result.split('BEGIN:VEVENT').length - 1
    expect(vevents).toBe(2)
  })

  it('UID stable : rdv-{id}-{ical_token}@izigsm', async () => {
    db.__setListResponse(SQL_ICAL_ROWS, [
      { ...RDV_ROW, created_at: '2026-07-01T10:00:00', client_nom: null, client_prenom: null },
    ])

    const result = await generateIcal(db, 1)

    expect(result).toContain(`UID:rdv-1-${RDV_ROW.ical_token}@izigsm`)
  })

  it('statut DONE → STATUS:COMPLETED dans le VEVENT', async () => {
    db.__setListResponse(SQL_ICAL_ROWS, [
      { ...RDV_ROW, statut: 'DONE', created_at: '2026-07-01T10:00:00', client_nom: null, client_prenom: null },
    ])

    const result = await generateIcal(db, 1)

    expect(result).toContain('STATUS:COMPLETED')
  })

  it('statut SCHEDULED → STATUS:CONFIRMED dans le VEVENT', async () => {
    db.__setListResponse(SQL_ICAL_ROWS, [
      { ...RDV_ROW, statut: 'SCHEDULED', created_at: '2026-07-01T10:00:00', client_nom: null, client_prenom: null },
    ])

    const result = await generateIcal(db, 1)

    expect(result).toContain('STATUS:CONFIRMED')
  })

  it('DTSTART/DTEND au format iCal UTC (AAAAMMJJTHHMMSSz)', async () => {
    db.__setListResponse(SQL_ICAL_ROWS, [
      { ...RDV_ROW, debut: '2026-07-10 14:30:00', fin: '2026-07-10 15:00:00', created_at: '2026-07-01T10:00:00', client_nom: null, client_prenom: null },
    ])

    const result = await generateIcal(db, 1)

    // Format : 20260710T143000Z
    expect(result).toContain('DTSTART:20260710T143000Z')
    expect(result).toContain('DTEND:20260710T150000Z')
  })

  it('PRODID contient iziGSM', async () => {
    db.__setListResponse(SQL_ICAL_ROWS, [])

    const result = await generateIcal(db, 1)

    expect(result).toContain('PRODID:-//iziGSM//Agenda//FR')
  })

  it('flux vide : uniquement l\'enveloppe VCALENDAR (sans VEVENT)', async () => {
    db.__setListResponse(SQL_ICAL_ROWS, [])

    const result = await generateIcal(db, 1)

    expect(result).not.toContain('BEGIN:VEVENT')
    expect(result).toContain('BEGIN:VCALENDAR')
    expect(result).toContain('END:VCALENDAR')
  })
})
