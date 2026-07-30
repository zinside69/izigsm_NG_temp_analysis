/**
 * @file tests/factureService.test.ts
 * @description Tests unitaires — src/services/factureService.ts
 * Sprint 2.29 + migration Ports & Adapters (2026-07-12)
 *
 * Couverture :
 *   - listFactures()       — pagination, filtres statut/client_id, Promise.all (migré → mockDatabase)
 *   - getFacture()         — null si absent, facture + lignes + paiements (migré → mockDatabase)
 *   - ajouterPaiement()    — guards, calcul statut, auditLog (non migré → mockD1)
 *   - emettreFacture()     — guards, verrouillage NF525 + hash + tracking_token (non migré → mockD1)
 *   - listAvoirs()         — pagination, filtres (migré → mockDatabase)
 *   - getAvoir()           — null si absent, avoir + lignes (migré → mockDatabase)
 *   - createAvoir()        — guards, INSERT + NF525 hash + auditLog (non migré → mockD1, db.batch())
 *   - getDevisPourNf525()  — SELECT minimal devis (migré → mockDatabase)
 *   - updateFactureHash()  — UPDATE hash_nf525 (migré → mockDatabase)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import { createMockDatabase } from './helpers/mockDatabase'
import {
  listFactures,
  getFacture,
  ajouterPaiement,
  emettreFacture,
  listAvoirs,
  getAvoir,
  createAvoir,
  getDevisPourNf525,
  updateFactureHash,
  createFactureAcompte,
  createFacture,
  type StatutFacture,
  type CreateAvoirInput,
  type LigneInput,
  type CreateFactureAcompteInput,
  type CreateFactureInput,
} from '../src/services/factureService'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function n(sql: string) {
  return sql.replace(/\s+/g, ' ').trim()
}

const FACTURE_ROW = {
  id: 20,
  boutique_id: 1,
  client_id: 3,
  numero: 'FAC-2026-00001',
  statut: 'brouillon' as StatutFacture,
  total_ht: 80.00,
  total_tva: 16.00,
  total_ttc: 96.00,
  montant_paye: 0,
  locked: 0,
  hash_nf525: null,
  tracking_token: null,
  issued_at: null,
  date_emission: null,
  date_paiement: null,
  devis_id: null,
  ticket_id: null,
  created_at: '2026-07-01T10:00:00',
  updated_at: '2026-07-01T10:00:00',
}

const FACTURE_LOCKED = { ...FACTURE_ROW, locked: 1, statut: 'en_attente' as StatutFacture }

const FACTURE_ENRICHIE = {
  ...FACTURE_ROW,
  client_nom: 'Marie Dupont',
  client_email: 'marie@example.com',
  client_telephone: '0600000001',
  adresse: '10 rue de la Paix',
  code_postal: '75001',
  ville: 'Paris',
  boutique_nom: 'iziGSM Paris',
  siret: '12345678901234',
  tva_numero: 'FR12345678901',
  boutique_adresse: '5 avenue Montaigne',
}

const LIGNE_DOC = {
  id: 1, document_type: 'facture', document_id: 20,
  ordre: 1, description: 'Réparation écran', quantite: 1,
  prix_unitaire_ht: 80, tva_taux: 20,
  total_ht: 80, total_tva: 16, total_ttc: 96, produit_id: null,
}

const PAIEMENT_ROW = {
  id: 1, facture_id: 20, boutique_id: 1,
  montant: 50, mode_paiement: 'carte', reference: null,
  user_id: 10, notes: null, created_at: '2026-07-01T12:00:00',
}

const AVOIR_ROW = {
  id: 5, boutique_id: 1, client_id: 3,
  numero: 'AV-2026-00001', type: 'remboursement',
  motif: 'Pièce défectueuse', statut: 'emis',
  total_ht: 40, total_tva: 8, total_ttc: 48,
  facture_id: 20, hash_nf525: 'abc123',
  date_emission: null, notes: null,
}

const AVOIR_ENRICHI = {
  ...AVOIR_ROW,
  client_nom: 'Marie Dupont',
  client_email: 'marie@example.com',
  boutique_nom: 'iziGSM Paris',
  facture_numero: 'FAC-2026-00001',
}

const LIGNE_AVOIR_INPUT: LigneInput = {
  description: 'Remboursement écran',
  quantite: 1,
  prix_unitaire_ht: 40,
  tva_taux: 20,
}

// ─── SQL normalisés ────────────────────────────────────────────────────────────

const SQL_COUNT_FACTURES = n(`SELECT COUNT(*) as cnt FROM factures f WHERE f.boutique_id = ?`)

const SQL_SELECT_FACTURES = n(`
  SELECT f.id, f.numero, f.statut, f.total_ttc, f.montant_paye,
         f.date_emission, f.issued_at, f.locked, f.hash_nf525,
         f.devis_id, f.ticket_id,
         c.prenom || ' ' || c.nom AS client_nom
  FROM   factures f
  JOIN   clients  c ON c.id = f.client_id
  WHERE  f.boutique_id = ?
  ORDER  BY f.created_at DESC
  LIMIT  ? OFFSET ?
`)

const SQL_GET_FACTURE = n(`
  SELECT f.*,
         c.prenom || ' ' || c.nom AS client_nom,
         c.email     AS client_email,
         c.telephone AS client_telephone,
         c.adresse,
         c.code_postal,
         c.ville,
         b.nom       AS boutique_nom,
         b.siret,
         b.tva_numero,
         b.adresse   AS boutique_adresse
  FROM   factures  f
  JOIN   clients   c ON c.id = f.client_id
  JOIN   boutiques b ON b.id = f.boutique_id
  WHERE  f.id = ?
`)

const SQL_GET_LIGNES_FACTURE = n(`SELECT * FROM lignes_document WHERE document_type = 'facture' AND document_id = ? ORDER BY ordre`)
const SQL_GET_PAIEMENTS = n(`SELECT * FROM paiements WHERE facture_id = ? ORDER BY created_at`)
const SQL_GET_FACTURE_PAIEMENT = n(`SELECT id, total_ttc, montant_paye, boutique_id, locked FROM factures WHERE id = ?`)

const SQL_INSERT_PAIEMENT = n(`
  INSERT INTO paiements
    (facture_id, boutique_id, montant, mode_paiement, reference, user_id, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)

const SQL_UPDATE_FACTURE_PAIEMENT = n(`
  UPDATE factures
  SET montant_paye = ?,
      statut       = ?,
      date_paiement = CASE WHEN ? >= total_ttc THEN CURRENT_TIMESTAMP ELSE date_paiement END
  WHERE id = ?
`)

const SQL_GET_FACTURE_EMETTRE = n(`SELECT * FROM factures WHERE id = ?`)

const SQL_LOCK_FACTURE = n(`
  UPDATE factures
  SET locked            = 1,
      issued_at         = CURRENT_TIMESTAMP,
      tracking_token    = ?,
      hash_nf525        = ?,
      vendeur_snapshot  = ?,
      acheteur_snapshot = ?,
      statut            = CASE WHEN statut = 'brouillon' THEN 'en_attente' ELSE statut END
  WHERE id = ?
`)

const SQL_NF525_LAST_HASH = n(`
  SELECT hash_courant
  FROM   journal_nf525
  WHERE  boutique_id = ?
  ORDER  BY id DESC
  LIMIT  1
`)

const SQL_NF525_INSERT = n(`
  INSERT INTO journal_nf525
    (boutique_id, type_transaction, reference_id, reference_numero,
     client_id, montant_ht, montant_tva, montant_ttc, date_transaction,
     hash_precedent, donnees_hash, hash_courant, user_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const SQL_AUDIT = n(`
  INSERT INTO audit_logs (boutique_id, user_id, action, entite_type, entite_id, donnees_avant, donnees_apres, ip_address)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)

const SQL_COUNT_AVOIRS = n(`SELECT COUNT(*) as cnt FROM avoirs a WHERE a.boutique_id = ?`)

const SQL_SELECT_AVOIRS = n(`
  SELECT a.id, a.numero, a.type, a.motif, a.statut, a.total_ttc,
         a.date_emission, a.facture_id, a.hash_nf525,
         f.numero AS facture_numero,
         c.prenom || ' ' || c.nom AS client_nom
  FROM   avoirs    a
  JOIN   factures  f ON f.id = a.facture_id
  JOIN   clients   c ON c.id = a.client_id
  WHERE a.boutique_id = ?
  ORDER  BY a.created_at DESC
  LIMIT  ? OFFSET ?
`)

const SQL_GET_AVOIR = n(`
  SELECT a.*,
         c.prenom || ' ' || c.nom AS client_nom,
         c.email     AS client_email,
         c.telephone AS client_telephone,
         c.adresse, c.code_postal, c.ville,
         b.nom       AS boutique_nom,
         b.siret,
         b.tva_numero,
         b.adresse   AS boutique_adresse,
         f.numero    AS facture_numero
  FROM   avoirs    a
  JOIN   clients   c ON c.id = a.client_id
  JOIN   boutiques b ON b.id = a.boutique_id
  JOIN   factures  f ON f.id = a.facture_id
  WHERE  a.id = ?
`)

const SQL_GET_LIGNES_AVOIR = n(`SELECT * FROM lignes_avoir WHERE avoir_id = ? ORDER BY ordre`)
const SQL_GET_FACTURE_AVOIR = n(`SELECT * FROM factures WHERE id = ?`)

const SQL_NEXT_NUMERO_SETTINGS = n(`
  SELECT prefix_ticket, prefix_facture, prefix_devis, prefix_avoir, prefix_rachat,
         format_numero, padding_numero
  FROM   boutique_settings
  WHERE  boutique_id = ?
`)
const SQL_NEXT_AVOIR_COUNT = n(`SELECT COUNT(*) as cnt FROM avoirs WHERE boutique_id = ?`)

const SQL_INSERT_AVOIR = n(`
  INSERT INTO avoirs
    (boutique_id, numero, facture_id, client_id, type, motif,
     total_ht, total_tva, total_ttc, notes, date_expiration)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING id
`)

const SQL_UPDATE_AVOIR_HASH = n(`UPDATE avoirs SET hash_nf525 = ? WHERE id = ?`)
const SQL_GET_DEVIS_NF525 = n(`SELECT boutique_id, client_id, total_ht, total_tva, total_ttc FROM devis WHERE id = ?`)
const SQL_UPDATE_FACTURE_HASH = n(`UPDATE factures SET hash_nf525 = ? WHERE id = ?`)

/** Pas de hash précédent → chaîne NF525 depuis la genèse */
function setupNf525(db: ReturnType<typeof createMockD1>) {
  db.__setNotFound(SQL_NF525_LAST_HASH)
}

