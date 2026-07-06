/**
 * @file tests/ticketService.test.ts
 * @description Tests unitaires — src/services/ticketService.ts
 *
 * Couverture :
 *   - TRANSITIONS_TICKET     — machine à états : structure et cohérence
 *   - STATUT_LABELS          — 10 entrées, champs requis
 *   - couleurAnciennete      — via getKanban (indirectement)
 *   - listTickets()          — pagination, filtres statut/search
 *   - getKanban()            — 10 colonnes, stats, transitions_possibles
 *   - getTicketById()        — fiche complète avec historique + photos, null si absent
 *   - createTicket()         — INSERT + historique + auditLog
 *   - updateTicket()         — COALESCE champs, priorité invalide, ticket absent
 *   - updateStatutTicket()   — machine à états : transition valide, invalide, terminal
 *   - deleteTicket()         — soft delete actif=0
 *   - getTicketBoutiqueId()  — résolution boutique_id
 *   - getTicketAvecClient()  — données ticket + email client
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import {
  TRANSITIONS_TICKET,
  STATUT_LABELS,
  listTickets,
  getKanban,
  getTicketById,
  createTicket,
  updateTicket,
  updateStatutTicket,
  deleteTicket,
  getTicketBoutiqueId,
  getTicketAvecClient,
  type StatutTicket,
} from '../src/services/ticketService'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TICKET_ROW = {
  id: 42, boutique_id: 1, numero: 'TKT-2026-00042',
  statut: 'recu' as StatutTicket, priorite: 'normale',
  client_id: 7, appareil_id: null,
  appareil_marque: 'Apple', appareil_modele: 'iPhone 14',
  description_panne: 'Écran cassé',
  diagnostic: null, technicien_id: null,
  prix_estime: 120, prix_final: null,
  date_reception: '2026-07-01T10:00:00', date_promesse: null,
  date_commande_pieces: null, date_reception_pieces: null,
  date_cloture: null, date_livraison: null,
  notes_internes: null,
  tracking_token: 'abc123def456abc123def456abc123de',
  actif: 1,
  created_at: '2026-07-01T10:00:00', updated_at: '2026-07-01T10:00:00',
}

const TICKET_WITH_CLIENT = {
  ...TICKET_ROW,
  client_nom: 'Marie Dupont', client_email: 'marie@example.com',
  client_telephone: '0612345678', technicien_nom: null,
}

const KANBAN_TICKET = {
  ...TICKET_ROW,
  client_nom: 'Marie Dupont', client_telephone: '0612345678', technicien_nom: null,
  jours_anciennete: 1,
}

// ─── TRANSITIONS_TICKET ───────────────────────────────────────────────────────

describe('TRANSITIONS_TICKET', () => {
  const TOUS_STATUTS: StatutTicket[] = [
    'recu', 'en_diagnostic', 'attente_accord', 'a_commander', 'commande',
    'pieces_recues', 'en_reparation', 'termine', 'livre', 'annule',
  ]

  it('couvre les 10 statuts', () => {
    expect(Object.keys(TRANSITIONS_TICKET)).toHaveLength(10)
    for (const s of TOUS_STATUTS) {
      expect(TRANSITIONS_TICKET).toHaveProperty(s)
    }
  })

  it('livre et annule sont terminaux (aucune transition)', () => {
    expect(TRANSITIONS_TICKET.livre).toEqual([])
    expect(TRANSITIONS_TICKET.annule).toEqual([])
  })

  it('recu peut aller en_diagnostic ou directement en_reparation ou annule', () => {
    expect(TRANSITIONS_TICKET.recu).toContain('en_diagnostic')
    expect(TRANSITIONS_TICKET.recu).toContain('en_reparation')
    expect(TRANSITIONS_TICKET.recu).toContain('annule')
  })

  it('en_reparation → termine uniquement (hors annule)', () => {
    expect(TRANSITIONS_TICKET.en_reparation).toContain('termine')
    expect(TRANSITIONS_TICKET.en_reparation).toContain('annule')
    expect(TRANSITIONS_TICKET.en_reparation).not.toContain('livre')
  })

  it('termine → livre uniquement', () => {
    expect(TRANSITIONS_TICKET.termine).toEqual(['livre'])
  })

  it('toutes les cibles sont des statuts valides', () => {
    for (const [, cibles] of Object.entries(TRANSITIONS_TICKET)) {
      for (const c of cibles) {
        expect(TOUS_STATUTS).toContain(c)
      }
    }
  })
})

// ─── STATUT_LABELS ────────────────────────────────────────────────────────────

describe('STATUT_LABELS', () => {
  it('couvre les 10 statuts avec label, emoji, color', () => {
    const ATTENDUS: StatutTicket[] = [
      'recu', 'en_diagnostic', 'attente_accord', 'a_commander', 'commande',
      'pieces_recues', 'en_reparation', 'termine', 'livre', 'annule',
    ]
    for (const s of ATTENDUS) {
      expect(STATUT_LABELS[s]).toBeDefined()
      expect(STATUT_LABELS[s].label).toBeTruthy()
      expect(STATUT_LABELS[s].emoji).toBeTruthy()
      expect(STATUT_LABELS[s].color).toBeTruthy()
    }
  })
})

// ─── listTickets ──────────────────────────────────────────────────────────────

describe('listTickets()', () => {
  let db: ReturnType<typeof createMockD1>

  const SQL_COUNT = 'SELECT COUNT(*) AS cnt FROM tickets t WHERE t.boutique_id = ? AND t.actif = 1 AND t.archived_at IS NULL'
  const SQL_LIST  = `SELECT t.id, t.numero, t.statut, t.priorite, t.description_panne, t.appareil_marque, t.appareil_modele, t.prix_estime, t.prix_final, t.date_reception, t.date_promesse, c.prenom || ' ' || c.nom AS client_nom, c.telephone AS client_telephone, u.prenom || ' ' || u.nom AS technicien_nom FROM tickets t JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.technicien_id WHERE t.boutique_id = ? AND t.actif = 1 AND t.archived_at IS NULL ORDER BY t.created_at DESC LIMIT ? OFFSET ?`

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse(SQL_COUNT, { cnt: 2 })
    db.__setListResponse(SQL_LIST, [TICKET_WITH_CLIENT, { ...TICKET_WITH_CLIENT, id: 43 }])
  })

  it('retourne data + pagination', async () => {
    const res = await listTickets(db, 1)
    expect(res.data).toHaveLength(2)
    expect(res.pagination.total).toBe(2)
    expect(res.pagination.page).toBe(1)
  })

  it('pagination page 2 calcule l\'offset', async () => {
    db.__setResponse(SQL_COUNT, { cnt: 25 })
    db.__setListResponse(SQL_LIST, [TICKET_WITH_CLIENT])
    const res = await listTickets(db, 1, { page: 2, limit: 20 })
    expect(res.pagination.page).toBe(2)
    expect(res.pagination.pages).toBe(2)
  })

  it('retourne tableau vide si aucun ticket', async () => {
    db.__setResponse(SQL_COUNT, { cnt: 0 })
    db.__setListResponse(SQL_LIST, [])
    const res = await listTickets(db, 1)
    expect(res.data).toEqual([])
    expect(res.pagination.total).toBe(0)
    expect(res.pagination.pages).toBe(0)
  })
})

// ─── getKanban ────────────────────────────────────────────────────────────────

describe('getKanban()', () => {
  let db: ReturnType<typeof createMockD1>

  const SQL_KANBAN = `SELECT t.id, t.numero, t.statut, t.priorite, t.appareil_marque, t.appareil_modele, t.description_panne, t.prix_estime, t.prix_final, t.date_reception, t.date_promesse, t.date_commande_pieces, t.date_reception_pieces, t.technicien_id, c.prenom || ' ' || c.nom AS client_nom, c.telephone AS client_telephone, u.prenom || ' ' || u.nom AS technicien_nom, CAST((julianday('now') - julianday(t.date_reception)) AS INTEGER) AS jours_anciennete FROM tickets t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.technicien_id WHERE t.boutique_id = ? AND t.actif = 1 AND (t.statut NOT IN ('livre','annule') OR (t.statut IN ('livre','annule') AND t.updated_at >= datetime('now', '-7 days'))) ORDER BY CASE t.priorite WHEN 'urgente' THEN 1 WHEN 'haute' THEN 2 WHEN 'normale' THEN 3 ELSE 4 END, t.date_reception ASC`

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne toujours 10 colonnes même sans tickets', async () => {
    db.__setListResponse(SQL_KANBAN, [])
    const res = await getKanban(db, 1)
    expect(res.colonnes).toHaveLength(10)
    const statuts = res.colonnes.map(c => c.statut)
    expect(statuts).toContain('recu')
    expect(statuts).toContain('annule')
  })

  it('place les tickets dans la bonne colonne', async () => {
    db.__setListResponse(SQL_KANBAN, [
      { ...KANBAN_TICKET, statut: 'recu' },
      { ...KANBAN_TICKET, id: 43, statut: 'en_reparation' },
    ])
    const res = await getKanban(db, 1)
    const colRecu = res.colonnes.find(c => c.statut === 'recu')!
    const colRep  = res.colonnes.find(c => c.statut === 'en_reparation')!
    expect(colRecu.tickets).toHaveLength(1)
    expect(colRep.tickets).toHaveLength(1)
  })

  it('ajoute transitions_possibles sur chaque ticket', async () => {
    db.__setListResponse(SQL_KANBAN, [{ ...KANBAN_TICKET, statut: 'recu' }])
    const res = await getKanban(db, 1)
    const ticket = res.colonnes.find(c => c.statut === 'recu')!.tickets[0]
    expect(ticket.transitions_possibles).toEqual(TRANSITIONS_TICKET.recu)
  })

  it('ajoute anciennete_couleur (vert si ≤ 2 jours)', async () => {
    db.__setListResponse(SQL_KANBAN, [{ ...KANBAN_TICKET, jours_anciennete: 1 }])
    const res = await getKanban(db, 1)
    const ticket = res.colonnes.find(c => c.statut === 'recu')!.tickets[0]
    expect(ticket.anciennete_couleur).toBe('green')
  })

  it('anciennete_couleur rouge pour 10 jours', async () => {
    db.__setListResponse(SQL_KANBAN, [{ ...KANBAN_TICKET, jours_anciennete: 10 }])
    const res = await getKanban(db, 1)
    const ticket = res.colonnes.find(c => c.statut === 'recu')!.tickets[0]
    expect(ticket.anciennete_couleur).toBe('red')
  })

  it('anciennete_couleur black pour > 13 jours', async () => {
    db.__setListResponse(SQL_KANBAN, [{ ...KANBAN_TICKET, jours_anciennete: 14 }])
    const res = await getKanban(db, 1)
    const ticket = res.colonnes.find(c => c.statut === 'recu')!.tickets[0]
    expect(ticket.anciennete_couleur).toBe('black')
  })

  it('stats.total_actifs exclut livre/annule', async () => {
    db.__setListResponse(SQL_KANBAN, [
      { ...KANBAN_TICKET, statut: 'recu' },
      { ...KANBAN_TICKET, id: 43, statut: 'livre' },
      { ...KANBAN_TICKET, id: 44, statut: 'annule' },
    ])
    const res = await getKanban(db, 1)
    expect(res.stats.total_actifs).toBe(1)
  })

  it('stats.urgents compte les tickets urgente', async () => {
    db.__setListResponse(SQL_KANBAN, [
      { ...KANBAN_TICKET, priorite: 'urgente' },
      { ...KANBAN_TICKET, id: 43, priorite: 'normale' },
    ])
    const res = await getKanban(db, 1)
    expect(res.stats.urgents).toBe(1)
  })
})

// ─── getTicketById ────────────────────────────────────────────────────────────

describe('getTicketById()', () => {
  let db: ReturnType<typeof createMockD1>

  const SQL_TICKET = `SELECT t.*, c.prenom || ' ' || c.nom AS client_nom, c.email AS client_email, c.telephone AS client_telephone, u.prenom || ' ' || u.nom AS technicien_nom FROM tickets t JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.technicien_id WHERE t.id = ? AND t.actif = 1`
  const SQL_HISTO  = `SELECT h.*, u.prenom || ' ' || u.nom AS user_nom FROM tickets_statuts_historique h JOIN users u ON u.id = h.user_id WHERE h.ticket_id = ? ORDER BY h.created_at ASC`
  const SQL_PHOTOS = 'SELECT * FROM tickets_photos WHERE ticket_id = ? ORDER BY created_at'

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne ticket avec historique et photos', async () => {
    db.__setResponse(SQL_TICKET, TICKET_WITH_CLIENT)
    db.__setListResponse(SQL_HISTO, [{ id: 1, statut_nouveau: 'recu', user_nom: 'Admin' }])
    db.__setListResponse(SQL_PHOTOS, [])
    const res = await getTicketById(db, 42)
    expect(res).not.toBeNull()
    expect(res.id).toBe(42)
    expect(res.historique).toHaveLength(1)
    expect(res.photos).toEqual([])
  })

  it('retourne null si ticket inexistant', async () => {
    db.__setNotFound(SQL_TICKET)
    const res = await getTicketById(db, 999)
    expect(res).toBeNull()
  })
})

// ─── createTicket ─────────────────────────────────────────────────────────────

describe('createTicket()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    // nextNumero : SELECT boutique_settings + upsert sequences + SELECT sequences
    db.__setResponse(
      'SELECT prefix_ticket, prefix_facture, prefix_devis, prefix_avoir, prefix_rachat, format_numero, padding_numero FROM boutique_settings WHERE boutique_id = ?',
      { prefix_ticket: 'TKT', format_numero: 'annee', padding_numero: 5 }
    )
    db.__setResponse(
      'SELECT dernier_num FROM sequences WHERE boutique_id = ? AND type = ? AND annee = ?',
      { dernier_num: 42 }
    )
    // INSERT ticket RETURNING id
    db.__setResponseFn(
      `INSERT INTO tickets (boutique_id, numero, client_id, appareil_id, appareil_marque, appareil_modele, description_panne, technicien_id, prix_estime, date_promesse, notes_internes, tracking_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      () => ({ id: 42 })
    )
  })

  it('retourne id, numero et tracking_token', async () => {
    const res = await createTicket(db, 1, 5, {
      client_id: 7,
      appareil_marque: 'Apple', appareil_modele: 'iPhone 14',
      description_panne: 'Écran cassé',
    })
    expect(res.id).toBe(42)
    expect(res.numero).toMatch(/^TKT-\d{4}-\d{5}$/)
    expect(res.tracking_token).toHaveLength(32)
    expect(res.tracking_token).toMatch(/^[0-9a-f]+$/)
  })

  it('le tracking_token est unique à chaque appel (Web Crypto)', async () => {
    const r1 = await createTicket(db, 1, 5, {
      client_id: 7, appareil_marque: 'Samsung', appareil_modele: 'S23',
      description_panne: 'Batterie',
    })
    const r2 = await createTicket(db, 1, 5, {
      client_id: 8, appareil_marque: 'Huawei', appareil_modele: 'P50',
      description_panne: 'Micro',
    })
    expect(r1.tracking_token).not.toBe(r2.tracking_token)
  })

  it('enregistre l\'historique initial (creation → recu)', async () => {
    await createTicket(db, 1, 5, {
      client_id: 7, appareil_marque: 'Apple', appareil_modele: 'iPhone 14',
      description_panne: 'Écran cassé',
    })
    const calls = db.__getCalls()
    // L'INSERT historique a le SQL hardcodé avec les valeurs littérales 'creation' et 'recu'
    const histoCall = calls.find(c =>
      c.sql.includes('tickets_statuts_historique') &&
      c.sql.includes('creation') &&
      c.sql.includes('recu')
    )
    expect(histoCall).toBeDefined()
    // params = [ticketId, userId] — les valeurs de statut sont dans le SQL lui-même
    expect(histoCall?.params).toContain(42)  // ticketId retourné par le mock
    expect(histoCall?.params).toContain(5)   // userId
  })
})

// ─── updateTicket ─────────────────────────────────────────────────────────────

describe('updateTicket()', () => {
  let db: ReturnType<typeof createMockD1>

  const SQL_SELECT = 'SELECT id FROM tickets WHERE id = ? AND actif = 1'

  beforeEach(() => {
    db = createMockD1()
  })

  it('lève une erreur si ticket inexistant', async () => {
    db.__setNotFound(SQL_SELECT)
    await expect(updateTicket(db, 999, 5, { diagnostic: 'Fusible grillé' }))
      .rejects.toThrow('Ticket introuvable.')
  })

  it('lève une erreur si priorité invalide', async () => {
    db.__setResponse(SQL_SELECT, { id: 42 })
    await expect(updateTicket(db, 42, 5, { priorite: 'critique' as any }))
      .rejects.toThrow('Priorité invalide')
  })

  it('appelle UPDATE avec les bons champs', async () => {
    db.__setResponse(SQL_SELECT, { id: 42 })
    await updateTicket(db, 42, 5, { diagnostic: 'Fusible grillé', prix_final: 80 })
    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE tickets SET'))
    expect(updateCall).toBeDefined()
  })
})

// ─── updateStatutTicket ───────────────────────────────────────────────────────

describe('updateStatutTicket()', () => {
  let db: ReturnType<typeof createMockD1>

  const SQL_TICKET = 'SELECT id, statut, boutique_id FROM tickets WHERE id = ? AND actif = 1'

  beforeEach(() => {
    db = createMockD1()
  })

  it('lève une erreur si ticket inexistant', async () => {
    db.__setNotFound(SQL_TICKET)
    await expect(updateStatutTicket(db, 999, 5, 'en_diagnostic'))
      .rejects.toThrow('Ticket introuvable.')
  })

  it('lève une erreur sur transition invalide', async () => {
    db.__setResponse(SQL_TICKET, { id: 42, statut: 'recu', boutique_id: 1 })
    await expect(updateStatutTicket(db, 42, 5, 'livre'))
      .rejects.toThrow('Transition invalide')
  })

  it('lève une erreur si statut terminal (livre → quoi que ce soit)', async () => {
    db.__setResponse(SQL_TICKET, { id: 42, statut: 'livre', boutique_id: 1 })
    await expect(updateStatutTicket(db, 42, 5, 'termine'))
      .rejects.toThrow('Transition invalide')
    expect(TRANSITIONS_TICKET.livre).toEqual([])
  })

  it('retourne statut_avant et statut_apres sur transition valide', async () => {
    db.__setResponse(SQL_TICKET, { id: 42, statut: 'recu', boutique_id: 1 })
    const res = await updateStatutTicket(db, 42, 5, 'en_diagnostic')
    expect(res.statut_avant).toBe('recu')
    expect(res.statut_apres).toBe('en_diagnostic')
  })

  it('enregistre la transition dans tickets_statuts_historique', async () => {
    db.__setResponse(SQL_TICKET, { id: 42, statut: 'recu', boutique_id: 1 })
    await updateStatutTicket(db, 42, 5, 'en_diagnostic', 'Début du diagnostic')
    const calls = db.__getCalls()
    const histoCall = calls.find(c =>
      c.sql.includes('tickets_statuts_historique') && c.sql.includes('INSERT')
    )
    expect(histoCall).toBeDefined()
    expect(histoCall?.params).toContain('en_diagnostic')
    expect(histoCall?.params).toContain('recu')
    expect(histoCall?.params).toContain('Début du diagnostic')
  })

  it('toutes les transitions de la machine à états sont valides de bout en bout', async () => {
    // Chemin nominal complet : recu → en_diagnostic → a_commander → commande
    //   → pieces_recues → en_reparation → termine → livre
    const chemin: StatutTicket[] = [
      'recu', 'en_diagnostic', 'a_commander', 'commande',
      'pieces_recues', 'en_reparation', 'termine', 'livre',
    ]
    for (let i = 0; i < chemin.length - 1; i++) {
      const de = chemin[i]
      const vers = chemin[i + 1]
      expect(TRANSITIONS_TICKET[de]).toContain(vers)
    }
  })
})

// ─── deleteTicket ─────────────────────────────────────────────────────────────

describe('deleteTicket()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => { db = createMockD1() })

  it('émet UPDATE actif = 0', async () => {
    await deleteTicket(db, 42, 5)
    const calls = db.__getCalls()
    const delCall = calls.find(c =>
      c.sql.includes('UPDATE tickets SET actif = 0')
    )
    expect(delCall).toBeDefined()
    expect(delCall?.params).toContain(42)
  })
})

// ─── getTicketBoutiqueId ──────────────────────────────────────────────────────

describe('getTicketBoutiqueId()', () => {
  let db: ReturnType<typeof createMockD1>

  const SQL = 'SELECT boutique_id FROM tickets WHERE id = ?'

  beforeEach(() => { db = createMockD1() })

  it('retourne l\'objet { boutique_id }', async () => {
    db.__setResponse(SQL, { boutique_id: 3 })
    const res = await getTicketBoutiqueId(db, 42)
    expect(res).not.toBeNull()
    expect(res?.boutique_id).toBe(3)
  })

  it('retourne null si ticket inexistant', async () => {
    db.__setNotFound(SQL)
    const res = await getTicketBoutiqueId(db, 999)
    expect(res).toBeNull()
  })
})

// ─── getTicketAvecClient ──────────────────────────────────────────────────────

describe('getTicketAvecClient()', () => {
  let db: ReturnType<typeof createMockD1>

  const SQL = `SELECT t.numero, t.tracking_token, t.prix_final, t.diagnostic, t.appareil_marque, t.appareil_modele, c.email AS client_email, c.prenom AS client_prenom FROM tickets t JOIN clients c ON c.id = t.client_id WHERE t.id = ? LIMIT 1`

  beforeEach(() => { db = createMockD1() })

  it('retourne les données avec email client', async () => {
    const slim = {
      numero: 'TKT-2026-00042', tracking_token: 'abc123', prix_final: 120,
      diagnostic: null, appareil_marque: 'Apple', appareil_modele: 'iPhone 14',
      client_email: 'marie@example.com', client_prenom: 'Marie',
    }
    db.__setResponse(SQL, slim)
    const res = await getTicketAvecClient(db, 42)
    expect(res).not.toBeNull()
    expect(res?.client_email).toBe('marie@example.com')
  })

  it('retourne null si ticket inexistant', async () => {
    db.__setNotFound(SQL)
    const res = await getTicketAvecClient(db, 999)
    expect(res).toBeNull()
  })
})
