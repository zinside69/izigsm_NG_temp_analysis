/**
 * @file tests/caisseService.test.ts
 * @description Tests unitaires — src/services/caisseService.ts
 *
 * Couverture prioritaire (fonctions exportées testables sans DB réelle) :
 *   - getHashPrecedent()          — hash genèse (64 zéros) + hash existant
 *   - verifierIntegriteChaine()   — chaîne intègre vs fraudée (SHA-256 réel)
 *   - getKpisCaisse()             — 4 requêtes en parallèle, fallback 0
 *   - listClotures()              — liste paginée
 *
 * Note sur createVente / enregistrerEncaissement :
 *   Ces fonctions font appel à nextNumero() (autonumérotation) qui nécessite
 *   une DB avec la table `parametres_numerotation`. Elles sont couvertes par
 *   les tests d'intégration (tests/integration/) — hors scope test unitaire pur.
 *
 * Note sur la cryptographie :
 *   SHA-256 est réel (Web Crypto API native Node 18+) — pas mocké.
 *   Cela permet de tester l'algorithme NF525 en conditions réelles.
 */

import { describe, it, expect } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import {
  getHashPrecedent,
  verifierIntegriteChaine,
  getKpisCaisse,
  listClotures,
  type JournalEntry,
  type ClotureSummary,
} from '../src/services/caisseService'

// ─── Helpers de test ──────────────────────────────────────────────────────────

/** Hash SHA-256 calculé avec Web Crypto (le même algorithme que NF525) */
async function sha256Real(input: string): Promise<string> {
  const buf    = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Hash genèse : 64 zéros */
const HASH_GENESE = '0000000000000000000000000000000000000000000000000000000000000000'

/** Construit la chaîne canonique NF525 — FORMAT FIGÉ (doit matcher buildDonneesHash interne) */
function buildCanonical(
  type: string, ref: string, montantTtc: number,
  date: string, hashPrecedent: string
): string {
  const centimes = Math.round(montantTtc * 100)
  return `${type}|${ref}|${centimes}|${date}|${hashPrecedent}`
}

// ─── getHashPrecedent ─────────────────────────────────────────────────────────

describe('getHashPrecedent', () => {
  it('retourne 64 zéros si aucune transaction en base (hash genèse)', async () => {
    const db = createMockD1()
    // Pas de réponse → first() retourne null

    const hash = await getHashPrecedent(db, 1)

    expect(hash).toBe(HASH_GENESE)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^0+$/)
  })

  it('retourne le hash_courant de la dernière transaction', async () => {
    const db = createMockD1()
    const expectedHash = 'a3f9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1'
    db.__setResponseFn(
      'SELECT hash_courant FROM journal_nf525 WHERE boutique_id = ? ORDER BY id DESC LIMIT 1',
      () => ({ hash_courant: expectedHash })
    )

    const hash = await getHashPrecedent(db, 1)

    expect(hash).toBe(expectedHash)
  })

  it('appelle le SQL avec le boutique_id', async () => {
    const db = createMockD1()

    await getHashPrecedent(db, 7)

    const calls = db.__getCalls()
    expect(calls[0].params).toContain(7)
    expect(calls[0].sql).toContain('journal_nf525')
    expect(calls[0].sql).toContain('ORDER BY id DESC LIMIT 1')
  })
})

// ─── verifierIntegriteChaine ──────────────────────────────────────────────────

