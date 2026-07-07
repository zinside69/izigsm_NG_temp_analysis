/**
 * tests/statsService.test.ts
 * Sprint 2.41-B — Couverture statsService.ts
 * F09/P04/P05/P06 : exports CSV + rapport comptable
 *
 * Fonctions testées :
 *   exportCsvTickets      (5 tests)
 *   exportCsvCa           (5 tests)
 *   getRapportComptable   (5 tests)
 *
 * Total : 15 tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import {
  exportCsvTickets,
  exportCsvCa,
  getRapportComptable,
} from '../src/services/statsService'

// ─── SQL normalisés ───────────────────────────────────────────────────────────

const SQL_TICKETS = `SELECT t.numero, t.statut, t.appareil_marque, t.appareil_modele, t.description_panne, t.diagnostic, c.nom || ' ' || c.prenom AS client, c.email AS client_email, c.telephone AS client_tel, u.prenom || ' ' || u.nom AS technicien, ROUND(t.prix_estime, 2) AS prix_estime, ROUND(t.prix_final, 2) AS prix_final, DATE(t.created_at) AS date_creation, DATE(t.updated_at) AS date_modification, t.date_promesse FROM tickets t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.technicien_id WHERE t.boutique_id = ? AND DATE(t.created_at) BETWEEN ? AND ? ORDER BY t.created_at DESC LIMIT 5000`

const SQL_CA = `SELECT f.numero, c.nom || ' ' || c.prenom AS client, c.email AS client_email, DATE(f.date_emission) AS date_emission, DATE(f.date_echeance) AS date_echeance, ROUND(f.total_ht, 2) AS total_ht, ROUND(f.total_tva, 2) AS total_tva, ROUND(f.total_ttc, 2) AS total_ttc, f.mode_paiement, f.statut, COALESCE(f.notes, '') AS notes FROM factures f LEFT JOIN clients c ON c.id = f.client_id WHERE f.boutique_id = ? AND f.statut = 'payee' AND DATE(f.date_emission) BETWEEN ? AND ? ORDER BY f.date_emission DESC LIMIT 5000`

const SQL_TOTAUX = `SELECT COUNT(*) AS nb_factures, ROUND(SUM(total_ht), 2) AS total_ht, ROUND(SUM(total_tva), 2) AS total_tva, ROUND(SUM(total_ttc), 2) AS total_ttc FROM factures WHERE boutique_id = ? AND statut = 'payee' AND DATE(date_emission) BETWEEN ? AND ?`

const SQL_PAR_TVA = `SELECT ROUND(ld.tva_taux, 2) AS taux_tva, ROUND(SUM(ld.total_ht), 2) AS base_ht, ROUND(SUM(ld.total_ttc - ld.total_ht), 2) AS montant_tva, ROUND(SUM(ld.total_ttc), 2) AS total_ttc FROM lignes_document ld JOIN factures f ON f.id = ld.document_id AND ld.document_type = 'facture' WHERE f.boutique_id = ? AND f.statut = 'payee' AND DATE(f.date_emission) BETWEEN ? AND ? GROUP BY ROUND(ld.tva_taux, 2) ORDER BY taux_tva ASC`

const SQL_PAR_MODE = `SELECT COALESCE(mode_paiement, 'non renseigné') AS mode, COUNT(*) AS nb, ROUND(SUM(total_ttc), 2) AS total_ttc FROM factures WHERE boutique_id = ? AND statut = 'payee' AND DATE(date_emission) BETWEEN ? AND ? GROUP BY mode_paiement ORDER BY total_ttc DESC`

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TICKET_ROW = {
  numero: 'TKT-2026-00001',
  statut: 'termine',
  appareil_marque: 'Apple',
  appareil_modele: 'iPhone 14',
  description_panne: 'Écran fissuré',
  diagnostic: 'Dalle LCD cassée',
  client: 'Dupont Alice',
  client_email: 'alice@test.fr',
  client_tel: '0601020304',
  technicien: 'Martin Jean',
  prix_estime: 120,
  prix_final: 115,
  date_creation: '2026-07-01',
  date_modification: '2026-07-03',
  date_promesse: '2026-07-05',
}

const FACTURE_ROW = {
  numero: 'FA-2026-00042',
  client: 'Dupont Alice',
  client_email: 'alice@test.fr',
  date_emission: '2026-07-01',
  date_echeance: '2026-07-31',
  total_ht: 95.83,
  total_tva: 19.17,
  total_ttc: 115,
  mode_paiement: 'carte',
  statut: 'payee',
  notes: '',
}

const TOTAUX_ROW = {
  nb_factures: 3,
  total_ht: 287.49,
  total_tva: 57.51,
  total_ttc: 345,
}

const TVA_ROWS = [
  { taux_tva: 20, base_ht: 287.49, montant_tva: 57.51, total_ttc: 345 },
]

const MODE_ROWS = [
  { mode: 'carte', nb: 2, total_ttc: 230 },
  { mode: 'especes', nb: 1, total_ttc: 115 },
]

// ─── Tests exportCsvTickets() ─────────────────────────────────────────────────

describe('exportCsvTickets()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne un CSV avec en-têtes et une ligne de données', async () => {
    db.__setListResponse(SQL_TICKETS, [TICKET_ROW])
    const csv = await exportCsvTickets(db as any, 1, '2026-07-01', '2026-07-31')
    expect(csv).toContain('N° Ticket')
    expect(csv).toContain('Statut')
    expect(csv).toContain('TKT-2026-00001')
    expect(csv).toContain('Apple')
  })

  it('retourne un CSV avec seulement les en-têtes si aucun ticket', async () => {
    db.__setListResponse(SQL_TICKETS, [])
    const csv = await exportCsvTickets(db as any, 1, '2026-07-01', '2026-07-31')
    expect(csv).toContain('N° Ticket')
    // Pas de lignes de données — uniquement en-têtes + éventuellement BOM
    const lines = csv.split('\n').filter(l => l.trim().length > 0)
    expect(lines.length).toBe(1)
  })

  it('transmet boutiqueId et les dates comme bindings', async () => {
    db.__setListResponse(SQL_TICKETS, [])
    await exportCsvTickets(db as any, 42, '2026-01-01', '2026-01-31')
    const calls = db.__getCalls()
    const call = calls.find(c => c.sql === SQL_TICKETS)
    expect(call).toBeDefined()
    expect(call!.params[0]).toBe(42)
    expect(call!.params[1]).toBe('2026-01-01')
    expect(call!.params[2]).toBe('2026-01-31')
  })

  it('inclut les colonnes prix_estime et prix_final dans le CSV', async () => {
    db.__setListResponse(SQL_TICKETS, [TICKET_ROW])
    const csv = await exportCsvTickets(db as any, 1, '2026-07-01', '2026-07-31')
    expect(csv).toContain('Prix estimé')
    expect(csv).toContain('Prix final')
    expect(csv).toContain('120')
    expect(csv).toContain('115')
  })

  it('fonctionne sans dates (valeurs par défaut)', async () => {
    db.__setListResponse(SQL_TICKETS, [TICKET_ROW])
    const csv = await exportCsvTickets(db as any, 1)
    expect(csv).toContain('N° Ticket')
    const calls = db.__getCalls()
    const call = calls.find(c => c.sql === SQL_TICKETS)
    expect(call).toBeDefined()
    // boutiqueId en premier param
    expect(call!.params[0]).toBe(1)
  })
})

// ─── Tests exportCsvCa() ─────────────────────────────────────────────────────

describe('exportCsvCa()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne un CSV avec en-têtes et une ligne de données', async () => {
    db.__setListResponse(SQL_CA, [FACTURE_ROW])
    const csv = await exportCsvCa(db as any, 1, '2026-07-01', '2026-07-31')
    expect(csv).toContain('N° Facture')
    expect(csv).toContain('Montant TTC')
    expect(csv).toContain('FA-2026-00042')
    expect(csv).toContain('115')
  })

  it('retourne un CSV vide (seulement en-têtes) si aucune facture', async () => {
    db.__setListResponse(SQL_CA, [])
    const csv = await exportCsvCa(db as any, 1, '2026-07-01', '2026-07-31')
    expect(csv).toContain('N° Facture')
    const lines = csv.split('\n').filter(l => l.trim().length > 0)
    expect(lines.length).toBe(1)
  })

  it('transmet boutiqueId et dates comme bindings', async () => {
    db.__setListResponse(SQL_CA, [])
    await exportCsvCa(db as any, 7, '2026-06-01', '2026-06-30')
    const calls = db.__getCalls()
    const call = calls.find(c => c.sql === SQL_CA)
    expect(call).toBeDefined()
    expect(call!.params[0]).toBe(7)
    expect(call!.params[1]).toBe('2026-06-01')
    expect(call!.params[2]).toBe('2026-06-30')
  })

  it('inclut les colonnes TVA et mode paiement', async () => {
    db.__setListResponse(SQL_CA, [FACTURE_ROW])
    const csv = await exportCsvCa(db as any, 1, '2026-07-01', '2026-07-31')
    expect(csv).toContain('TVA')
    expect(csv).toContain('Mode paiement')
    expect(csv).toContain('carte')
  })

  it('fonctionne sans dates (valeurs par défaut)', async () => {
    db.__setListResponse(SQL_CA, [FACTURE_ROW])
    const csv = await exportCsvCa(db as any, 1)
    expect(csv).toContain('N° Facture')
    const calls = db.__getCalls()
    const call = calls.find(c => c.sql === SQL_CA)
    expect(call).toBeDefined()
    expect(call!.params[0]).toBe(1)
  })
})

// ─── Tests getRapportComptable() ─────────────────────────────────────────────

describe('getRapportComptable()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne la structure complète avec totaux et ventilations', async () => {
    db.__setResponse(SQL_TOTAUX, TOTAUX_ROW)
    db.__setListResponse(SQL_PAR_TVA, TVA_ROWS)
    db.__setListResponse(SQL_PAR_MODE, MODE_ROWS)
    const result = await getRapportComptable(db as any, 1, '2026-07-01', '2026-07-31')
    expect(result.nb_factures).toBe(3)
    expect(result.total_ht).toBe(287.49)
    expect(result.total_tva).toBe(57.51)
    expect(result.total_ttc).toBe(345)
    expect(result.par_tva).toHaveLength(1)
    expect(result.par_mode_paiement).toHaveLength(2)
  })

  it('retourne zeros et tableaux vides si aucune facture', async () => {
    db.__setResponse(SQL_TOTAUX, null)
    db.__setListResponse(SQL_PAR_TVA, [])
    db.__setListResponse(SQL_PAR_MODE, [])
    const result = await getRapportComptable(db as any, 1, '2026-07-01', '2026-07-31')
    expect(result.nb_factures).toBe(0)
    expect(result.total_ht).toBe(0)
    expect(result.total_ttc).toBe(0)
    expect(result.par_tva).toHaveLength(0)
    expect(result.par_mode_paiement).toHaveLength(0)
  })

  it('inclut la période dans la réponse', async () => {
    db.__setResponse(SQL_TOTAUX, TOTAUX_ROW)
    db.__setListResponse(SQL_PAR_TVA, [])
    db.__setListResponse(SQL_PAR_MODE, [])
    const result = await getRapportComptable(db as any, 1, '2026-07-01', '2026-07-31')
    expect(result.periode.from).toBe('2026-07-01')
    expect(result.periode.to).toBe('2026-07-31')
  })

  it('transmet boutiqueId et dates aux 3 requêtes SQL', async () => {
    db.__setResponse(SQL_TOTAUX, TOTAUX_ROW)
    db.__setListResponse(SQL_PAR_TVA, TVA_ROWS)
    db.__setListResponse(SQL_PAR_MODE, MODE_ROWS)
    await getRapportComptable(db as any, 99, '2026-05-01', '2026-05-31')
    const calls = db.__getCalls()
    const callTotaux = calls.find(c => c.sql === SQL_TOTAUX)
    const callTva    = calls.find(c => c.sql === SQL_PAR_TVA)
    const callMode   = calls.find(c => c.sql === SQL_PAR_MODE)
    expect(callTotaux).toBeDefined()
    expect(callTva).toBeDefined()
    expect(callMode).toBeDefined()
    expect(callTotaux!.params[0]).toBe(99)
    expect(callTva!.params[0]).toBe(99)
    expect(callMode!.params[0]).toBe(99)
  })

  it('fonctionne sans dates (valeurs par défaut — 1er du mois courant)', async () => {
    db.__setResponse(SQL_TOTAUX, TOTAUX_ROW)
    db.__setListResponse(SQL_PAR_TVA, TVA_ROWS)
    db.__setListResponse(SQL_PAR_MODE, MODE_ROWS)
    const result = await getRapportComptable(db as any, 1)
    // La période doit être définie et non vide
    expect(result.periode.from).toBeTruthy()
    expect(result.periode.to).toBeTruthy()
    // from = 1er du mois courant
    expect(result.periode.from).toMatch(/^\d{4}-\d{2}-01$/)
  })
})