// ─── listFactures (migré — port Database) ────────────────────────────────────

describe('listFactures()', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => { db = createMockDatabase() })

  it('retourne une liste vide si aucune facture', async () => {
    db.__setResponse(SQL_COUNT_FACTURES, { cnt: 0 })
    db.__setListResponse(SQL_SELECT_FACTURES, [])

    const result = await listFactures(db, 1)

    expect(result.data).toEqual([])
    expect(result.pagination.total).toBe(0)
  })

  it('retourne les factures avec pagination par défaut', async () => {
    db.__setResponse(SQL_COUNT_FACTURES, { cnt: 2 })
    db.__setListResponse(SQL_SELECT_FACTURES, [FACTURE_ENRICHIE, { ...FACTURE_ENRICHIE, id: 21 }])

    const result = await listFactures(db, 1)

    expect(result.data).toHaveLength(2)
    expect(result.pagination.page).toBe(1)
    expect(result.pagination.limit).toBe(20)
    expect(result.pagination.total).toBe(2)
  })

  it('filtre par statut', async () => {
    const sqlCountStatut = n(`SELECT COUNT(*) as cnt FROM factures f WHERE f.boutique_id = ? AND f.statut = ?`)
    db.__setResponse(sqlCountStatut, { cnt: 1 })

    const sqlSelectStatut = n(`
      SELECT f.id, f.numero, f.statut, f.total_ttc, f.montant_paye,
             f.date_emission, f.issued_at, f.locked, f.hash_nf525,
             f.devis_id, f.ticket_id,
             c.prenom || ' ' || c.nom AS client_nom
      FROM   factures f
      JOIN   clients  c ON c.id = f.client_id
      WHERE  f.boutique_id = ? AND f.statut = ?
      ORDER  BY f.created_at DESC
      LIMIT  ? OFFSET ?
    `)
    db.__setListResponse(sqlSelectStatut, [{ ...FACTURE_ENRICHIE, statut: 'payee' }])

    const result = await listFactures(db, 1, { statut: 'payee' })

    expect(result.data).toHaveLength(1)
    expect(result.pagination.total).toBe(1)
  })

  it('filtre par client_id', async () => {
    const sqlCountClient = n(`SELECT COUNT(*) as cnt FROM factures f WHERE f.boutique_id = ? AND f.client_id = ?`)
    db.__setResponse(sqlCountClient, { cnt: 1 })

    const sqlSelectClient = n(`
      SELECT f.id, f.numero, f.statut, f.total_ttc, f.montant_paye,
             f.date_emission, f.issued_at, f.locked, f.hash_nf525,
             f.devis_id, f.ticket_id,
             c.prenom || ' ' || c.nom AS client_nom
      FROM   factures f
      JOIN   clients  c ON c.id = f.client_id
      WHERE  f.boutique_id = ? AND f.client_id = ?
      ORDER  BY f.created_at DESC
      LIMIT  ? OFFSET ?
    `)
    db.__setListResponse(sqlSelectClient, [FACTURE_ENRICHIE])

    const result = await listFactures(db, 1, { client_id: '3' })

    expect(result.data).toHaveLength(1)
  })

  it('exécute COUNT et SELECT en parallèle (Promise.all)', async () => {
    db.__setResponse(SQL_COUNT_FACTURES, { cnt: 0 })
    db.__setListResponse(SQL_SELECT_FACTURES, [])

    await listFactures(db, 1)

    const calls = db.__getCalls()
    expect(calls.find(c => c.sql === SQL_COUNT_FACTURES)).toBeDefined()
    expect(calls.find(c => c.sql === SQL_SELECT_FACTURES)).toBeDefined()
  })
})

