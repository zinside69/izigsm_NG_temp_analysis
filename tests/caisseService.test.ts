/**
 * @file tests/caisseService.test.ts
 * @description Tests unitaires — src/services/caisseService.ts
 *
 * Couverture :
 *   - getHashPrecedent()          — hash genèse (64 zéros) + hash existant
 *   - verifierIntegriteChaine()   — chaîne intègre vs fraudée (SHA-256 réel)
 *   - getKpisCaisse()             — 4 requêtes en parallèle, fallback 0
 *   - listClotures()              — liste paginée
 *   - createVente()               — vente POS + hash NF525 + stock (ajouté 2026-07-12)
 *   - enregistrerEncaissement()   — encaissement facture existante (ajouté 2026-07-12)
 *   - getCaisseJournal()          — journal du jour + clôture éventuelle (ajouté 2026-07-12)
 *   - cloturerJournee()           — clôture NF525 + chaînage hash (ajouté 2026-07-12)
 *
 * Note sur la cryptographie :
 *   SHA-256 est réel (Web Crypto API native Node 18+) — pas mocké.
 *   Cela permet de tester l'algorithme NF525 en conditions réelles.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import { createMockD1 } from './helpers/mockD1'
import { currentMonthParis, todayParis } from '../src/lib/timezone'
import {
  getHashPrecedent,
  verifierIntegriteChaine,
  getKpisCaisse,
  listClotures,
  createVente,
  enregistrerEncaissement,
  getCaisseJournal,
  cloturerJournee,
  type JournalEntry,
  type ClotureSummary,
} from '../src/services/caisseService'

function n(sql: string) { return sql.replace(/\s+/g, ' ').trim() }

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
    const db = createMockDatabase()
    // Pas de réponse → first() retourne null

    const hash = await getHashPrecedent(db, 1)

    expect(hash).toBe(HASH_GENESE)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^0+$/)
  })

  it('retourne le hash_courant de la dernière transaction', async () => {
    const db = createMockDatabase()
    const expectedHash = 'a3f9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1'
    db.__setResponseFn(
      'SELECT hash_courant FROM journal_nf525 WHERE boutique_id = ? ORDER BY id DESC LIMIT 1',
      () => ({ hash_courant: expectedHash })
    )

    const hash = await getHashPrecedent(db, 1)

    expect(hash).toBe(expectedHash)
  })

  it('appelle le SQL avec le boutique_id', async () => {
    const db = createMockDatabase()

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
    const db = createMockDatabase()
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

    const db = createMockDatabase()
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

    const db = createMockDatabase()
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

    const db = createMockDatabase()
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

    const db = createMockDatabase()
    db.__setListFn(
      'SELECT * FROM journal_nf525 WHERE boutique_id = ? ORDER BY id ASC',
      () => transactions as JournalEntry[]
    )

    const result = await verifierIntegriteChaine(db, 1)

    expect(result.integre).toBe(true)
    expect(result.anomalies).toHaveLength(0)
  })

  it('ajoute les filtres date si fournis', async () => {
    const db = createMockDatabase()
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
    const db = createMockDatabase()
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
    const db = createMockDatabase()
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
    const db = createMockDatabase()
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
    const db = createMockDatabase()
    db.__setListFn(
      "SELECT cj.*, u.prenom || ' ' || u.nom AS caissier_nom FROM clotures_journalieres cj LEFT JOIN users u ON u.id = cj.user_id WHERE cj.boutique_id = ? ORDER BY cj.id DESC LIMIT ?",
      () => []
    )

    const result = await listClotures(db, 1, 10)

    expect(result).toEqual([])
  })

  it('transmet boutique_id et limit en paramètres', async () => {
    const db = createMockDatabase()

    await listClotures(db, 3, 25)

    const calls = db.__getCalls()
    expect(calls[0].params).toContain(3)   // boutique_id
    expect(calls[0].params).toContain(25)  // limit
  })
})

// ─── createVente (non migré — D1Database, dépend de nextNumero) ──────────────

describe('createVente()', () => {
  const SQL_INSERT_FACTURE = n(`
    INSERT INTO factures
      (boutique_id, client_id, numero, date_emission, date_echeance,
       total_ht, total_tva, total_ttc, statut, notes)
    VALUES (?, ?, ?, ?, date('now', '+30 days'), ?, ?, ?, 'payee', ?)
    RETURNING *
  `)

  const SQL_INSERT_JOURNAL_VENTE = n(`
    INSERT INTO journal_nf525
      (boutique_id, type_transaction, reference_id, reference_numero,
       client_id, montant_ht, montant_tva, montant_ttc,
       date_transaction, hash_precedent, donnees_hash, hash_courant,
       est_cloture, user_id)
    VALUES (?, 'vente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    RETURNING *
  `)

  const SQL_SELECT_STOCK = 'SELECT stock_actuel FROM produits WHERE id = ? AND boutique_id = ?'

  const SQL_UPDATE_STOCK = n(`
    UPDATE produits
    SET stock_actuel = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND boutique_id = ?
  `)

  function setupHappyPath(db: ReturnType<typeof createMockD1>) {
    db.__setResponseFn(SQL_INSERT_FACTURE, () => ({
      id: 10, numero: 'FAC-2026-00001', total_ht: 80, total_tva: 16, total_ttc: 96,
    }))
    db.__setResponseFn(SQL_INSERT_JOURNAL_VENTE, (params: any[]) => ({
      id: 1, boutique_id: params[0], reference_numero: params[2],
      hash_courant: 'x'.repeat(64),
    }))
  }

  const LIGNE = {
    designation: 'Réparation écran', quantite: 1,
    prix_unitaire_ht: 80, tva_taux: 20,
  }

  it('lève une erreur si aucune ligne', async () => {
    const db = createMockD1()

    await expect(
      createVente(db, 1, 5, { lignes: [], mode_paiement: 'especes' })
    ).rejects.toThrow('au moins une ligne')
  })

  it('crée la facture et le journal NF525, retourne les deux', async () => {
    const db = createMockD1()
    setupHappyPath(db)

    const result = await createVente(db, 1, 5, {
      lignes: [LIGNE], mode_paiement: 'especes',
    })

    expect(result.facture.id).toBe(10)
    expect(result.journal.hash_courant).toHaveLength(64)
  })

  it('décrémente le stock et trace un mouvement si produit_id fourni', async () => {
    const db = createMockD1()
    setupHappyPath(db)
    db.__setResponse(SQL_SELECT_STOCK, { stock_actuel: 10 })

    await createVente(db, 1, 5, {
      lignes: [{ ...LIGNE, produit_id: 42 }], mode_paiement: 'cb',
    })

    const calls = db.__getCalls()
    const stockCall = calls.find(c => c.sql === SQL_UPDATE_STOCK)
    expect(stockCall).toBeDefined()
    expect(stockCall!.params).toEqual([9, 42, 1]) // stock_apres=10-1, produit_id, boutique_id

    const mouvementCall = calls.find(c => c.sql.includes('INSERT INTO mouvements_stock'))
    expect(mouvementCall).toBeDefined()
    expect(mouvementCall!.sql).toContain('motif')
    expect(mouvementCall!.params).toEqual([1, 42, 1, 10, 9, 5]) // boutique, produit, qte, avant, apres, user
  })

  it('ne trace aucun mouvement si le produit n\'appartient pas à la boutique', async () => {
    const db = createMockD1()
    setupHappyPath(db)
    // Pas de réponse pour SQL_SELECT_STOCK -> produit introuvable pour cette boutique

    await createVente(db, 1, 5, {
      lignes: [{ ...LIGNE, produit_id: 999 }], mode_paiement: 'cb',
    })

    const calls = db.__getCalls()
    expect(calls.find(c => c.sql === SQL_UPDATE_STOCK)).toBeUndefined()
    expect(calls.find(c => c.sql.includes('INSERT INTO mouvements_stock'))).toBeUndefined()
  })

  it('calcule le rendu monnaie si espèces > montant dû', async () => {
    const db = createMockD1()
    setupHappyPath(db)

    const result = await createVente(db, 1, 5, {
      lignes: [LIGNE], mode_paiement: 'especes', montant_especes: 100,
    })

    // Total TTC de la ligne = 80 * 1.20 = 96 → rendu = 100 - 96 = 4
    expect(result.rendu_monnaie).toBe(4)
  })

  it('pas de rendu monnaie si paiement CB', async () => {
    const db = createMockD1()
    setupHappyPath(db)

    const result = await createVente(db, 1, 5, {
      lignes: [LIGNE], mode_paiement: 'cb',
    })

    expect(result.rendu_monnaie).toBeUndefined()
  })

  it('lève une erreur si la création de facture échoue', async () => {
    const db = createMockD1()
    // Pas de réponse pour SQL_INSERT_FACTURE → first() retourne null

    await expect(
      createVente(db, 1, 5, { lignes: [LIGNE], mode_paiement: 'especes' })
    ).rejects.toThrow('Échec création facture')
  })
})

// ─── enregistrerEncaissement (migré — port Database) ─────────────────────────

describe('enregistrerEncaissement()', () => {
  let db: ReturnType<typeof createMockDatabase>

  const SQL_GET_FACTURE = 'SELECT * FROM factures WHERE id = ? AND boutique_id = ? LIMIT 1'
  const SQL_INSERT_JOURNAL_ENCAISSEMENT = n(`
    INSERT INTO journal_nf525
      (boutique_id, type_transaction, reference_id, reference_numero,
       client_id, montant_ht, montant_tva, montant_ttc,
       date_transaction, hash_precedent, donnees_hash, hash_courant,
       est_cloture, user_id)
    VALUES (?, 'encaissement', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    RETURNING *
  `)

  beforeEach(() => { db = createMockDatabase() })

  it('lève une erreur si facture introuvable', async () => {
    await expect(
      enregistrerEncaissement(db, 1, 5, 999, 'especes')
    ).rejects.toThrow('introuvable')
  })

  it('lève une erreur si facture déjà payée', async () => {
    db.__setResponse(SQL_GET_FACTURE, { id: 42, statut: 'payee', boutique_id: 1 })

    await expect(
      enregistrerEncaissement(db, 1, 5, 42, 'especes')
    ).rejects.toThrow('déjà payée')
  })

  it('marque la facture payée et crée le journal NF525', async () => {
    db.__setResponse(SQL_GET_FACTURE, {
      id: 42, statut: 'en_attente', boutique_id: 1, numero: 'FAC-2026-00002',
      total_ht: 100, total_tva: 20, total_ttc: 120, client_id: 3,
    })
    db.__setResponseFn(SQL_INSERT_JOURNAL_ENCAISSEMENT, (params: any[]) => ({
      id: 2, reference_numero: params[2], hash_courant: 'y'.repeat(64),
    }))

    const journal = await enregistrerEncaissement(db, 1, 5, 42, 'cb')

    expect(journal.hash_courant).toHaveLength(64)
    const calls = db.__getCalls()
    expect(calls.find(c => c.sql.includes("statut = 'payee'"))).toBeDefined()
    expect(calls.find(c => c.sql.includes('INSERT INTO paiements'))).toBeDefined()
  })
})

// ─── getCaisseJournal (migré — port Database) ────────────────────────────────

describe('getCaisseJournal()', () => {
  let db: ReturnType<typeof createMockDatabase>

  const SQL_TRANSACTIONS = n(`
    SELECT j.*, u.prenom || ' ' || u.nom AS caissier_nom
    FROM   journal_nf525 j
    LEFT   JOIN users u ON u.id = j.user_id
    WHERE  j.boutique_id = ?
      AND  DATE(j.date_transaction) = ?
    ORDER  BY j.id ASC
  `)
  const SQL_CLOTURE = n(`
    SELECT * FROM clotures_journalieres
    WHERE  boutique_id = ? AND date_cloture = ?
    LIMIT  1
  `)

  beforeEach(() => { db = createMockDatabase() })

  it('utilise todayParis() par défaut si aucune date fournie', async () => {
    await getCaisseJournal(db, 1)

    const calls = db.__getCalls()
    const call = calls.find(c => c.sql === SQL_TRANSACTIONS)
    expect(call!.params[1]).toBe(todayParis())
  })

  it('agrège les totaux et signale une journée non clôturée', async () => {
    db.__setListResponse(SQL_TRANSACTIONS, [
      { montant_ht: 100, montant_tva: 20, montant_ttc: 120 },
      { montant_ht: 50,  montant_tva: 10, montant_ttc: 60 },
    ])

    const result = await getCaisseJournal(db, 1, '2026-07-01')

    expect(result.totaux.nb_transactions).toBe(2)
    expect(result.totaux.total_ttc).toBe(180)
    expect(result.est_cloture).toBe(false)
  })

  it('signale une journée clôturée si une clôture existe', async () => {
    db.__setResponse(SQL_CLOTURE, { id: 1, date_cloture: '2026-07-01' })

    const result = await getCaisseJournal(db, 1, '2026-07-01')

    expect(result.est_cloture).toBe(true)
    expect(result.cloture?.id).toBe(1)
  })
})

// ─── cloturerJournee (migré — port Database) ─────────────────────────────────

describe('cloturerJournee()', () => {
  let db: ReturnType<typeof createMockDatabase>

  const SQL_EXISTANTE = 'SELECT id FROM clotures_journalieres WHERE boutique_id = ? AND date_cloture = ?'
  const SQL_TRANSACTIONS_NON_CLOTUREES = n(`
    SELECT * FROM journal_nf525
    WHERE  boutique_id = ?
      AND  DATE(date_transaction) = ?
      AND  est_cloture = 0
    ORDER  BY id ASC
  `)
  const SQL_INSERT_CLOTURE = n(`
    INSERT INTO clotures_journalieres
      (boutique_id, date_cloture, nb_transactions,
       total_ht, total_tva, total_ttc,
       hash_cloture, hash_precedent, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `)

  beforeEach(() => { db = createMockDatabase() })

  it('lève une erreur si la journée est déjà clôturée', async () => {
    db.__setResponse(SQL_EXISTANTE, { id: 1 })

    await expect(cloturerJournee(db, 1, 5, '2026-07-01')).rejects.toThrow('déjà clôturée')
  })

  it('lève une erreur si aucune transaction à clôturer', async () => {
    db.__setListResponse(SQL_TRANSACTIONS_NON_CLOTUREES, [])

    await expect(cloturerJournee(db, 1, 5, '2026-07-01')).rejects.toThrow('Aucune transaction')
  })

  it('calcule les totaux et insère la clôture avec un hash de 64 caractères', async () => {
    db.__setListResponse(SQL_TRANSACTIONS_NON_CLOTUREES, [
      { montant_ht: 100, montant_tva: 20, montant_ttc: 120, hash_courant: 'a'.repeat(64) },
      { montant_ht: 50,  montant_tva: 10, montant_ttc: 60,  hash_courant: 'b'.repeat(64) },
    ])
    db.__setResponseFn(SQL_INSERT_CLOTURE, (params: any[]) => ({
      id: 1, boutique_id: params[0], date_cloture: params[1],
      nb_transactions: params[2], total_ttc: params[5], hash_cloture: params[6],
    }))

    const result = await cloturerJournee(db, 1, 5, '2026-07-01')

    expect(result.nb_transactions).toBe(2)
    expect(result.total_ttc).toBe(180)
    expect(result.hash_cloture).toHaveLength(64)
  })

  it('utilise todayParis() par défaut si aucune date fournie', async () => {
    db.__setListResponse(SQL_TRANSACTIONS_NON_CLOTUREES, [])

    await expect(cloturerJournee(db, 1, 5)).rejects.toThrow('Aucune transaction')

    const calls = db.__getCalls()
    const call = calls.find(c => c.sql === SQL_TRANSACTIONS_NON_CLOTUREES)
    expect(call!.params[1]).toBe(todayParis())
  })
})