describe('verifierIntegriteChaine', () => {
  it('retourne { integre: true, anomalies: [] } pour une chaîne vide', async () => {
    const db = createMockD1()
    db.__setListFn(
      'SELECT * FROM journal_nf525 WHERE boutique_id = ? ORDER BY id ASC',
      () => []
    )

    const result = await verifierIntegriteChaine(db, 1)

    expect(result.integre).toBe(true)
    expect(result.anomalies).toHaveLength(0)
  })

  it('retourne { integre: true } pour une transaction avec hash correct (SHA-256 réel)', async () => {
    // Calculer le vrai hash comme le ferait NF525
    const date     = '2026-06-29T10:00:00.000Z'
    const canonical = buildCanonical('vente', 'FA-2026-00001', 120, date, HASH_GENESE)
    const hashCorrect = await sha256Real(canonical)

    const transaction: Partial<JournalEntry> = {
      id: 1, boutique_id: 1,
      type_transaction:  'vente',
      reference_numero:  'FA-2026-00001',
      montant_ttc:       120,
      date_transaction:  date,
      hash_precedent:    HASH_GENESE,
      hash_courant:      hashCorrect,  // hash correct !
    }

    const db = createMockD1()
    db.__setListFn(
      'SELECT * FROM journal_nf525 WHERE boutique_id = ? ORDER BY id ASC',
      () => [transaction as JournalEntry]
    )

    const result = await verifierIntegriteChaine(db, 1)

    expect(result.integre).toBe(true)
    expect(result.anomalies).toHaveLength(0)
  })

  it('détecte une transaction fraudée (hash_courant modifié)', async () => {
    const transaction: Partial<JournalEntry> = {
      id: 1, boutique_id: 1,
      type_transaction:  'vente',
      reference_numero:  'FA-2026-00001',
      montant_ttc:       120,
      date_transaction:  '2026-06-29T10:00:00.000Z',
      hash_precedent:    HASH_GENESE,
      hash_courant:      'hash_falsifie_000000000000000000000000000000000000000000000000', // FAUX !
    }

    const db = createMockD1()
    db.__setListFn(
      'SELECT * FROM journal_nf525 WHERE boutique_id = ? ORDER BY id ASC',
      () => [transaction as JournalEntry]
    )

    const result = await verifierIntegriteChaine(db, 1)

    expect(result.integre).toBe(false)
    expect(result.anomalies).toHaveLength(1)
    expect(result.anomalies[0].id).toBe(1)
    expect(result.anomalies[0].reference_numero).toBe('FA-2026-00001')
    expect(result.anomalies[0].details).toContain('Hash attendu')
  })

  it('détecte une modification de montant (hash cascade)', async () => {
    // Hash calculé pour montant=120 — si on stocke montant=100 dans la transaction,
    // le recalcul donnera un hash différent → fraude détectée
    const date    = '2026-06-29T10:00:00.000Z'
    const canonicalCorrect = buildCanonical('vente', 'FA-2026-00001', 120, date, HASH_GENESE)
    const hashPourMontant120 = await sha256Real(canonicalCorrect)

    const transactionFraudee: Partial<JournalEntry> = {
      id: 1, boutique_id: 1,
      type_transaction:  'vente',
      reference_numero:  'FA-2026-00001',
      montant_ttc:       100,           // modifié : 120 → 100
      date_transaction:  date,
      hash_precedent:    HASH_GENESE,
      hash_courant:      hashPourMontant120, // hash calculé pour 120, mais montant est 100
    }

    const db = createMockD1()
    db.__setListFn(
      'SELECT * FROM journal_nf525 WHERE boutique_id = ? ORDER BY id ASC',
      () => [transactionFraudee as JournalEntry]
    )

    const result = await verifierIntegriteChaine(db, 1)

    // Le recalcul pour montant=100 donnera un hash différent de celui stocké (calculé pour 120)
    expect(result.integre).toBe(false)
    expect(result.anomalies).toHaveLength(1)
  })

  it('valide une chaîne de 3 transactions correctement chaînées', async () => {
    const date = '2026-06-29T10:00:00.000Z'

    // Transaction 1 : genèse
    const canon1  = buildCanonical('vente', 'FA-2026-00001', 120, date, HASH_GENESE)
    const hash1   = await sha256Real(canon1)

    // Transaction 2 : chaînée sur hash1
    const canon2  = buildCanonical('vente', 'FA-2026-00002', 240, date, hash1)
    const hash2   = await sha256Real(canon2)

    // Transaction 3 : chaînée sur hash2
    const canon3  = buildCanonical('encaissement', 'FA-2026-00003', 60, date, hash2)
    const hash3   = await sha256Real(canon3)

    const transactions: Partial<JournalEntry>[] = [
      { id: 1, boutique_id: 1, type_transaction: 'vente',        reference_numero: 'FA-2026-00001', montant_ttc: 120, date_transaction: date, hash_precedent: HASH_GENESE, hash_courant: hash1 },
      { id: 2, boutique_id: 1, type_transaction: 'vente',        reference_numero: 'FA-2026-00002', montant_ttc: 240, date_transaction: date, hash_precedent: hash1,       hash_courant: hash2 },
      { id: 3, boutique_id: 1, type_transaction: 'encaissement', reference_numero: 'FA-2026-00003', montant_ttc: 60,  date_transaction: date, hash_precedent: hash2,       hash_courant: hash3 },
    ]

    const db = createMockD1()
    db.__setListFn(
      'SELECT * FROM journal_nf525 WHERE boutique_id = ? ORDER BY id ASC',
      () => transactions as JournalEntry[]
    )

    const result = await verifierIntegriteChaine(db, 1)

    expect(result.integre).toBe(true)
    expect(result.anomalies).toHaveLength(0)
  })

  it('ajoute les filtres date si fournis', async () => {
    const db = createMockD1()
    db.__setListFn(
      'SELECT * FROM journal_nf525 WHERE boutique_id = ? AND DATE(date_transaction) >= ? AND DATE(date_transaction) <= ? ORDER BY id ASC',
      () => []
    )

    await verifierIntegriteChaine(db, 1, '2026-06-01', '2026-06-30')

    const calls = db.__getCalls()
    expect(calls[0].params).toContain('2026-06-01')
    expect(calls[0].params).toContain('2026-06-30')
  })
})

