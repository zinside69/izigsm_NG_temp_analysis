/**
 * tests/clientService.test.ts
 * Sprint 2.30 — Couverture clientService.ts
 *
 * Fonctions testées :
 *   listClients           (7 tests)
 *   getClientById         (4 tests)
 *   createClient          (3 tests)
 *   updateClient          (3 tests)
 *   deleteClient          (2 tests)
 *   addAppareil           (3 tests)
 *   getHistoriqueClient   (5 tests)
 *   importClients         (6 tests)
 *   getClientEmailPrenom  (3 tests)
 *   countTicketsByClient  (2 tests)
 *
 * Total : 38 tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import {
  listClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  addAppareil,
  getHistoriqueClient,
  importClients,
  getClientEmailPrenom,
  countTicketsByClient,
} from '../src/services/clientService'

// ─── SQL normalisés ───────────────────────────────────────────────────────────

const SQL_COUNT_CLIENTS = `SELECT COUNT(*) as cnt FROM clients c WHERE c.boutique_id = ? AND c.actif = 1`

const SQL_LIST_CLIENTS = `SELECT c.id, c.prenom, c.nom, c.email, c.telephone, c.ville, c.created_at, (SELECT COUNT(*) FROM tickets t WHERE t.client_id = c.id AND t.actif = 1) as nb_tickets, (SELECT COALESCE(SUM(f.total_ttc), 0) FROM factures f WHERE f.client_id = c.id AND f.statut != 'ANNULE') as ca_total FROM clients c WHERE c.boutique_id = ? AND c.actif = 1 ORDER BY c.created_at DESC LIMIT ? OFFSET ?`

const SQL_GET_CLIENT = `SELECT c.*, b.nom as boutique_nom FROM clients c JOIN boutiques b ON b.id = c.boutique_id WHERE c.id = ? AND c.actif = 1`

const SQL_GET_APPAREILS = `SELECT * FROM appareils WHERE client_id = ? ORDER BY created_at DESC`

const SQL_INSERT_CLIENT = `INSERT INTO clients (boutique_id, prenom, nom, email, telephone, adresse, code_postal, ville, pays, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`

const SQL_UPDATE_CLIENT = `UPDATE clients SET prenom=?, nom=?, email=?, telephone=?, adresse=?, code_postal=?, ville=?, pays=?, notes=?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND actif = 1`

const SQL_DELETE_CLIENT = `UPDATE clients SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND actif = 1`

const SQL_INSERT_APPAREIL = `INSERT INTO appareils (client_id, marque, modele, type, imei, numero_serie, couleur, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`

// Historique — 3 requêtes Promise.all
const SQL_HISTO_TICKETS = `SELECT t.id, t.numero, t.statut, t.description_panne, t.appareil_marque, t.appareil_modele, t.prix_final, t.created_at, t.updated_at FROM tickets t WHERE t.client_id = ? AND t.boutique_id = ? AND t.actif = 1 ORDER BY t.created_at DESC LIMIT 50`

const SQL_HISTO_FACTURES = `SELECT f.id, f.numero, f.statut, f.total_ttc, f.issued_at, f.created_at FROM factures f WHERE f.client_id = ? AND f.boutique_id = ? AND f.statut != 'ANNULE' ORDER BY f.created_at DESC LIMIT 50`

const SQL_HISTO_RDV = `SELECT rv.id, rv.type_rdv as type, rv.statut, rv.debut, rv.fin, rv.description, rv.created_at FROM rendez_vous rv WHERE rv.client_id = ? AND rv.boutique_id = ? AND rv.actif = 1 ORDER BY rv.debut DESC LIMIT 20`

// Import : check doublon email
const SQL_CHECK_EMAIL = `SELECT id FROM clients WHERE email = ? AND boutique_id = ? AND actif = 1`

const SQL_IMPORT_INSERT = `INSERT INTO clients (boutique_id, prenom, nom, email, telephone, adresse, code_postal, ville, pays, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

// getClientEmailPrenom
const SQL_GET_EMAIL_PRENOM = `SELECT email, prenom FROM clients WHERE id = ? LIMIT 1`

// countTicketsByClient
const SQL_COUNT_TICKETS = `SELECT COUNT(*) as cnt FROM tickets WHERE client_id = ? AND actif = 1`

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CLIENT_ROW = {
  id: 10, boutique_id: 1, prenom: 'Alice', nom: 'Dupont',
  email: 'alice@example.com', telephone: '0601020304',
  adresse: '1 rue test', code_postal: '75001', ville: 'Paris', pays: 'France',
  notes: null, actif: 1, created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T10:00:00Z',
  boutique_nom: 'Ma Boutique',
}

const CLIENT_WITH_AGGS = { ...CLIENT_ROW, nb_tickets: 3, ca_total: 299.99 }

const APPAREIL_ROW = {
  id: 5, client_id: 10, marque: 'Apple', modele: 'iPhone 15',
  type: 'smartphone', imei: null, numero_serie: null, couleur: null, notes: null,
  created_at: '2026-01-01T10:00:00Z',
}

// ─── listClients ──────────────────────────────────────────────────────────────

describe('listClients', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne data + total + pagination par défaut', async () => {
    db.__setResponse(SQL_COUNT_CLIENTS, { cnt: 5 })
    db.__setListResponse(SQL_LIST_CLIENTS, [CLIENT_ROW])

    const result = await listClients(db as any, 1)

    expect(result.total).toBe(5)
    expect(result.data).toHaveLength(1)
    expect(result.page).toBe(1)
    expect(result.limit).toBe(50)
    expect(result.pages).toBe(1)
  })

  it('total = 0 → data vide, pages = 0', async () => {
    db.__setResponse(SQL_COUNT_CLIENTS, { cnt: 0 })
    db.__setListResponse(SQL_LIST_CLIENTS, [])

    const result = await listClients(db as any, 1)

    expect(result.total).toBe(0)
    expect(result.data).toHaveLength(0)
    expect(result.pages).toBe(0)
  })

  it('filtre search : 4 LIKE injectés dans les bindings du COUNT', async () => {
    const SQL_COUNT_SEARCH = `SELECT COUNT(*) as cnt FROM clients c WHERE c.boutique_id = ? AND c.actif = 1 AND (c.nom LIKE ? OR c.prenom LIKE ? OR c.email LIKE ? OR c.telephone LIKE ?)`
    const SQL_LIST_SEARCH  = `SELECT c.id, c.prenom, c.nom, c.email, c.telephone, c.ville, c.created_at, (SELECT COUNT(*) FROM tickets t WHERE t.client_id = c.id AND t.actif = 1) as nb_tickets, (SELECT COALESCE(SUM(f.total_ttc), 0) FROM factures f WHERE f.client_id = c.id AND f.statut != 'ANNULE') as ca_total FROM clients c WHERE c.boutique_id = ? AND c.actif = 1 AND (c.nom LIKE ? OR c.prenom LIKE ? OR c.email LIKE ? OR c.telephone LIKE ?) ORDER BY c.created_at DESC LIMIT ? OFFSET ?`
    db.__setResponse(SQL_COUNT_SEARCH, { cnt: 1 })
    db.__setListResponse(SQL_LIST_SEARCH, [CLIENT_ROW])

    await listClients(db as any, 1, { search: 'alice' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT(*) as cnt'))
    expect(countCall!.params[1]).toBe('%alice%')
  })

  it('pagination : page 2, limit 10 → reflété dans result', async () => {
    db.__setResponse(SQL_COUNT_CLIENTS, { cnt: 5 })
    db.__setListResponse(SQL_LIST_CLIENTS, [])

    const result = await listClients(db as any, 1, { limit: 10, offset: 10, page: 2 })

    expect(result.page).toBe(2)
    expect(result.limit).toBe(10)
  })

  it('boutique_id isolé : premier binding du COUNT = 42', async () => {
    db.__setResponse(SQL_COUNT_CLIENTS, { cnt: 0 })
    db.__setListResponse(SQL_LIST_CLIENTS, [])

    await listClients(db as any, 42)

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT(*) as cnt'))
    expect(countCall!.params[0]).toBe(42)
  })

  it('pages = ceil(total / limit)', async () => {
    db.__setResponse(SQL_COUNT_CLIENTS, { cnt: 13 })
    db.__setListResponse(SQL_LIST_CLIENTS, [])

    const result = await listClients(db as any, 1, { limit: 5 })

    expect(result.pages).toBe(3) // ceil(13/5)
  })

  it('retourne nb_tickets et ca_total depuis la sous-requête SQL', async () => {
    db.__setResponse(SQL_COUNT_CLIENTS, { cnt: 1 })
    db.__setListResponse(SQL_LIST_CLIENTS, [CLIENT_WITH_AGGS])

    const result = await listClients(db as any, 1)

    expect((result.data[0] as any).nb_tickets).toBe(3)
    expect((result.data[0] as any).ca_total).toBe(299.99)
  })
})

// ─── getClientById ────────────────────────────────────────────────────────────

describe('getClientById', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne client + appareils si trouvé', async () => {
    db.__setResponse(SQL_GET_CLIENT, CLIENT_ROW)
    db.__setListResponse(SQL_GET_APPAREILS, [APPAREIL_ROW])

    const result = await getClientById(db as any, 10)

    expect(result).not.toBeNull()
    expect(result!.id).toBe(10)
    expect(result!.prenom).toBe('Alice')
    expect((result as any).appareils).toHaveLength(1)
    expect((result as any).appareils[0].marque).toBe('Apple')
  })

  it('retourne null si client introuvable', async () => {
    db.__setResponse(SQL_GET_CLIENT, null)

    const result = await getClientById(db as any, 999)

    expect(result).toBeNull()
  })

  it('boutique_nom présent dans résultat', async () => {
    db.__setResponse(SQL_GET_CLIENT, CLIENT_ROW)
    db.__setListResponse(SQL_GET_APPAREILS, [])

    const result = await getClientById(db as any, 10)

    expect((result as any).boutique_nom).toBe('Ma Boutique')
  })

  it('appareils vide si aucun appareil', async () => {
    db.__setResponse(SQL_GET_CLIENT, CLIENT_ROW)
    db.__setListResponse(SQL_GET_APPAREILS, [])

    const result = await getClientById(db as any, 10)

    expect((result as any).appareils).toHaveLength(0)
  })
})

// ─── createClient ─────────────────────────────────────────────────────────────

describe('createClient', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne { id } après INSERT', async () => {
    db.__setResponse(SQL_INSERT_CLIENT, { id: 99 })

    const result = await createClient(db as any, 1, {
      prenom: 'Bob', nom: 'Martin',
      email: 'bob@example.com', telephone: '0600000000',
    })

    expect(result.id).toBe(99)
  })

  it('pays défaut = France si non fourni', async () => {
    db.__setResponse(SQL_INSERT_CLIENT, { id: 1 })

    await createClient(db as any, 1, { prenom: 'X', nom: 'Y' })

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.includes('INSERT INTO clients'))
    // (boutique_id, prenom, nom, email, tel, adr, cp, ville, pays, notes)
    expect(insertCall!.params[8]).toBe('France')
  })

  it('champs optionnels null si non fournis', async () => {
    db.__setResponse(SQL_INSERT_CLIENT, { id: 2 })

    await createClient(db as any, 1, { prenom: 'Z', nom: 'W' })

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.includes('INSERT INTO clients'))
    expect(insertCall!.params[3]).toBeNull() // email
    expect(insertCall!.params[4]).toBeNull() // telephone
  })
})

// ─── updateClient ─────────────────────────────────────────────────────────────

describe('updateClient', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne true (mock run() changes=1 par défaut)', async () => {
    const result = await updateClient(db as any, 10, {
      prenom: 'Alice', nom: 'Dupont', email: 'alice@new.com',
    })

    expect(result).toBe(true)
  })

  it('SQL UPDATE envoyé avec le bon id en dernier param', async () => {
    await updateClient(db as any, 77, { prenom: 'A', nom: 'B' })

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.includes('UPDATE clients'))
    expect(updateCall!.params[updateCall!.params.length - 1]).toBe(77)
  })

  it('pays défaut France si non fourni', async () => {
    await updateClient(db as any, 10, { prenom: 'A', nom: 'B' })

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.includes('UPDATE clients'))
    // (prenom, nom, email, tel, adr, cp, ville, pays, notes, id)
    expect(updateCall!.params[7]).toBe('France')
  })
})

// ─── deleteClient ─────────────────────────────────────────────────────────────

describe('deleteClient', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('soft delete : SQL SET actif = 0 envoyé avec le bon id', async () => {
    const result = await deleteClient(db as any, 10)

    // mock run() retourne changes:1 par défaut
    expect(result).toBe(true)

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.includes('UPDATE clients SET actif = 0'))
    expect(updateCall).toBeDefined()
    expect(updateCall!.params[0]).toBe(10)
  })

  it('SQL exact = actif=0 + updated_at', async () => {
    await deleteClient(db as any, 42)

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql === SQL_DELETE_CLIENT)
    expect(updateCall).toBeDefined()
    expect(updateCall!.params[0]).toBe(42)
  })
})

// ─── addAppareil ──────────────────────────────────────────────────────────────

describe('addAppareil', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne { id } après INSERT', async () => {
    db.__setResponse(SQL_INSERT_APPAREIL, { id: 55 })

    const result = await addAppareil(db as any, 10, {
      marque: 'Samsung', modele: 'Galaxy S24',
    })

    expect(result.id).toBe(55)
  })

  it('type par défaut = smartphone si non fourni', async () => {
    db.__setResponse(SQL_INSERT_APPAREIL, { id: 1 })

    await addAppareil(db as any, 10, { marque: 'Apple', modele: 'iPad' })

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.includes('INSERT INTO appareils'))
    // (client_id, marque, modele, type, imei, numero_serie, couleur, notes)
    expect(insertCall!.params[3]).toBe('smartphone')
  })

  it('champs optionnels null si non fournis', async () => {
    db.__setResponse(SQL_INSERT_APPAREIL, { id: 2 })

    await addAppareil(db as any, 10, { marque: 'X', modele: 'Y' })

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.includes('INSERT INTO appareils'))
    expect(insertCall!.params[4]).toBeNull() // imei
    expect(insertCall!.params[5]).toBeNull() // numero_serie
  })
})

// ─── getHistoriqueClient ──────────────────────────────────────────────────────

describe('getHistoriqueClient', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  function setupHistorique(tickets: any[], factures: any[], rdv: any[]) {
    db.__setListResponse(SQL_HISTO_TICKETS, tickets)
    db.__setListResponse(SQL_HISTO_FACTURES, factures)
    db.__setListResponse(SQL_HISTO_RDV, rdv)
  }

  it('retourne les 5 clés : tickets, factures, rachats, rendez_vous, kpis', async () => {
    setupHistorique([], [], [])

    const result = await getHistoriqueClient(db as any, 10, 1)

    expect(result).toHaveProperty('tickets')
    expect(result).toHaveProperty('factures')
    expect(result).toHaveProperty('rachats')
    expect(result).toHaveProperty('rendez_vous')
    expect(result).toHaveProperty('kpis')
  })

  it('kpis.nb_tickets = nombre de tickets retournés', async () => {
    setupHistorique(
      [{ id: 1, statut: 'TERMINE' }, { id: 2, statut: 'EN_COURS' }],
      [], []
    )

    const result = await getHistoriqueClient(db as any, 10, 1)

    expect(result.kpis.nb_tickets).toBe(2)
  })

  it('kpis.ca_total = somme total_ttc des factures', async () => {
    setupHistorique(
      [],
      [{ id: 1, total_ttc: 150 }, { id: 2, total_ttc: 80 }],
      []
    )

    const result = await getHistoriqueClient(db as any, 10, 1)

    expect(result.kpis.ca_total).toBe(230)
  })

  it('kpis.ticket_ouvert = tickets non dans [CLOTURE, LIVRE, ANNULE]', async () => {
    setupHistorique([
      { id: 1, statut: 'EN_COURS' },
      { id: 2, statut: 'LIVRE' },
      { id: 3, statut: 'CLOTURE' },
      { id: 4, statut: 'RECU' },
    ], [], [])

    const result = await getHistoriqueClient(db as any, 10, 1)

    // EN_COURS et RECU → ouverts (LIVRE + CLOTURE exclus)
    expect(result.kpis.ticket_ouvert).toBe(2)
  })

  it('rachats = tableau vide (pas de client_id sur table rachats)', async () => {
    setupHistorique([], [], [])

    const result = await getHistoriqueClient(db as any, 10, 1)

    expect(result.rachats).toHaveLength(0)
  })
})

// ─── importClients ────────────────────────────────────────────────────────────

describe('importClients', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('insère 2 clients sans email : inserted=2, skipped=0', async () => {
    // Pas de doublon check (pas d'email) → run() changes:1 par défaut
    const result = await importClients(db as any, 1, [
      { prenom: 'Alice', nom: 'Dupont' },
      { prenom: 'Bob',   nom: 'Martin' },
    ])

    expect(result.inserted).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it('déduplique email : client existant → skipped+1', async () => {
    db.__setResponse(SQL_CHECK_EMAIL, { id: 5 }) // doublon trouvé

    const result = await importClients(db as any, 1, [
      { prenom: 'Alice', nom: 'Dupont', email: 'alice@example.com' },
    ])

    expect(result.skipped).toBe(1)
    expect(result.inserted).toBe(0)
  })

  it('ligne sans nom ni prénom → erreur + skipped', async () => {
    const result = await importClients(db as any, 1, [
      { prenom: '', nom: '' },
    ])

    expect(result.skipped).toBe(1)
    expect(result.errors[0]).toMatch(/Ligne 2.*nom ou prénom/)
  })

  it('trim email + telephone avant INSERT', async () => {
    // doublon check → null (pas de doublon)
    db.__setResponse(SQL_CHECK_EMAIL, null)

    await importClients(db as any, 1, [
      { prenom: 'A', nom: 'B', email: '  alice@test.com  ', telephone: '  0600000000  ' },
    ])

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.includes('INSERT INTO clients'))
    expect(insertCall!.params[3]).toBe('alice@test.com') // email trimmé
    expect(insertCall!.params[4]).toBe('0600000000')      // tel trimmé
  })

  it('ligne sans email → INSERT sans check doublon', async () => {
    const result = await importClients(db as any, 1, [
      { prenom: 'E', nom: 'F' },
    ])

    expect(result.inserted).toBe(1)
    expect(result.skipped).toBe(0)

    const calls = db.__getCalls()
    // Aucun SELECT doublon car pas d'email
    const checkCall = calls.find(c => c.sql.includes('SELECT id FROM clients WHERE email'))
    expect(checkCall).toBeUndefined()
  })

  it('exception INSERT → erreur dans errors[], skipped++', async () => {
    db.__setResponse(SQL_CHECK_EMAIL, null) // pas de doublon
    // run() par défaut fonctionne, mais on simule une exception via __setResponseFn
    db.__setResponseFn(SQL_IMPORT_INSERT, (_params) => {
      throw new Error('UNIQUE constraint failed')
    })

    const result = await importClients(db as any, 1, [
      { prenom: 'A', nom: 'B', email: 'err@test.com' },
    ])

    expect(result.skipped).toBe(1)
    expect(result.errors[0]).toMatch(/UNIQUE constraint/)
  })
})

// ─── getClientEmailPrenom ─────────────────────────────────────────────────────

describe('getClientEmailPrenom', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne { email, prenom } si client trouvé', async () => {
    db.__setResponse(SQL_GET_EMAIL_PRENOM, {
      email: 'alice@example.com', prenom: 'Alice',
    })

    const result = await getClientEmailPrenom(db as any, 10)

    expect(result).not.toBeNull()
    expect(result!.email).toBe('alice@example.com')
    expect(result!.prenom).toBe('Alice')
  })

  it('retourne null si client introuvable', async () => {
    db.__setResponse(SQL_GET_EMAIL_PRENOM, null)

    const result = await getClientEmailPrenom(db as any, 999)

    expect(result).toBeNull()
  })

  it('email peut être null (client sans email)', async () => {
    db.__setResponse(SQL_GET_EMAIL_PRENOM, { email: null, prenom: 'Bob' })

    const result = await getClientEmailPrenom(db as any, 10)

    expect(result!.email).toBeNull()
    expect(result!.prenom).toBe('Bob')
  })
})

// ─── countTicketsByClient ─────────────────────────────────────────────────────

describe('countTicketsByClient', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne le nombre de tickets actifs', async () => {
    db.__setResponse(SQL_COUNT_TICKETS, { cnt: 7 })

    const result = await countTicketsByClient(db as any, 10)

    expect(result).toBe(7)
  })

  it('retourne 0 si aucun ticket (fallback ??)', async () => {
    db.__setResponse(SQL_COUNT_TICKETS, null)

    const result = await countTicketsByClient(db as any, 10)

    expect(result).toBe(0)
  })
})
