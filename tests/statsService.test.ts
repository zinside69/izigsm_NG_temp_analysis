/**
 * tests/statsService.test.ts
 * Sprint 2.41-B — Couverture statsService.ts
 * F09/P04/P05/P06 : exports CSV + rapport comptable
 * Migration Ports & Adapters (2026-07-15, checkpoint 18, service #20) : couverture
 * étendue aux fonctions jusque-là non testées (getKpisDashboard, getCaMensuel,
 * getTicketsParStatut, getTopProduits, getActiviteRecente, exportCsvTechniciens,
 * getRapportTechnicien).
 *
 * Fonctions testées :
 *   exportCsvTickets      (5 tests)
 *   exportCsvCa           (5 tests)
 *   getRapportComptable   (5 tests)
 *   getKpisDashboard, getCaMensuel, getTicketsParStatut, getTopProduits,
 *   getActiviteRecente, exportCsvTechniciens, getRapportTechnicien
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import {
  exportCsvTickets,
  exportCsvCa,
  exportCsvTechniciens,
  getRapportComptable,
  getKpisDashboard,
  getCaMensuel,
  getTicketsParStatut,
  getTopProduits,
  getActiviteRecente,
  getRapportTechnicien,
} from '../src/services/statsService'
import { todayParis } from '../src/lib/timezone'

// ─── SQL normalisés ───────────────────────────────────────────────────────────

const SQL_TICKETS = `SELECT t.numero, t.statut, t.appareil_marque, t.appareil_modele, t.description_panne, t.diagnostic, c.nom || ' ' || c.prenom AS client, c.email AS client_email, c.telephone AS client_tel, u.prenom || ' ' || u.nom AS technicien, ROUND(t.prix_estime, 2) AS prix_estime, ROUND(t.prix_final, 2) AS prix_final, DATE(t.created_at) AS date_creation, DATE(t.updated_at) AS date_modification, t.date_promesse FROM tickets t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.technicien_id WHERE t.boutique_id = ? AND DATE(t.created_at) BETWEEN ? AND ? ORDER BY t.created_at DESC LIMIT 5000`

const SQL_CA = `SELECT f.numero, c.nom || ' ' || c.prenom AS client, c.email AS client_email, DATE(f.date_emission) AS date_emission, DATE(f.date_echeance) AS date_echeance, ROUND(f.total_ht, 2) AS total_ht, ROUND(f.total_tva, 2) AS total_tva, ROUND(f.total_ttc, 2) AS total_ttc, COALESCE(( SELECT GROUP_CONCAT(DISTINCT p.mode_paiement) FROM paiements p WHERE p.facture_id = f.id ), '') AS mode_paiement, f.statut, COALESCE(f.notes, '') AS notes FROM factures f LEFT JOIN clients c ON c.id = f.client_id WHERE f.boutique_id = ? AND f.statut = 'payee' AND DATE(f.date_emission) BETWEEN ? AND ? ORDER BY f.date_emission DESC LIMIT 5000`

const SQL_TOTAUX = `SELECT COUNT(*) AS nb_factures, ROUND(SUM(total_ht), 2) AS total_ht, ROUND(SUM(total_tva), 2) AS total_tva, ROUND(SUM(total_ttc), 2) AS total_ttc FROM factures WHERE boutique_id = ? AND statut = 'payee' AND DATE(date_emission) BETWEEN ? AND ?`

const SQL_PAR_TVA = `SELECT ROUND(ld.tva_taux, 2) AS taux_tva, ROUND(SUM(ld.total_ht), 2) AS base_ht, ROUND(SUM(ld.total_ttc - ld.total_ht), 2) AS montant_tva, ROUND(SUM(ld.total_ttc), 2) AS total_ttc FROM lignes_document ld JOIN factures f ON f.id = ld.document_id AND ld.document_type = 'facture' WHERE f.boutique_id = ? AND f.statut = 'payee' AND DATE(f.date_emission) BETWEEN ? AND ? GROUP BY ROUND(ld.tva_taux, 2) ORDER BY taux_tva ASC`

const SQL_PAR_MODE = `SELECT COALESCE(p.mode_paiement, 'non renseigné') AS mode, COUNT(DISTINCT f.id) AS nb, ROUND(SUM(p.montant), 2) AS total_ttc FROM factures f JOIN paiements p ON p.facture_id = f.id WHERE f.boutique_id = ? AND f.statut = 'payee' AND DATE(f.date_emission) BETWEEN ? AND ? GROUP BY p.mode_paiement ORDER BY total_ttc DESC`

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
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
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
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
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
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
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
    // from = 1er du mois courant (heure Paris — todayParis(), pas UTC)
    expect(result.periode.from).toMatch(/^\d{4}-\d{2}-01$/)
    expect(result.periode.to).toBe(todayParis())
  })
})

// ─── Tests exportCsvTechniciens() ────────────────────────────────────────────

describe('exportCsvTechniciens()', () => {
  let db: ReturnType<typeof createMockDatabase>

  const SQL_TECHNICIENS = `SELECT u.prenom || ' ' || u.nom AS technicien, r.nom AS role, COUNT(t.id) AS total_tickets, SUM(CASE WHEN t.statut IN ('termine','livre') THEN 1 ELSE 0 END) AS termines, SUM(CASE WHEN t.statut NOT IN ('livre','annule','termine') THEN 1 ELSE 0 END) AS en_cours, ROUND(AVG( CASE WHEN t.statut IN ('termine','livre') THEN julianday(t.updated_at) - julianday(t.created_at) ELSE NULL END ), 1) AS delai_moyen_jours, ROUND(COALESCE(SUM(t.prix_final), 0), 2) AS ca_genere FROM users u LEFT JOIN roles r ON r.id = u.role_id LEFT JOIN tickets t ON t.technicien_id = u.id AND t.boutique_id = ? AND DATE(t.created_at) BETWEEN ? AND ? WHERE u.boutique_id = ? AND u.actif = 1 AND r.nom IN ('admin','gerant','technicien') GROUP BY u.id ORDER BY total_tickets DESC`

  const TECH_ROW = {
    technicien: 'Martin Jean', role: 'technicien', total_tickets: 12,
    termines: 9, en_cours: 3, delai_moyen_jours: 2.4, ca_genere: 1840.5,
  }

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne un CSV avec en-têtes et une ligne par technicien', async () => {
    db.__setListResponse(SQL_TECHNICIENS, [TECH_ROW])
    const csv = await exportCsvTechniciens(db as any, 1, '2026-07-01', '2026-07-31')
    expect(csv).toContain('Technicien')
    expect(csv).toContain('Délai moyen')
    expect(csv).toContain('Martin Jean')
    expect(csv).toContain('1840.5')
  })

  it('transmet boutiqueId (×2) et les dates comme bindings', async () => {
    db.__setListResponse(SQL_TECHNICIENS, [])
    await exportCsvTechniciens(db as any, 5, '2026-06-01', '2026-06-30')
    const call = db.__getCalls().find(c => c.sql === SQL_TECHNICIENS)
    expect(call).toBeDefined()
    expect(call!.params).toEqual([5, '2026-06-01', '2026-06-30', 5])
  })

  it('fonctionne sans dates (défaut : -30 jours à aujourd\'hui, heure Paris)', async () => {
    db.__setListResponse(SQL_TECHNICIENS, [])
    await exportCsvTechniciens(db as any, 1)
    const call = db.__getCalls().find(c => c.sql === SQL_TECHNICIENS)
    expect(call!.params[2]).toBe(todayParis())
  })
})

// ─── Tests getKpisDashboard() ─────────────────────────────────────────────────

describe('getKpisDashboard()', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne les 12 KPIs avec fallback à 0 si aucune donnée', async () => {
    const result = await getKpisDashboard(db as any, 1)
    expect(result.nb_clients).toBe(0)
    expect(result.tickets_en_cours).toBe(0)
    expect(result.ca_mois).toBe(0)
    expect(result.evolution_ca_pct).toBeNull()
    expect(result.stock_bas).toBe(0)
    expect(result.rdv_today).toBe(0)
  })

  it('calcule evolution_ca_pct quand le mois précédent a du CA', async () => {
    // Les 2 requêtes CA (mois courant / mois précédent) partagent le même SQL
    // normalisé — on utilise __setResponseFn pour distinguer via le 2e param (mois lié).
    db.__setResponseFn(
      `SELECT COALESCE(SUM(total_ttc),0) as ca FROM factures WHERE boutique_id=? AND statut='payee' AND strftime('%Y-%m',date_emission)=?`,
      (params: unknown[]) => {
        const mois = params[1] as string
        const currentMonth = todayParis().slice(0, 7)
        return mois === currentMonth ? { ca: 1500 } : { ca: 1000 }
      }
    )
    const result = await getKpisDashboard(db as any, 1)
    expect(result.ca_mois).toBe(1500)
    expect(result.ca_mois_precedent).toBe(1000)
    expect(result.evolution_ca_pct).toBe(50) // (1500-1000)/1000 * 100
  })

  it('lie today (heure Paris) à la requête "tickets du jour", pas DATE(\'now\') SQL', async () => {
    db.__setResponseFn(
      `SELECT COUNT(*) as cnt FROM tickets WHERE boutique_id=? AND DATE(created_at)=?`,
      (params: unknown[]) => ({ cnt: params[1] === todayParis() ? 7 : 0 })
    )
    const result = await getKpisDashboard(db as any, 1)
    expect(result.tickets_aujourd_hui).toBe(7)
  })
})

// ─── Tests getCaMensuel() ─────────────────────────────────────────────────────

describe('getCaMensuel()', () => {
  let db: ReturnType<typeof createMockDatabase>

  const SQL_CA_MENSUEL = `SELECT strftime('%Y-%m', date_emission) as mois, COALESCE(SUM(total_ttc),0) as ca_ttc, COALESCE(SUM(total_ht),0) as ca_ht, COUNT(*) as nb_factures FROM factures WHERE boutique_id=? AND statut='payee' AND date_emission >= ? GROUP BY mois ORDER BY mois ASC`

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne 12 mois même si aucune facture (mois à 0)', async () => {
    db.__setListResponse(SQL_CA_MENSUEL, [])
    const result = await getCaMensuel(db as any, 1)
    expect(result.mois).toHaveLength(12)
    expect(result.mois.every(m => m.ca_ttc === 0)).toBe(true)
    expect(result.total_12_mois).toBe(0)
    expect(result.moyenne_mensuelle).toBe(0)
  })

  it('le dernier mois de la série est le mois courant (heure Paris)', async () => {
    db.__setListResponse(SQL_CA_MENSUEL, [])
    const result = await getCaMensuel(db as any, 1)
    expect(result.mois[11].mois).toBe(todayParis().slice(0, 7))
  })

  it('injecte le CA du mois correspondant depuis les résultats SQL', async () => {
    const currentMonth = todayParis().slice(0, 7)
    db.__setListResponse(SQL_CA_MENSUEL, [
      { mois: currentMonth, ca_ttc: 2500, ca_ht: 2083.33, nb_factures: 4 },
    ])
    const result = await getCaMensuel(db as any, 1)
    const moisCourant = result.mois.find(m => m.mois === currentMonth)
    expect(moisCourant?.ca_ttc).toBe(2500)
    expect(moisCourant?.nb_factures).toBe(4)
    expect(result.total_12_mois).toBe(2500)
  })
})

// ─── Tests getTicketsParStatut() ─────────────────────────────────────────────

describe('getTicketsParStatut()', () => {
  let db: ReturnType<typeof createMockDatabase>

  const SQL_STATUT = `SELECT statut, COUNT(*) as cnt FROM tickets WHERE boutique_id=? GROUP BY statut`

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne les 9 statuts exhaustifs même si certains sont absents en base', async () => {
    db.__setListResponse(SQL_STATUT, [{ statut: 'recu', cnt: 5 }])
    const result = await getTicketsParStatut(db as any, 1)
    expect(result).toHaveLength(9)
    expect(result.find(s => s.key === 'recu')?.cnt).toBe(5)
    expect(result.find(s => s.key === 'termine')?.cnt).toBe(0)
  })

  it('chaque statut a une couleur et un label', async () => {
    db.__setListResponse(SQL_STATUT, [])
    const result = await getTicketsParStatut(db as any, 1)
    expect(result.every(s => s.color && s.label)).toBe(true)
  })
})

// ─── Tests getTopProduits() ───────────────────────────────────────────────────

describe('getTopProduits()', () => {
  let db: ReturnType<typeof createMockDatabase>

  const SQL_TOP = `SELECT p.nom, p.sku as reference, ROUND(p.prix_vente_ht * (1 + p.tva_taux/100.0), 2) as prix_vente_ttc, p.prix_achat_cump as cump, COUNT(ld.id) as nb_ventes, SUM(ld.quantite) as qte_vendue, SUM(ld.total_ttc) as ca_total, SUM(ld.total_ttc - (p.prix_achat_cump * ld.quantite)) as marge_brute FROM lignes_document ld JOIN produits p ON p.id = ld.produit_id JOIN factures f ON f.id = ld.document_id AND ld.document_type='facture' WHERE f.boutique_id=? AND f.statut='payee' AND f.date_emission >= ? GROUP BY p.id ORDER BY ca_total DESC LIMIT ?`

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('calcule marge_pct à partir de marge_brute/ca_total', async () => {
    db.__setListResponse(SQL_TOP, [
      { nom: 'Écran iPhone 14', reference: 'SKU-1', prix_vente_ttc: 96, cump: 40, nb_ventes: 3, qte_vendue: 3, ca_total: 288, marge_brute: 168 },
    ])
    const result = await getTopProduits(db as any, 1)
    expect(result[0].marge_pct).toBe(58) // round(168/288*100)
  })

  it('marge_pct = 0 si ca_total = 0 (évite division par zéro)', async () => {
    db.__setListResponse(SQL_TOP, [
      { nom: 'X', reference: 'Y', prix_vente_ttc: 0, cump: 0, nb_ventes: 0, qte_vendue: 0, ca_total: 0, marge_brute: 0 },
    ])
    const result = await getTopProduits(db as any, 1)
    expect(result[0].marge_pct).toBe(0)
  })

  it('transmet limit personnalisé comme 3e binding', async () => {
    db.__setListResponse(SQL_TOP, [])
    await getTopProduits(db as any, 1, 5)
    const call = db.__getCalls().find(c => c.sql === SQL_TOP)
    expect(call!.params[2]).toBe(5)
  })
})

// ─── Tests getActiviteRecente() ──────────────────────────────────────────────

describe('getActiviteRecente()', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('fusionne et trie par date décroissante les 4 modules', async () => {
    db.__setListFn(
      `SELECT 'ticket' as type, t.numero as ref, c.nom || ' ' || c.prenom as label, t.statut as detail, t.created_at as date FROM tickets t LEFT JOIN clients c ON c.id = t.client_id WHERE t.boutique_id=? ORDER BY t.created_at DESC LIMIT 8`,
      () => [{ type: 'ticket', ref: 'TKT-1', label: 'A', detail: 'recu', date: '2026-07-10T08:00:00Z' }]
    )
    db.__setListFn(
      `SELECT 'facture' as type, f.numero as ref, c.nom || ' ' || c.prenom as label, f.statut as detail, f.created_at as date FROM factures f LEFT JOIN clients c ON c.id = f.client_id WHERE f.boutique_id=? ORDER BY f.created_at DESC LIMIT 6`,
      () => [{ type: 'facture', ref: 'FA-1', label: 'B', detail: 'payee', date: '2026-07-12T08:00:00Z' }]
    )
    db.__setListFn(
      `SELECT 'rachat' as type, r.numero as ref, r.vendeur_prenom || ' ' || r.vendeur_nom as label, r.statut as detail, r.created_at as date FROM rachats r WHERE r.boutique_id=? ORDER BY r.created_at DESC LIMIT 4`,
      () => []
    )
    db.__setListFn(
      `SELECT 'rdv' as type, 'RDV' as ref, c.nom || ' ' || c.prenom as label, rv.statut as detail, rv.created_at as date FROM rendez_vous rv LEFT JOIN clients c ON c.id = rv.client_id WHERE rv.boutique_id=? ORDER BY rv.created_at DESC LIMIT 4`,
      () => []
    )

    const result = await getActiviteRecente(db as any, 1)
    expect(result).toHaveLength(2)
    expect(result[0].ref).toBe('FA-1')  // plus récent en premier
    expect(result[1].ref).toBe('TKT-1')
  })

  it('tronque au paramètre limit', async () => {
    db.__setListFn(
      `SELECT 'ticket' as type, t.numero as ref, c.nom || ' ' || c.prenom as label, t.statut as detail, t.created_at as date FROM tickets t LEFT JOIN clients c ON c.id = t.client_id WHERE t.boutique_id=? ORDER BY t.created_at DESC LIMIT 8`,
      () => [
        { type: 'ticket', ref: 'TKT-1', label: 'A', detail: 'recu', date: '2026-07-10T08:00:00Z' },
        { type: 'ticket', ref: 'TKT-2', label: 'B', detail: 'recu', date: '2026-07-11T08:00:00Z' },
      ]
    )
    const result = await getActiviteRecente(db as any, 1, 1)
    expect(result).toHaveLength(1)
    expect(result[0].ref).toBe('TKT-2')
  })
})

// ─── Tests getRapportTechnicien() ────────────────────────────────────────────

describe('getRapportTechnicien()', () => {
  let db: ReturnType<typeof createMockDatabase>

  const SQL_RAPPORT = `SELECT u.id, u.prenom || ' ' || u.nom as technicien, COUNT(t.id) as total_tickets, SUM(CASE WHEN t.statut='termine' OR t.statut='livre' THEN 1 ELSE 0 END) as termines, SUM(CASE WHEN t.statut NOT IN ('livre','annule','termine') THEN 1 ELSE 0 END) as en_cours, ROUND(AVG( CASE WHEN t.statut IN ('termine','livre') THEN (julianday(t.updated_at) - julianday(t.created_at)) ELSE NULL END ),1) as delai_moyen_jours FROM users u LEFT JOIN roles r ON r.id=u.role_id LEFT JOIN tickets t ON t.technicien_id=u.id AND t.boutique_id=? WHERE u.boutique_id=? AND u.actif=1 AND r.nom IN ('admin','gerant','technicien') GROUP BY u.id ORDER BY total_tickets DESC`

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne le tableau trié par total_tickets DESC (délégué à la requête SQL)', async () => {
    db.__setListResponse(SQL_RAPPORT, [
      { id: 1, technicien: 'Martin Jean', total_tickets: 15, termines: 12, en_cours: 3, delai_moyen_jours: 2.1 },
    ])
    const result = await getRapportTechnicien(db as any, 1)
    expect(result).toHaveLength(1)
    expect(result[0].technicien).toBe('Martin Jean')
  })

  it('transmet boutiqueId deux fois (JOIN + WHERE)', async () => {
    db.__setListResponse(SQL_RAPPORT, [])
    await getRapportTechnicien(db as any, 7)
    const call = db.__getCalls().find(c => c.sql === SQL_RAPPORT)
    expect(call!.params).toEqual([7, 7])
  })
})