// ─── getFacture (migré — port Database) ──────────────────────────────────────

describe('getFacture()', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => { db = createMockDatabase() })

  it('retourne null si facture introuvable', async () => {
    db.__setListResponse(SQL_GET_LIGNES_FACTURE, [])
    db.__setListResponse(SQL_GET_PAIEMENTS, [])

    const result = await getFacture(db, 999)

    expect(result).toBeNull()
  })

  it('retourne la facture enrichie avec lignes et paiements', async () => {
    db.__setResponse(SQL_GET_FACTURE, FACTURE_ENRICHIE)
    db.__setListResponse(SQL_GET_LIGNES_FACTURE, [LIGNE_DOC])
    db.__setListResponse(SQL_GET_PAIEMENTS, [PAIEMENT_ROW])

    const result = await getFacture(db, 20)

    expect(result).not.toBeNull()
    expect(result.id).toBe(20)
    expect(result.client_nom).toBe('Marie Dupont')
    expect(result.boutique_nom).toBe('iziGSM Paris')
    expect(result.lignes).toHaveLength(1)
    expect(result.paiements).toHaveLength(1)
  })

  it('retourne lignes et paiements vides si inexistants', async () => {
    db.__setResponse(SQL_GET_FACTURE, FACTURE_ENRICHIE)
    db.__setListResponse(SQL_GET_LIGNES_FACTURE, [])
    db.__setListResponse(SQL_GET_PAIEMENTS, [])

    const result = await getFacture(db, 20)

    expect(result.lignes).toEqual([])
    expect(result.paiements).toEqual([])
  })

  it('exécute les 3 requêtes en parallèle (Promise.all)', async () => {
    db.__setResponse(SQL_GET_FACTURE, FACTURE_ENRICHIE)
    db.__setListResponse(SQL_GET_LIGNES_FACTURE, [])
    db.__setListResponse(SQL_GET_PAIEMENTS, [])

    await getFacture(db, 20)

    const calls = db.__getCalls()
    expect(calls.find(c => c.sql === SQL_GET_FACTURE)).toBeDefined()
    expect(calls.find(c => c.sql === SQL_GET_LIGNES_FACTURE)).toBeDefined()
    expect(calls.find(c => c.sql === SQL_GET_PAIEMENTS)).toBeDefined()
  })
})

// ─── ajouterPaiement (non migré — D1Database, dépend d'auditLog) ─────────────

describe('ajouterPaiement()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => { db = createMockD1() })

  it('lance Error si facture introuvable', async () => {
    db.__setNotFound(SQL_GET_FACTURE_PAIEMENT)

    await expect(ajouterPaiement(db, 999, 10, { montant: 50, mode_paiement: 'carte' }))
      .rejects.toThrow('Facture introuvable.')
  })

  it('lance Error si facture verrouillée (locked=1)', async () => {
    db.__setResponse(SQL_GET_FACTURE_PAIEMENT, {
      id: 20, total_ttc: 96, montant_paye: 0, boutique_id: 1, locked: 1,
    })

    await expect(ajouterPaiement(db, 20, 10, { montant: 50, mode_paiement: 'carte' }))
      .rejects.toThrow('Facture verrouillée')
  })

  it('statut = partiellement_payee si montant_paye < total_ttc', async () => {
    db.__setResponse(SQL_GET_FACTURE_PAIEMENT, {
      id: 20, total_ttc: 96, montant_paye: 0, boutique_id: 1, locked: 0,
    })

    const result = await ajouterPaiement(db, 20, 10, {
      montant: 50, mode_paiement: 'carte',
    })

    expect(result.montant_paye).toBe(50)
    expect(result.statut).toBe('partiellement_payee')
  })

  it('statut = payee si montant_paye >= total_ttc', async () => {
    db.__setResponse(SQL_GET_FACTURE_PAIEMENT, {
      id: 20, total_ttc: 96, montant_paye: 46, boutique_id: 1, locked: 0,
    })

    const result = await ajouterPaiement(db, 20, 10, {
      montant: 50, mode_paiement: 'especes',
    })

    expect(result.montant_paye).toBe(96)
    expect(result.statut).toBe('payee')
  })

  it('INSERT paiement avec bons paramètres', async () => {
    db.__setResponse(SQL_GET_FACTURE_PAIEMENT, {
      id: 20, total_ttc: 96, montant_paye: 0, boutique_id: 1, locked: 0,
    })

    await ajouterPaiement(db, 20, 10, {
      montant: 50, mode_paiement: 'virement', reference: 'VIR-001', notes: 'Acompte',
    })

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql === SQL_INSERT_PAIEMENT)
    expect(insertCall).toBeDefined()
    expect(insertCall!.params[0]).toBe(20)
    expect(insertCall!.params[1]).toBe(1)
    expect(insertCall!.params[2]).toBe(50)
    expect(insertCall!.params[3]).toBe('virement')
    expect(insertCall!.params[4]).toBe('VIR-001')
    expect(insertCall!.params[5]).toBe(10)
    expect(insertCall!.params[6]).toBe('Acompte')
  })

  it('reference et notes null par défaut', async () => {
    db.__setResponse(SQL_GET_FACTURE_PAIEMENT, {
      id: 20, total_ttc: 96, montant_paye: 0, boutique_id: 1, locked: 0,
    })

    await ajouterPaiement(db, 20, 10, { montant: 30, mode_paiement: 'carte' })

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql === SQL_INSERT_PAIEMENT)
    expect(insertCall!.params[4]).toBeNull()
    expect(insertCall!.params[6]).toBeNull()
  })

  it('appelle auditLog PAIEMENT_FACTURE', async () => {
    db.__setResponse(SQL_GET_FACTURE_PAIEMENT, {
      id: 20, total_ttc: 96, montant_paye: 0, boutique_id: 1, locked: 0,
    })

    await ajouterPaiement(db, 20, 10, { montant: 96, mode_paiement: 'carte' })

    const calls = db.__getCalls()
    const auditCall = calls.find(c => c.sql === SQL_AUDIT)
    expect(auditCall).toBeDefined()
    expect(auditCall!.params).toContain('PAIEMENT_FACTURE')
    expect(auditCall!.params).toContain('facture')
    expect(auditCall!.params).toContain(20)
  })
})

// ─── emettreFacture (non migré — D1Database, dépend d'enregistrerTransaction/auditLog) ─