// ─── getKpisCaisse ────────────────────────────────────────────────────────────

describe('getKpisCaisse', () => {
  it('retourne des KPIs à 0 si aucune donnée', async () => {
    const db = createMockD1()
    // Pas de réponses → first() retourne null → fallback 0
    // derniere_cloture : undefined (pas null) car derniereClot?.date_cloture sur un null

    const kpis = await getKpisCaisse(db, 1)

    expect(kpis.today.nb_transactions).toBe(0)
    expect(kpis.today.total_ttc).toBe(0)
    expect(kpis.today.est_cloture).toBe(false)
    expect(kpis.mois.nb_transactions).toBe(0)
    expect(kpis.mois.total_ttc).toBe(0)
    expect(kpis.nb_clotures_mois).toBe(0)
    expect(kpis.derniere_cloture).toBeUndefined()
  })

  it('retourne les KPIs du jour correctement', async () => {
    const db = createMockD1()
    // SQL réel : COUNT + COALESCE SUM avec paramètre dynamique ? pour la date du jour
    db.__setResponseFn(
      'SELECT COUNT(*) as nb, COALESCE(SUM(montant_ttc),0) as ttc, COALESCE(SUM(montant_ht),0) as ht FROM journal_nf525 WHERE boutique_id = ? AND DATE(date_transaction) = ?',
      () => ({ nb: 5, ttc: 360.0, ht: 300.0 })
    )

    const kpis = await getKpisCaisse(db, 1)

    expect(kpis.today.nb_transactions).toBe(5)
    expect(kpis.today.total_ttc).toBe(360.0)
    expect(kpis.today.total_ht).toBe(300.0)
    expect(kpis.today.est_cloture).toBe(false)
  })
})

// ─── listClotures ─────────────────────────────────────────────────────────────

describe('listClotures', () => {
  const CLOTURE_1: Partial<ClotureSummary> = {
    id: 1, boutique_id: 1, date_cloture: '2026-06-28',
    nb_transactions: 12, total_ht: 1200.0, total_tva: 240.0,
    total_ttc: 1440.0, hash_cloture: 'abc123',
    hash_precedent: HASH_GENESE, user_id: 1,
    created_at: '2026-06-28T18:00:00Z',
  }

  it('retourne la liste des clôtures', async () => {
    const db = createMockD1()
    // SQL réel : JOIN users pour caissier_nom
    db.__setListFn(
      "SELECT cj.*, u.prenom || ' ' || u.nom AS caissier_nom FROM clotures_journalieres cj LEFT JOIN users u ON u.id = cj.user_id WHERE cj.boutique_id = ? ORDER BY cj.id DESC LIMIT ?",
      () => [CLOTURE_1 as ClotureSummary]
    )

    const result = await listClotures(db, 1, 10)

    expect(result).toHaveLength(1)
    expect(result[0].date_cloture).toBe('2026-06-28')
    expect(result[0].total_ttc).toBe(1440.0)
  })

  it('retourne un tableau vide si aucune clôture', async () => {
    const db = createMockD1()
    db.__setListFn(
      "SELECT cj.*, u.prenom || ' ' || u.nom AS caissier_nom FROM clotures_journalieres cj LEFT JOIN users u ON u.id = cj.user_id WHERE cj.boutique_id = ? ORDER BY cj.id DESC LIMIT ?",
      () => []
    )

    const result = await listClotures(db, 1, 10)

    expect(result).toEqual([])
  })

  it('transmet boutique_id et limit en paramètres', async () => {
    const db = createMockD1()

    await listClotures(db, 3, 25)

    const calls = db.__getCalls()
    expect(calls[0].params).toContain(3)   // boutique_id
    expect(calls[0].params).toContain(25)  // limit
  })
})