describe('emettreFacture()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => { db = createMockD1() })

  it('lance Error si facture introuvable', async () => {
    db.__setNotFound(SQL_GET_FACTURE_EMETTRE)

    await expect(emettreFacture(db, 999, 10))
      .rejects.toThrow('Facture introuvable.')
  })

  it('lance Error si facture déjà verrouillée', async () => {
    db.__setResponse(SQL_GET_FACTURE_EMETTRE, FACTURE_LOCKED)

    await expect(emettreFacture(db, 20, 10))
      .rejects.toThrow('Facture déjà émise et verrouillée.')
  })

  it('retourne facture_numero + tracking_token + hash_nf525', async () => {
    db.__setResponse(SQL_GET_FACTURE_EMETTRE, FACTURE_ROW)
    setupNf525(db)

    const result = await emettreFacture(db, 20, 10)

    expect(result.facture_numero).toBe('FAC-2026-00001')
    expect(result.tracking_token).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.hash_nf525).toHaveLength(64)
  })

  it('verrouille la facture : INSERT journal_nf525 exécuté', async () => {
    db.__setResponse(SQL_GET_FACTURE_EMETTRE, FACTURE_ROW)
    setupNf525(db)

    await emettreFacture(db, 20, 10)

    const calls = db.__getCalls()
    expect(calls.find(c => c.sql === SQL_NF525_INSERT)).toBeDefined()
  })

  it('UPDATE facture avec locked=1 et hash', async () => {
    db.__setResponse(SQL_GET_FACTURE_EMETTRE, FACTURE_ROW)
    setupNf525(db)

    await emettreFacture(db, 20, 10)

    const calls = db.__getCalls()
    const lockCall = calls.find(c => c.sql === SQL_LOCK_FACTURE)
    expect(lockCall).toBeDefined()
    expect(lockCall!.params[4]).toBe(20)
  })

  it('appelle auditLog EMETTRE_FACTURE', async () => {
    db.__setResponse(SQL_GET_FACTURE_EMETTRE, FACTURE_ROW)
    setupNf525(db)

    await emettreFacture(db, 20, 10)

    const calls = db.__getCalls()
    const auditCall = calls.find(c => c.sql === SQL_AUDIT)
    expect(auditCall).toBeDefined()
    expect(auditCall!.params).toContain('EMETTRE_FACTURE')
  })

  it('fige les identités vendeur et acheteur au moment de l\'émission', async () => {
    db.__setResponse(n('SELECT * FROM factures WHERE id = ?'), {
      id: 20, boutique_id: 1, client_id: 3, numero: 'FAC-2026-00001',
      total_ht: 100, total_tva: 20, total_ttc: 120, locked: 0,
    })
    db.__setNotFound(n('SELECT hash_courant FROM journal_nf525 WHERE boutique_id = ? ORDER BY id DESC LIMIT 1'))
    db.__setResponse(
      n(`SELECT b.nom, b.siret, b.tva_numero, b.adresse, b.code_postal, b.ville, s.tva_taux_defaut, s.mention_facture FROM boutiques b LEFT JOIN boutique_settings s ON s.boutique_id = b.id WHERE b.id = ?`),
      { nom: 'iziGSM Paris 11', siret: '12345678901234', tva_numero: 'FR12345678901',
        adresse: '5 avenue Montaigne', code_postal: '75011', ville: 'Paris',
        tva_taux_defaut: 20, mention_facture: null }
    )
    db.__setResponse(
      n(`SELECT type_client, raison_sociale, prenom, nom, siret, tva_intracom, adresse, code_postal, ville FROM clients WHERE id = ?`),
      { type_client: 'professionnel', raison_sociale: 'SOTELI', prenom: 'Marie', nom: 'Dupont',
        siret: '98765432101234', tva_intracom: 'FR98987654321',
        adresse: '10 rue de la Paix', code_postal: '75001', ville: 'Paris' }
    )

    await emettreFacture(db, 20, 10)

    const lockCall = db.__getCalls().find(c => c.sql.includes('SET') && c.sql.includes('locked') && c.sql.includes('factures'))
    expect(lockCall).toBeDefined()
    const snapshots = lockCall!.params.filter(p => typeof p === 'string' && p.startsWith('{'))
    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]).toContain('12345678901234')  // SIRET vendeur
    expect(snapshots[1]).toContain('98765432101234')  // SIRET acheteur
  })
})

// ─── listAvoirs (migré — port Database) ──────────────────────────────────────

describe('listAvoirs()', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => { db = createMockDatabase() })

  it('retourne une liste vide si aucun avoir', async () => {
    db.__setResponse(SQL_COUNT_AVOIRS, { cnt: 0 })
    db.__setListResponse(SQL_SELECT_AVOIRS, [])

    const result = await listAvoirs(db, 1)

    expect(result.data).toEqual([])
    expect(result.pagination.total).toBe(0)
  })

  it('retourne les avoirs avec pagination', async () => {
    db.__setResponse(SQL_COUNT_AVOIRS, { cnt: 1 })
    db.__setListResponse(SQL_SELECT_AVOIRS, [AVOIR_ENRICHI])

    const result = await listAvoirs(db, 1)

    expect(result.data).toHaveLength(1)
    expect(result.pagination.total).toBe(1)
  })

  it('filtre par facture_id', async () => {
    const sqlCountFact = n(`SELECT COUNT(*) as cnt FROM avoirs a WHERE a.boutique_id = ? AND a.facture_id = ?`)
    db.__setResponse(sqlCountFact, { cnt: 1 })

    const sqlSelectFact = n(`
      SELECT a.id, a.numero, a.type, a.motif, a.statut, a.total_ttc,
             a.date_emission, a.facture_id, a.hash_nf525,
             f.numero AS facture_numero,
             c.prenom || ' ' || c.nom AS client_nom
      FROM   avoirs    a
      JOIN   factures  f ON f.id = a.facture_id
      JOIN   clients   c ON c.id = a.client_id
      WHERE a.boutique_id = ? AND a.facture_id = ?
      ORDER  BY a.created_at DESC
      LIMIT  ? OFFSET ?
    `)
    db.__setListResponse(sqlSelectFact, [AVOIR_ENRICHI])

    const result = await listAvoirs(db, 1, { facture_id: '20' })

    expect(result.data).toHaveLength(1)
  })
})

// ─── getAvoir (migré — port Database) ────────────────────────────────────────

describe('getAvoir()', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => { db = createMockDatabase() })

  it('retourne null si avoir introuvable', async () => {
    db.__setListResponse(SQL_GET_LIGNES_AVOIR, [])

    const result = await getAvoir(db, 999)

    expect(result).toBeNull()
  })

  it('retourne l\'avoir enrichi avec lignes', async () => {
    db.__setResponse(SQL_GET_AVOIR, AVOIR_ENRICHI)
    db.__setListResponse(SQL_GET_LIGNES_AVOIR, [
      { id: 1, avoir_id: 5, ordre: 1, description: 'Remboursement', quantite: 1 },
    ])

    const result = await getAvoir(db, 5)

    expect(result).not.toBeNull()
    expect(result.id).toBe(5)
    expect(result.client_nom).toBe('Marie Dupont')
    expect(result.facture_numero).toBe('FAC-2026-00001')
    expect(result.lignes).toHaveLength(1)
  })

  it('retourne lignes vides si aucune ligne', async () => {
    db.__setResponse(SQL_GET_AVOIR, AVOIR_ENRICHI)
    db.__setListResponse(SQL_GET_LIGNES_AVOIR, [])

    const result = await getAvoir(db, 5)

    expect(result.lignes).toEqual([])
  })
})

// ─── createAvoir (non migré — D1Database, dépend de nextNumero/enregistrerTransaction/auditLog/batch) ─

describe('createAvoir()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => { db = createMockD1() })

  it('lance Error si type invalide', async () => {
    const input: CreateAvoirInput = {
      facture_id: 20, type: 'inconnu' as any, motif: 'Test', lignes: [LIGNE_AVOIR_INPUT],
    }

    await expect(createAvoir(db, 10, input))
      .rejects.toThrow('type doit être parmi')
  })

  it('lance Error si motif vide', async () => {
    const input: CreateAvoirInput = {
      facture_id: 20, motif: '   ', lignes: [LIGNE_AVOIR_INPUT],
    }

    await expect(createAvoir(db, 10, input))
      .rejects.toThrow('motif obligatoire.')
  })

  it('lance Error si lignes vides', async () => {
    const input: CreateAvoirInput = {
      facture_id: 20, motif: 'Pièce défectueuse', lignes: [],
    }

    await expect(createAvoir(db, 10, input))
      .rejects.toThrow('Au moins une ligne obligatoire.')
  })

  it('lance Error si facture introuvable', async () => {
    db.__setNotFound(SQL_GET_FACTURE_AVOIR)

    const input: CreateAvoirInput = {
      facture_id: 999, motif: 'Pièce défectueuse', lignes: [LIGNE_AVOIR_INPUT],
    }

    await expect(createAvoir(db, 10, input))
      .rejects.toThrow('Facture introuvable.')
  })

  it('lance Error si facture non émise (locked=0)', async () => {
    db.__setResponse(SQL_GET_FACTURE_AVOIR, { ...FACTURE_ROW, locked: 0 })

    const input: CreateAvoirInput = {
      facture_id: 20, motif: 'Erreur', lignes: [LIGNE_AVOIR_INPUT],
    }

    await expect(createAvoir(db, 10, input))
      .rejects.toThrow('Impossible d\'émettre un avoir sur une facture non émise.')
  })

  it('crée un avoir et retourne id + numero + hash_nf525', async () => {
    db.__setResponse(SQL_GET_FACTURE_AVOIR, { ...FACTURE_LOCKED, boutique_id: 1, client_id: 3 })
    db.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
      prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
      prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
    })
    db.__setResponse(SQL_NEXT_AVOIR_COUNT, { cnt: 0 })
    db.__setResponse(SQL_INSERT_AVOIR, { id: 5 })
    setupNf525(db)

    const input: CreateAvoirInput = {
      facture_id: 20, motif: 'Pièce défectueuse', lignes: [LIGNE_AVOIR_INPUT],
    }

    const result = await createAvoir(db, 10, input)

    expect(result.id).toBe(5)
    expect(result.numero).toMatch(/^AV-/)
    expect(result.hash_nf525).toHaveLength(64)
  })

  it('type = remboursement par défaut', async () => {
    db.__setResponse(SQL_GET_FACTURE_AVOIR, { ...FACTURE_LOCKED, boutique_id: 1, client_id: 3 })
    db.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
      prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
      prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
    })
    db.__setResponse(SQL_NEXT_AVOIR_COUNT, { cnt: 0 })
    db.__setResponse(SQL_INSERT_AVOIR, { id: 6 })
    setupNf525(db)

    const input: CreateAvoirInput = {
      facture_id: 20, motif: 'Défaut', lignes: [LIGNE_AVOIR_INPUT],
    }

    await createAvoir(db, 10, input)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql === SQL_INSERT_AVOIR)
    expect(insertCall).toBeDefined()
    expect(insertCall!.params[4]).toBe('remboursement')
  })

  it('INSERT journal_nf525 exécuté pour l\'avoir', async () => {
    db.__setResponse(SQL_GET_FACTURE_AVOIR, { ...FACTURE_LOCKED, boutique_id: 1, client_id: 3 })
    db.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
      prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
      prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
    })
    db.__setResponse(SQL_NEXT_AVOIR_COUNT, { cnt: 0 })
    db.__setResponse(SQL_INSERT_AVOIR, { id: 7 })
    setupNf525(db)

    await createAvoir(db, 10, {
      facture_id: 20, motif: 'Test NF525', lignes: [LIGNE_AVOIR_INPUT],
    })

    const calls = db.__getCalls()
    const nf525Call = calls.find(c => c.sql === SQL_NF525_INSERT)
    expect(nf525Call).toBeDefined()
    expect(nf525Call!.params[1]).toBe('avoir')
  })

  it('UPDATE avoir.hash_nf525 après NF525', async () => {
    db.__setResponse(SQL_GET_FACTURE_AVOIR, { ...FACTURE_LOCKED, boutique_id: 1, client_id: 3 })
    db.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
      prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
      prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
    })
    db.__setResponse(SQL_NEXT_AVOIR_COUNT, { cnt: 0 })
    db.__setResponse(SQL_INSERT_AVOIR, { id: 8 })
    setupNf525(db)

    await createAvoir(db, 10, {
      facture_id: 20, motif: 'Test hash', lignes: [LIGNE_AVOIR_INPUT],
    })

    const calls = db.__getCalls()
    const updateHashCall = calls.find(c => c.sql === SQL_UPDATE_AVOIR_HASH)
    expect(updateHashCall).toBeDefined()
    expect(updateHashCall!.params[1]).toBe(8)
  })

  it('appelle auditLog CREATE_AVOIR', async () => {
    db.__setResponse(SQL_GET_FACTURE_AVOIR, { ...FACTURE_LOCKED, boutique_id: 1, client_id: 3 })
    db.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
      prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
      prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
    })
    db.__setResponse(SQL_NEXT_AVOIR_COUNT, { cnt: 0 })
    db.__setResponse(SQL_INSERT_AVOIR, { id: 9 })
    setupNf525(db)

    await createAvoir(db, 10, {
      facture_id: 20, motif: 'Audit test', lignes: [LIGNE_AVOIR_INPUT],
    })

    const calls = db.__getCalls()
    const auditCall = calls.find(c => c.sql === SQL_AUDIT)
    expect(auditCall).toBeDefined()
    expect(auditCall!.params).toContain('CREATE_AVOIR')
    expect(auditCall!.params).toContain('avoir')
  })

  it('accepte et persiste date_expiration si fourni', async () => {
    db.__setResponse(SQL_GET_FACTURE_AVOIR, { ...FACTURE_LOCKED, boutique_id: 1, client_id: 3 })
    db.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
      prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
      prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
    })
    db.__setResponse(SQL_NEXT_AVOIR_COUNT, { cnt: 0 })
    db.__setResponse(SQL_INSERT_AVOIR, { id: 8 })
    setupNf525(db)

    const input: CreateAvoirInput = {
      facture_id: 20, motif: 'Annulation prise en charge #TKT-2026-00017',
      lignes: [LIGNE_AVOIR_INPUT], date_expiration: '2026-09-16T00:00:00.000Z',
    }

    await createAvoir(db, 10, input)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql === SQL_INSERT_AVOIR)
    expect(insertCall!.params).toContain('2026-09-16T00:00:00.000Z')
  })

  it('date_expiration reste null si non fourni (comportement existant inchangé)', async () => {
    db.__setResponse(SQL_GET_FACTURE_AVOIR, { ...FACTURE_LOCKED, boutique_id: 1, client_id: 3 })
    db.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
      prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
      prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
    })
    db.__setResponse(SQL_NEXT_AVOIR_COUNT, { cnt: 0 })
    db.__setResponse(SQL_INSERT_AVOIR, { id: 9 })
    setupNf525(db)

    const input: CreateAvoirInput = {
      facture_id: 20, motif: 'Pièce défectueuse', lignes: [LIGNE_AVOIR_INPUT],
    }

    await createAvoir(db, 10, input)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql === SQL_INSERT_AVOIR)
    expect(insertCall!.params).toContain(null)
  })
})

// ─── getDevisPourNf525 (migré — port Database) ───────────────────────────────

describe('getDevisPourNf525()', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => { db = createMockDatabase() })

  it('retourne null si devis introuvable', async () => {
    const result = await getDevisPourNf525(db, 999)

    expect(result).toBeNull()
  })

  it('retourne les champs NF525 du devis', async () => {
    db.__setResponse(SQL_GET_DEVIS_NF525, {
      boutique_id: 1, client_id: 3,
      total_ht: 80, total_tva: 16, total_ttc: 96,
    })

    const result = await getDevisPourNf525(db, 10)

    expect(result).not.toBeNull()
    expect(result!.boutique_id).toBe(1)
    expect(result!.total_ttc).toBe(96)
  })
})

// ─── updateFactureHash (migré — port Database) ───────────────────────────────

describe('updateFactureHash()', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => { db = createMockDatabase() })

  it('met à jour le hash_nf525 de la facture', async () => {
    await updateFactureHash(db, 20, 'abc123def456')

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql === SQL_UPDATE_FACTURE_HASH)
    expect(updateCall).toBeDefined()
    expect(updateCall!.params).toEqual(['abc123def456', 20])
  })
})

// ─── createFactureAcompte ─────────────────────────────────────────────────────

describe('createFactureAcompte()', () => {
  let db: ReturnType<typeof createMockD1>

  const SQL_CHECK_ACOMPTE_EXISTANT = n(`SELECT id FROM factures WHERE type_facture = 'acompte' AND (ticket_id = ? OR devis_id = ?)`)
  const SQL_INSERT_FACTURE_ACOMPTE = n(`
    INSERT INTO factures
      (boutique_id, numero, client_id, ticket_id, devis_id, type_facture, total_ht, total_tva, total_ttc, statut)
    VALUES (?, ?, ?, ?, ?, 'acompte', ?, ?, ?, 'brouillon')
    RETURNING id
  `)
  const SQL_GET_FACTURE_PAIEMENT = n(`SELECT id, total_ttc, montant_paye, boutique_id, locked FROM factures WHERE id = ?`)
  const SQL_GET_FACTURE_EMETTRE  = n(`SELECT * FROM factures WHERE id = ?`)
  const SQL_NF525_LAST_HASH      = n(`SELECT hash_courant FROM journal_nf525 WHERE boutique_id = ? ORDER BY id DESC LIMIT 1`)

  function setupNumeroFacture() {
    db.__setResponse(
      'SELECT prefix_ticket, prefix_facture, prefix_devis, prefix_avoir, prefix_rachat, format_numero, padding_numero FROM boutique_settings WHERE boutique_id = ?',
      { prefix_facture: 'FAC', format_numero: 'annee', padding_numero: 5 }
    )
    db.__setResponse(
      'SELECT dernier_num FROM sequences WHERE boutique_id = ? AND type = ? AND annee = ?',
      { dernier_num: 7 }
    )
  }

  function setupCreationComplete(factureId: number) {
    setupNumeroFacture()
    db.__setNotFound(SQL_CHECK_ACOMPTE_EXISTANT)
    db.__setResponseFn(SQL_INSERT_FACTURE_ACOMPTE, () => ({ id: factureId }))
    db.__setResponse(SQL_GET_FACTURE_PAIEMENT, {
      id: factureId, total_ttc: 120, montant_paye: 0, boutique_id: 1, locked: 0,
    })
    db.__setResponse(SQL_GET_FACTURE_EMETTRE, {
      id: factureId, boutique_id: 1, client_id: 3, numero: 'FAC-2026-00007',
      total_ht: 100, total_tva: 20, total_ttc: 120, locked: 0,
    })
    db.__setNotFound(SQL_NF525_LAST_HASH)
  }

  beforeEach(() => { db = createMockD1() })

  const BASE_INPUT: CreateFactureAcompteInput = {
    boutique_id: 1, client_id: 3, ticket_id: 42, devis_id: null,
    montant_ht: 100, tva_taux: 20,
    mode_paiement: 'especes',
  }

  it('lance Error si ni ticket_id ni devis_id', async () => {
    await expect(createFactureAcompte(db, 10, { ...BASE_INPUT, ticket_id: null, devis_id: null }))
      .rejects.toThrow('ticket_id ou devis_id requis.')
  })

  it('lance Error si montant_ht <= 0', async () => {
    await expect(createFactureAcompte(db, 10, { ...BASE_INPUT, montant_ht: 0 }))
      .rejects.toThrow('montant_ht doit être positif.')
  })

  it('lance Error si un acompte existe déjà pour ce dossier', async () => {
    db.__setResponse(SQL_CHECK_ACOMPTE_EXISTANT, { id: 99 })

    await expect(createFactureAcompte(db, 10, BASE_INPUT))
      .rejects.toThrow('Un acompte a déjà été facturé pour ce dossier.')
  })

  it('crée la facture, retourne facture_id + facture_numero', async () => {
    setupCreationComplete(50)

    const result = await createFactureAcompte(db, 10, BASE_INPUT)

    expect(result.facture_id).toBe(50)
    expect(result.facture_numero).toMatch(/^FAC-/)
  })

  it('INSERT facture avec type_facture=acompte et bons montants', async () => {
    setupCreationComplete(50)

    await createFactureAcompte(db, 10, BASE_INPUT)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql === SQL_INSERT_FACTURE_ACOMPTE)
    expect(insertCall).toBeDefined()
    // (boutique_id, numero, client_id, ticket_id, devis_id, total_ht, total_tva, total_ttc)
    expect(insertCall!.params[0]).toBe(1)   // boutique_id
    expect(insertCall!.params[2]).toBe(3)   // client_id
    expect(insertCall!.params[3]).toBe(42)  // ticket_id
    expect(insertCall!.params[4]).toBeNull() // devis_id
    expect(insertCall!.params[5]).toBe(100) // total_ht
    expect(insertCall!.params[6]).toBe(20)  // total_tva
    expect(insertCall!.params[7]).toBe(120) // total_ttc
  })

  it('enregistre le paiement puis émet et verrouille la facture', async () => {
    setupCreationComplete(50)

    await createFactureAcompte(db, 10, BASE_INPUT)

    const calls = db.__getCalls()
    expect(calls.some(c => c.sql.includes('INSERT INTO paiements'))).toBe(true)
    expect(calls.some(c => c.sql.includes('INSERT INTO journal_nf525'))).toBe(true)
    const lockCall = calls.find(c => c.sql.includes('SET') && c.sql.includes('locked') && c.sql.includes('factures'))
    expect(lockCall).toBeDefined()
  })

  it('appelle auditLog CREATE_FACTURE_ACOMPTE', async () => {
    setupCreationComplete(50)

    await createFactureAcompte(db, 10, BASE_INPUT)

    const calls = db.__getCalls()
    const auditCall = calls.find(c => c.sql.includes('INSERT INTO audit_logs') && c.params.includes('CREATE_FACTURE_ACOMPTE'))
    expect(auditCall).toBeDefined()
  })

  it('fonctionne aussi rattaché à un devis (ticket_id null)', async () => {
    setupCreationComplete(51)

    const result = await createFactureAcompte(db, 10, { ...BASE_INPUT, ticket_id: null, devis_id: 7 })

    expect(result.facture_id).toBe(51)
    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql === SQL_INSERT_FACTURE_ACOMPTE)
    expect(insertCall!.params[3]).toBeNull() // ticket_id
    expect(insertCall!.params[4]).toBe(7)    // devis_id
  })
})

// ─── createFacture ────────────────────────────────────────────────────────────

describe('createFacture()', () => {
  let db: ReturnType<typeof createMockD1>

  const SQL_CHECK_CLIENT = n(`SELECT id FROM clients WHERE id = ? AND boutique_id = ?`)
  const SQL_CHECK_TICKET = n(`SELECT id FROM tickets WHERE id = ? AND boutique_id = ?`)
  const SQL_INSERT_FACTURE = n(`
    INSERT INTO factures
      (boutique_id, numero, client_id, ticket_id, total_ht, total_tva, total_ttc, notes, conditions, date_execution, statut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'brouillon')
    RETURNING id
  `)

  function setupNumeroFacture() {
    db.__setResponse(
      'SELECT prefix_ticket, prefix_facture, prefix_devis, prefix_avoir, prefix_rachat, format_numero, padding_numero FROM boutique_settings WHERE boutique_id = ?',
      { prefix_facture: 'FAC', format_numero: 'annee', padding_numero: 5 }
    )
    db.__setResponse(
      'SELECT dernier_num FROM sequences WHERE boutique_id = ? AND type = ? AND annee = ?',
      { dernier_num: 7 }
    )
  }

  function setupBrouillon(factureId: number) {
    setupNumeroFacture()
    db.__setResponse(SQL_CHECK_CLIENT, { id: 3 })
    db.__setResponse(SQL_CHECK_TICKET, { id: 42 })
    db.__setResponseFn(SQL_INSERT_FACTURE, () => ({ id: factureId }))
  }

  beforeEach(() => { db = createMockD1() })

  const BASE_INPUT: CreateFactureInput = {
    boutique_id: 1,
    client_id:   3,
    ticket_id:   null,
    lignes: [
      { description: 'Réparation écran', quantite: 1, prix_unitaire_ht: 100, tva_taux: 20 },
    ],
    action: 'brouillon',
  }

  it('lance Error si aucune ligne', async () => {
    await expect(createFacture(db, 10, { ...BASE_INPUT, lignes: [] }))
      .rejects.toThrow('La facture doit contenir au moins une ligne.')
  })

  it('lance Error si une quantité est nulle ou négative', async () => {
    await expect(createFacture(db, 10, {
      ...BASE_INPUT,
      lignes: [{ description: 'X', quantite: 0, prix_unitaire_ht: 100, tva_taux: 20 }],
    })).rejects.toThrow('quantite doit être positive.')
  })

  it('lance Error si un prix unitaire est négatif', async () => {
    await expect(createFacture(db, 10, {
      ...BASE_INPUT,
      lignes: [{ description: 'X', quantite: 1, prix_unitaire_ht: -5, tva_taux: 20 }],
    })).rejects.toThrow('prix_unitaire_ht ne peut pas être négatif.')
  })

  it('lance Error si un taux de TVA n\'est pas autorisé', async () => {
    await expect(createFacture(db, 10, {
      ...BASE_INPUT,
      lignes: [{ description: 'X', quantite: 1, prix_unitaire_ht: 100, tva_taux: 7 }],
    })).rejects.toThrow('tva_taux invalide')
  })

  it('lance Error si le total TTC est nul', async () => {
    await expect(createFacture(db, 10, {
      ...BASE_INPUT,
      lignes: [{ description: 'Geste commercial', quantite: 1, prix_unitaire_ht: 0, tva_taux: 20 }],
    })).rejects.toThrow('Le total de la facture ne peut pas être nul.')
  })

  it('lance Error si le client appartient à une autre boutique', async () => {
    setupNumeroFacture()
    db.__setNotFound(SQL_CHECK_CLIENT)

    await expect(createFacture(db, 10, BASE_INPUT))
      .rejects.toThrow('Client introuvable dans cette boutique.')
  })

  it('lance Error si le ticket appartient à une autre boutique', async () => {
    setupNumeroFacture()
    db.__setResponse(SQL_CHECK_CLIENT, { id: 3 })
    db.__setNotFound(SQL_CHECK_TICKET)

    await expect(createFacture(db, 10, { ...BASE_INPUT, ticket_id: 42 }))
      .rejects.toThrow('Ticket introuvable dans cette boutique.')
  })

  it('ne consomme aucun numéro de facture quand la validation échoue', async () => {
    setupBrouillon(60)

    await expect(createFacture(db, 10, { ...BASE_INPUT, lignes: [] })).rejects.toThrow()

    const calls = db.__getCalls()
    expect(calls.some(c => c.sql.includes('sequences'))).toBe(false)
  })

  it('crée la facture en brouillon et retourne id + numéro + statut', async () => {
    setupBrouillon(60)

    const result = await createFacture(db, 10, BASE_INPUT)

    expect(result.facture_id).toBe(60)
    expect(result.facture_numero).toMatch(/^FAC-/)
    expect(result.statut).toBe('brouillon')
  })

  it('INSERT la facture avec les totaux calculés et les champs texte', async () => {
    setupBrouillon(60)

    await createFacture(db, 10, {
      ...BASE_INPUT,
      ticket_id: 42,
      notes: 'Merci de votre visite',
      conditions: 'Paiement à réception',
    })

    const insertCall = db.__getCalls().find(c => c.sql === SQL_INSERT_FACTURE)
    expect(insertCall).toBeDefined()
    // (boutique_id, numero, client_id, ticket_id, total_ht, total_tva, total_ttc, notes, conditions)
    expect(insertCall!.params[0]).toBe(1)                      // boutique_id
    expect(insertCall!.params[2]).toBe(3)                      // client_id
    expect(insertCall!.params[3]).toBe(42)                     // ticket_id
    expect(insertCall!.params[4]).toBe(100)                    // total_ht
    expect(insertCall!.params[5]).toBe(20)                     // total_tva
    expect(insertCall!.params[6]).toBe(120)                    // total_ttc
    expect(insertCall!.params[7]).toBe('Merci de votre visite') // notes
    expect(insertCall!.params[8]).toBe('Paiement à réception')  // conditions
  })

  // Les lignes sont écrites via db.batch(), que createMockD1 stube en no-op sans
  // enregistrer les statements (tests/helpers/mockD1.ts:192) — __getCalls() ne les
  // voit donc pas. Même limite que createAvoir(), qui utilise déjà db.batch(). On
  // vérifie ici le nombre de statements ; l'exactitude des totaux par ligne est
  // couverte par les tests de calculLignes() et par la vérification en base réelle
  // de la tâche 7 (SELECT sur lignes_document).
  it('écrit une ligne par ligne saisie, en un seul batch', async () => {
    setupBrouillon(60)

    await createFacture(db, 10, {
      ...BASE_INPUT,
      lignes: [
        { description: 'Écran',         quantite: 1, prix_unitaire_ht: 100, tva_taux: 20 },
        { description: 'Main d\'œuvre', quantite: 2, prix_unitaire_ht: 25,  tva_taux: 10 },
      ],
    })

    expect(db.batch).toHaveBeenCalledTimes(1)
    expect((db.batch as any).mock.calls[0][0]).toHaveLength(2)
  })

  it('enregistre la date d\'exécution fournie', async () => {
    setupBrouillon(65)

    await createFacture(db, 10, { ...BASE_INPUT, date_execution: '2026-07-15' })

    const insertCall = db.__getCalls().find(c => c.sql === SQL_INSERT_FACTURE)
    expect(insertCall!.params[9]).toBe('2026-07-15')
  })

  it('retombe sur la date du jour si aucune date d\'exécution n\'est fournie', async () => {
    setupBrouillon(66)

    await createFacture(db, 10, BASE_INPUT)

    const insertCall = db.__getCalls().find(c => c.sql === SQL_INSERT_FACTURE)
    expect(insertCall!.params[9]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('calcule les totaux du document à partir de tous les taux de TVA', async () => {
    setupBrouillon(60)

    await createFacture(db, 10, {
      ...BASE_INPUT,
      lignes: [
        { description: 'Écran',         quantite: 1, prix_unitaire_ht: 100, tva_taux: 20 },
        { description: 'Main d\'œuvre', quantite: 2, prix_unitaire_ht: 25,  tva_taux: 10 },
      ],
    })

    const insertCall = db.__getCalls().find(c => c.sql === SQL_INSERT_FACTURE)
    expect(insertCall!.params[4]).toBe(150)  // total_ht  = 100 + 50
    expect(insertCall!.params[5]).toBe(25)   // total_tva = 20 + 5
    expect(insertCall!.params[6]).toBe(175)  // total_ttc
  })

  it('n\'émet ni n\'encaisse rien en action brouillon', async () => {
    setupBrouillon(60)

    await createFacture(db, 10, BASE_INPUT)

    const calls = db.__getCalls()
    expect(calls.some(c => c.sql.includes('INSERT INTO paiements'))).toBe(false)
    expect(calls.some(c => c.sql.includes('INSERT INTO journal_nf525'))).toBe(false)
  })

  it('appelle auditLog CREATE_FACTURE', async () => {
    setupBrouillon(60)

    await createFacture(db, 10, BASE_INPUT)

    const auditCall = db.__getCalls().find(
      c => c.sql.includes('INSERT INTO audit_logs') && c.params.includes('CREATE_FACTURE')
    )
    expect(auditCall).toBeDefined()
  })

  const SQL_GET_FACTURE_PAIEMENT = n(`SELECT id, total_ttc, montant_paye, boutique_id, locked FROM factures WHERE id = ?`)
  const SQL_GET_FACTURE_EMETTRE  = n(`SELECT * FROM factures WHERE id = ?`)
  const SQL_NF525_LAST_HASH      = n(`SELECT hash_courant FROM journal_nf525 WHERE boutique_id = ? ORDER BY id DESC LIMIT 1`)

  function setupEmission(factureId: number) {
    setupBrouillon(factureId)
    db.__setResponse(SQL_GET_FACTURE_PAIEMENT, {
      id: factureId, total_ttc: 120, montant_paye: 0, boutique_id: 1, locked: 0,
    })
    db.__setResponse(SQL_GET_FACTURE_EMETTRE, {
      id: factureId, boutique_id: 1, client_id: 3, numero: 'FAC-2026-00008',
      total_ht: 100, total_tva: 20, total_ttc: 120, locked: 0,
    })
    db.__setNotFound(SQL_NF525_LAST_HASH)
  }

  it('lance Error si action=emettre_encaisser sans mode_paiement', async () => {
    await expect(createFacture(db, 10, { ...BASE_INPUT, action: 'emettre_encaisser' }))
      .rejects.toThrow('mode_paiement obligatoire pour encaisser.')
  })

  it('action=emettre : verrouille la facture sans encaisser', async () => {
    setupEmission(61)

    const result = await createFacture(db, 10, { ...BASE_INPUT, action: 'emettre' })

    const calls = db.__getCalls()
    expect(calls.some(c => c.sql.includes('INSERT INTO journal_nf525'))).toBe(true)
    expect(calls.some(c => c.sql.includes('INSERT INTO paiements'))).toBe(false)
    expect(result.statut).toBe('en_attente')
  })

  it('action=emettre_encaisser : encaisse le TTC puis verrouille', async () => {
    setupEmission(62)

    const result = await createFacture(db, 10, {
      ...BASE_INPUT, action: 'emettre_encaisser', mode_paiement: 'especes',
    })

    const calls = db.__getCalls()
    const paiement = calls.find(c => c.sql.includes('INSERT INTO paiements'))
    expect(paiement).toBeDefined()
    // (facture_id, boutique_id, montant, mode_paiement, reference, user_id, notes)
    expect(paiement!.params[2]).toBe(120)        // montant = total TTC
    expect(paiement!.params[3]).toBe('especes')  // mode_paiement
    expect(calls.some(c => c.sql.includes('INSERT INTO journal_nf525'))).toBe(true)
    expect(result.statut).toBe('payee')
  })

  it('encaisse avant d\'émettre (ajouterPaiement exige locked=0)', async () => {
    setupEmission(63)

    await createFacture(db, 10, {
      ...BASE_INPUT, action: 'emettre_encaisser', mode_paiement: 'carte',
    })

    const calls = db.__getCalls()
    const idxPaiement = calls.findIndex(c => c.sql.includes('INSERT INTO paiements'))
    const idxNf525    = calls.findIndex(c => c.sql.includes('INSERT INTO journal_nf525'))
    expect(idxPaiement).toBeGreaterThan(-1)
    expect(idxNf525).toBeGreaterThan(idxPaiement)
  })

  it('transmet la référence de paiement quand elle est fournie', async () => {
    setupEmission(64)

    await createFacture(db, 10, {
      ...BASE_INPUT, action: 'emettre_encaisser', mode_paiement: 'cheque', reference: 'CHQ-4412',
    })

    const paiement = db.__getCalls().find(c => c.sql.includes('INSERT INTO paiements'))
    expect(paiement!.params[4]).toBe('CHQ-4412')
  })
})
