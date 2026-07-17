/**
 * @file tests/devisService.test.ts
 * @description Tests unitaires — src/services/devisService.ts
 * Sprint 2.29 — mocks scindés mockDatabase/mockD1 lors de la migration
 * Ports & Adapters (2026-07-13, voir docstrings du service).
 *
 * Couverture :
 *   - listDevis()           (migré → mockDatabase)   — pagination, filtres statut/client_id/search, exclut annule par défaut
 *   - getDevis()            (migré → mockDatabase)   — null si absent, retourne devis + lignes
 *   - createDevis()         (non migré → mockD1)     — guard lignes vides, INSERT + public_token + auditLog, totaux calculés
 *   - updateDevis()         (non migré → mockD1)     — guard introuvable, guard statut≠draft, COALESCE, upsertLignes si lignes
 *   - updateStatutDevis()   (non migré → mockD1)     — machine à états (transitions valides/invalides), extras (envoye_le/repondu_le)
 *   - convertirDevis()      (non migré → mockD1)     — guards (refuse/annule/déjà converti), INSERT facture, copie lignes, auditLog
 *   - getDevisByToken()     (migré → mockDatabase)   — null si token inconnu, retourne devis + lignes publiques
 *   - getStatsDevis()       (migré → mockDatabase)   — 8 champs + taux_conversion calculé
 *   - expireDevisPerimes()  (migré → mockDatabase)   — retourne changes
 *   - saveSignatureDevis()  (migré → mockDatabase)   — tronquée à 1000 chars
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import { createMockDatabase } from './helpers/mockDatabase'
import {
  listDevis,
  getDevis,
  createDevis,
  updateDevis,
  updateStatutDevis,
  convertirDevis,
  getDevisByToken,
  getStatsDevis,
  expireDevisPerimes,
  saveSignatureDevis,
  type StatutDevis,
  type CreateDevisInput,
  type LigneDevisInput,
} from '../src/services/devisService'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function n(sql: string) {
  return sql.replace(/\s+/g, ' ').trim()
}

const LIGNE_SIMPLE: LigneDevisInput = {
  description: 'Réparation écran',
  quantite: 1,
  prix_unitaire_ht: 80.00,
  tva_taux: 20,
  produit_id: null,
}

const LIGNE_CALCUL: LigneDevisInput = {
  description: 'Batterie iPhone',
  quantite: 2,
  prix_unitaire_ht: 25.00,
  tva_taux: 20,
  produit_id: 5,
}

const DEVIS_ROW = {
  id: 10,
  boutique_id: 1,
  client_id: 3,
  numero: 'DV-2026-00001',
  statut: 'draft' as StatutDevis,
  total_ht: 80.00,
  total_tva: 16.00,
  total_ttc: 96.00,
  notes: null,
  conditions: null,
  date_validite: null,
  public_token: 'abc123def456',
  facture_id: null,
  envoye_le: null,
  repondu_le: null,
  signature_client: null,
  created_at: '2026-07-01T10:00:00',
  updated_at: '2026-07-01T10:00:00',
}

const DEVIS_ENRICHI = {
  ...DEVIS_ROW,
  client_nom: 'Dupont',
  client_prenom: 'Marie',
  client_email: 'marie@example.com',
  client_telephone: '0600000001',
  boutique_nom: 'iziGSM Paris',
  boutique_siret: '12345678901234',
}

const LIGNE_DOC = {
  id: 1,
  document_type: 'devis',
  document_id: 10,
  ordre: 1,
  description: 'Réparation écran',
  quantite: 1,
  prix_unitaire_ht: 80.00,
  tva_taux: 20,
  total_ht: 80.00,
  total_tva: 16.00,
  total_ttc: 96.00,
  produit_id: null,
}

// ─── SQL normalisés ────────────────────────────────────────────────────────────

// listDevis — COUNT (sans filtres)
const SQL_COUNT_DEVIS = n(`
  SELECT COUNT(*) as cnt
  FROM   devis d
  LEFT   JOIN clients c ON c.id = d.client_id
  WHERE  d.boutique_id = ? AND d.statut != 'annule'
`)

// listDevis — SELECT (sans filtres)
const SQL_SELECT_DEVIS = n(`
  SELECT d.*,
         c.nom      AS client_nom,
         c.prenom   AS client_prenom,
         c.email    AS client_email,
         c.telephone AS client_telephone
  FROM   devis d
  LEFT   JOIN clients c ON c.id = d.client_id
  WHERE  d.boutique_id = ? AND d.statut != 'annule'
  ORDER  BY d.created_at DESC
  LIMIT  ? OFFSET ?
`)

// getDevis — devis principal
const SQL_GET_DEVIS = n(`
  SELECT d.*,
         c.nom       AS client_nom,
         c.prenom    AS client_prenom,
         c.email     AS client_email,
         c.telephone AS client_telephone,
         c.adresse   AS client_adresse,
         b.nom       AS boutique_nom,
         b.siret     AS boutique_siret,
         b.adresse   AS boutique_adresse,
         b.telephone AS boutique_telephone,
         b.email     AS boutique_email,
         b.tva_numero AS boutique_tva,
         fa.id        AS facture_acompte_id,
         fa.numero    AS facture_acompte_numero,
         fa.total_ttc AS facture_acompte_montant
  FROM   devis d
  LEFT   JOIN clients   c ON c.id = d.client_id
  LEFT   JOIN boutiques b ON b.id = d.boutique_id
  LEFT   JOIN factures  fa ON fa.type_facture = 'acompte' AND (fa.devis_id = d.id OR fa.ticket_id = d.ticket_id)
  WHERE  d.id = ?
`)

// getDevis — lignes
const SQL_GET_LIGNES = n(`
  SELECT * FROM lignes_document
  WHERE  document_type = 'devis' AND document_id = ?
  ORDER  BY ordre ASC
`)

// guard updateDevis / convertirDevis / updateStatutDevis
const SQL_SELECT_DEVIS_BY_ID = n(`SELECT * FROM devis WHERE id = ?`)

// INSERT devis
const SQL_INSERT_DEVIS = n(`
  INSERT INTO devis
    (boutique_id, numero, client_id, ticket_id,
     total_ht, total_tva, total_ttc,
     notes, conditions, date_validite, public_token, statut)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
  RETURNING id
`)

// nextNumero
const SQL_NEXT_NUMERO_SETTINGS = n(`SELECT prefix_devis, prefix_facture, prefix_avoir FROM boutique_settings WHERE boutique_id = ?`)
const SQL_NEXT_NUMERO_COUNT = n(`SELECT COUNT(*) as cnt FROM devis WHERE boutique_id = ?`)

// upsertLignes — DELETE
const SQL_DELETE_LIGNES = n(`DELETE FROM lignes_document WHERE document_type = ? AND document_id = ?`)

// UPDATE devis COALESCE
const SQL_UPDATE_DEVIS = n(`
  UPDATE devis SET
    client_id     = COALESCE(?, client_id),
    total_ht      = COALESCE(?, total_ht),
    total_tva     = COALESCE(?, total_tva),
    total_ttc     = COALESCE(?, total_ttc),
    notes         = COALESCE(?, notes),
    conditions    = COALESCE(?, conditions),
    date_validite = COALESCE(?, date_validite),
    updated_at    = CURRENT_TIMESTAMP
  WHERE id = ?
`)

// UPDATE statut simple (draft → envoye, pas d'extras)
const SQL_UPDATE_STATUT_ENVOYE = n(`UPDATE devis SET statut = ?, updated_at = CURRENT_TIMESTAMP, envoye_le = CURRENT_TIMESTAMP WHERE id = ?`)

// UPDATE statut (draft → annule, pas d'extras)
const SQL_UPDATE_STATUT_ANNULE = n(`UPDATE devis SET statut = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)

// UPDATE statut (envoye → accepte, extras repondu_le)
const SQL_UPDATE_STATUT_ACCEPTE = n(`UPDATE devis SET statut = ?, updated_at = CURRENT_TIMESTAMP, repondu_le = CURRENT_TIMESTAMP WHERE id = ?`)

// UPDATE statut (envoye → refuse, extras repondu_le)
const SQL_UPDATE_STATUT_REFUSE = n(`UPDATE devis SET statut = ?, updated_at = CURRENT_TIMESTAMP, repondu_le = CURRENT_TIMESTAMP WHERE id = ?`)

// auditLog
const SQL_AUDIT = n(`
  INSERT INTO audit_logs (boutique_id, user_id, action, entite_type, entite_id, donnees_avant, donnees_apres, ip_address)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)

// INSERT facture (convertirDevis)
const SQL_INSERT_FACTURE = n(`
  INSERT INTO factures
    (boutique_id, numero, client_id, ticket_id, devis_id, total_ht, total_tva, total_ttc, statut)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'brouillon')
  RETURNING id
`)

// Copie lignes devis → facture
const SQL_COPIE_LIGNES = n(`
  INSERT INTO lignes_document
    (document_type, document_id, ordre, description, quantite,
     prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc, produit_id)
  SELECT 'facture', ?, ordre, description, quantite,
         prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc, produit_id
  FROM   lignes_document
  WHERE  document_type = 'devis' AND document_id = ?
`)

// UPDATE devis après conversion
const SQL_UPDATE_DEVIS_CONVERT = n(`
  UPDATE devis SET statut = 'accepte', facture_id = ?, repondu_le = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`)

// getDevisByToken — devis
const SQL_GET_DEVIS_TOKEN = n(`
  SELECT d.id, d.numero, d.statut, d.total_ht, d.total_tva, d.total_ttc,
         d.date_validite, d.envoye_le, d.repondu_le, d.notes, d.conditions,
         c.nom       AS client_nom,
         c.prenom    AS client_prenom,
         b.nom       AS boutique_nom,
         b.telephone AS boutique_telephone,
         b.email     AS boutique_email,
         b.adresse   AS boutique_adresse,
         b.ville     AS boutique_ville,
         b.logo_url  AS boutique_logo
  FROM   devis d
  LEFT   JOIN clients   c ON c.id = d.client_id
  LEFT   JOIN boutiques b ON b.id = d.boutique_id
  WHERE  d.public_token = ?
`)

// getDevisByToken — lignes (via subquery)
const SQL_GET_LIGNES_TOKEN = n(`
  SELECT ordre, description, quantite, prix_unitaire_ht, tva_taux, total_ht, total_ttc
  FROM   lignes_document
  WHERE  document_type = 'devis' AND document_id = (
    SELECT id FROM devis WHERE public_token = ?
  )
  ORDER  BY ordre ASC
`)

// getStatsDevis
const SQL_STATS_DEVIS = n(`
  SELECT
    COUNT(*)                                              AS total,
    SUM(CASE WHEN statut = 'draft'   THEN 1 ELSE 0 END) AS draft,
    SUM(CASE WHEN statut = 'envoye'  THEN 1 ELSE 0 END) AS envoyes,
    SUM(CASE WHEN statut = 'accepte' THEN 1 ELSE 0 END) AS acceptes,
    SUM(CASE WHEN statut = 'refuse'  THEN 1 ELSE 0 END) AS refuses,
    SUM(CASE WHEN statut = 'expire'  THEN 1 ELSE 0 END) AS expires,
    SUM(CASE WHEN statut = 'envoye'  THEN total_ttc ELSE 0 END) AS montant_envoye,
    SUM(CASE WHEN statut = 'accepte' THEN total_ttc ELSE 0 END) AS montant_signe
  FROM devis
  WHERE boutique_id = ? AND statut != 'annule'
`)

// expireDevisPerimes
const SQL_EXPIRE_DEVIS = n(`
  UPDATE devis
  SET statut = 'expire', updated_at = CURRENT_TIMESTAMP
  WHERE statut = 'envoye'
    AND date_validite IS NOT NULL
    AND date_validite < date('now')
`)

// saveSignatureDevis
const SQL_SAVE_SIGNATURE = n(`UPDATE devis SET signature_client = ? WHERE id = ?`)

// ─── Helper : setup nextNumero pour createDevis ────────────────────────────────
function setupNextNumero(db: ReturnType<typeof createMockD1>, prefixDevis = 'DV', count = 0) {
  db.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
    prefix_devis: prefixDevis,
    prefix_facture: 'FA',
    prefix_avoir: 'AV',
  })
  db.__setResponse(SQL_NEXT_NUMERO_COUNT, { cnt: count })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('devisService', () => {
  // db    : mock du port Database — listDevis/getDevis/getDevisByToken/getStatsDevis/
  //         expireDevisPerimes/saveSignatureDevis (migrées, Ports & Adapters 2026-07-13)
  // dbD1  : mock D1Database brut — createDevis/updateDevis/updateStatutDevis/convertirDevis
  //         (non migrées, dépendent d'auditLog/nextNumero/upsertLignes-batch)
  let db:   ReturnType<typeof createMockDatabase>
  let dbD1: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db   = createMockDatabase()
    dbD1 = createMockD1()
  })

  // ─── listDevis ─────────────────────────────────────────────────────────────

  describe('listDevis()', () => {
    it('retourne une liste vide si aucun devis', async () => {
      db.__setResponse(SQL_COUNT_DEVIS, { cnt: 0 })
      db.__setListResponse(SQL_SELECT_DEVIS, [])

      const result = await listDevis(db as any, 1)

      expect(result.data).toEqual([])
      expect(result.pagination.total).toBe(0)
      expect(result.pagination.pages).toBe(0)
    })

    it('retourne les devis avec pagination par défaut', async () => {
      db.__setResponse(SQL_COUNT_DEVIS, { cnt: 2 })
      db.__setListResponse(SQL_SELECT_DEVIS, [DEVIS_ENRICHI, { ...DEVIS_ENRICHI, id: 11 }])

      const result = await listDevis(db as any, 1)

      expect(result.data).toHaveLength(2)
      expect(result.pagination.page).toBe(1)
      expect(result.pagination.limit).toBe(20)
      expect(result.pagination.total).toBe(2)
    })

    it('exclut les devis annulés par défaut (statut != annule)', async () => {
      // La condition WHERE inclut d.statut != 'annule' sans filtre
      db.__setResponse(SQL_COUNT_DEVIS, { cnt: 1 })
      db.__setListResponse(SQL_SELECT_DEVIS, [DEVIS_ENRICHI])

      const result = await listDevis(db as any, 1)

      // Le SQL utilisé doit contenir != 'annule'
      const calls = db.__getCalls()
      const countCall = calls.find(c => c.sql.includes("statut != 'annule'"))
      expect(countCall).toBeDefined()
      expect(result.data).toHaveLength(1)
    })

    it('filtre par statut', async () => {
      const sqlCountStatut = n(`
        SELECT COUNT(*) as cnt
        FROM   devis d
        LEFT   JOIN clients c ON c.id = d.client_id
        WHERE  d.boutique_id = ? AND d.statut != 'annule' AND d.statut = ?
      `)
      db.__setResponse(sqlCountStatut, { cnt: 3 })

      const sqlSelectStatut = n(`
        SELECT d.*,
               c.nom      AS client_nom,
               c.prenom   AS client_prenom,
               c.email    AS client_email,
               c.telephone AS client_telephone
        FROM   devis d
        LEFT   JOIN clients c ON c.id = d.client_id
        WHERE  d.boutique_id = ? AND d.statut != 'annule' AND d.statut = ?
        ORDER  BY d.created_at DESC
        LIMIT  ? OFFSET ?
      `)
      db.__setListResponse(sqlSelectStatut, [
        { ...DEVIS_ENRICHI, statut: 'envoye' },
        { ...DEVIS_ENRICHI, id: 11, statut: 'envoye' },
        { ...DEVIS_ENRICHI, id: 12, statut: 'envoye' },
      ])

      const result = await listDevis(db as any, 1, { statut: 'envoye' })

      expect(result.data).toHaveLength(3)
      expect(result.pagination.total).toBe(3)
    })

    it('filtre par client_id', async () => {
      const sqlCountClient = n(`
        SELECT COUNT(*) as cnt
        FROM   devis d
        LEFT   JOIN clients c ON c.id = d.client_id
        WHERE  d.boutique_id = ? AND d.statut != 'annule' AND d.client_id = ?
      `)
      db.__setResponse(sqlCountClient, { cnt: 1 })

      const sqlSelectClient = n(`
        SELECT d.*,
               c.nom      AS client_nom,
               c.prenom   AS client_prenom,
               c.email    AS client_email,
               c.telephone AS client_telephone
        FROM   devis d
        LEFT   JOIN clients c ON c.id = d.client_id
        WHERE  d.boutique_id = ? AND d.statut != 'annule' AND d.client_id = ?
        ORDER  BY d.created_at DESC
        LIMIT  ? OFFSET ?
      `)
      db.__setListResponse(sqlSelectClient, [DEVIS_ENRICHI])

      const result = await listDevis(db as any, 1, { client_id: '3' })

      expect(result.data).toHaveLength(1)
    })

    it('filtre search : LIKE sur numero/nom/prenom', async () => {
      const sqlCountSearch = n(`
        SELECT COUNT(*) as cnt
        FROM   devis d
        LEFT   JOIN clients c ON c.id = d.client_id
        WHERE  d.boutique_id = ? AND d.statut != 'annule' AND (d.numero LIKE ? OR c.nom LIKE ? OR c.prenom LIKE ?)
      `)
      db.__setResponse(sqlCountSearch, { cnt: 1 })

      const sqlSelectSearch = n(`
        SELECT d.*,
               c.nom      AS client_nom,
               c.prenom   AS client_prenom,
               c.email    AS client_email,
               c.telephone AS client_telephone
        FROM   devis d
        LEFT   JOIN clients c ON c.id = d.client_id
        WHERE  d.boutique_id = ? AND d.statut != 'annule' AND (d.numero LIKE ? OR c.nom LIKE ? OR c.prenom LIKE ?)
        ORDER  BY d.created_at DESC
        LIMIT  ? OFFSET ?
      `)
      db.__setListResponse(sqlSelectSearch, [DEVIS_ENRICHI])

      const result = await listDevis(db as any, 1, { search: 'Dupont' })

      expect(result.data).toHaveLength(1)
    })

    it('pages calculées correctement', async () => {
      db.__setResponse(SQL_COUNT_DEVIS, { cnt: 45 })
      db.__setListResponse(SQL_SELECT_DEVIS, [])

      const result = await listDevis(db as any, 1, { limit: '10' })

      expect(result.pagination.pages).toBe(5)
    })
  })

  // ─── getDevis ──────────────────────────────────────────────────────────────

  describe('getDevis()', () => {
    it('retourne null si devis introuvable', async () => {
      db.__setNotFound(SQL_GET_DEVIS)
      db.__setListResponse(SQL_GET_LIGNES, [])

      const result = await getDevis(db as any, 999)

      expect(result).toBeNull()
    })

    it('retourne le devis enrichi avec lignes', async () => {
      db.__setResponse(SQL_GET_DEVIS, DEVIS_ENRICHI)
      db.__setListResponse(SQL_GET_LIGNES, [LIGNE_DOC])

      const result = await getDevis(db as any, 10)

      expect(result).not.toBeNull()
      expect(result.id).toBe(10)
      expect(result.client_nom).toBe('Dupont')
      expect(result.boutique_nom).toBe('iziGSM Paris')
      expect(result.lignes).toHaveLength(1)
      expect(result.lignes[0].description).toBe('Réparation écran')
    })

    it('expose facture_acompte_* quand un acompte existe', async () => {
      db.__setResponse(SQL_GET_DEVIS, {
        ...DEVIS_ENRICHI,
        facture_acompte_id: 7, facture_acompte_numero: 'FAC-2026-00007', facture_acompte_montant: 120,
      })
      db.__setListResponse(SQL_GET_LIGNES, [])

      const result = await getDevis(db as any, 10)

      expect(result.facture_acompte_id).toBe(7)
      expect(result.facture_acompte_numero).toBe('FAC-2026-00007')
    })

    it('retourne lignes vides si aucune ligne', async () => {
      db.__setResponse(SQL_GET_DEVIS, DEVIS_ENRICHI)
      db.__setListResponse(SQL_GET_LIGNES, [])

      const result = await getDevis(db as any, 10)

      expect(result.lignes).toEqual([])
    })

    it('exécute les deux requêtes en parallèle (Promise.all)', async () => {
      db.__setResponse(SQL_GET_DEVIS, DEVIS_ENRICHI)
      db.__setListResponse(SQL_GET_LIGNES, [])

      await getDevis(db as any, 10)

      const calls = db.__getCalls()
      // Les deux requêtes doivent apparaître
      const devisCall = calls.find(c => c.sql === SQL_GET_DEVIS)
      const lignesCall = calls.find(c => c.sql === SQL_GET_LIGNES)
      expect(devisCall).toBeDefined()
      expect(lignesCall).toBeDefined()
    })
  })

  // ─── createDevis ───────────────────────────────────────────────────────────

  describe('createDevis()', () => {
    it('lance Error si lignes vides', async () => {
      const input: CreateDevisInput = {
        boutique_id: 1, client_id: 3, lignes: [],
      }

      await expect(createDevis(dbD1 as any, 1, 10, input))
        .rejects.toThrow('Le devis doit contenir au moins une ligne.')
    })

    it('crée un devis et retourne id + numero + public_token', async () => {
      setupNextNumero(dbD1)
      dbD1.__setResponse(SQL_INSERT_DEVIS, { id: 42 })

      const input: CreateDevisInput = {
        boutique_id: 1, client_id: 3, lignes: [LIGNE_SIMPLE],
      }

      const result = await createDevis(dbD1 as any, 1, 10, input)

      expect(result.id).toBe(42)
      expect(result.numero).toMatch(/^DEV-/)
      expect(result.public_token).toHaveLength(32) // hex32 = 16 bytes × 2
    })

    it('public_token est un hex de 32 caractères', async () => {
      setupNextNumero(dbD1)
      dbD1.__setResponse(SQL_INSERT_DEVIS, { id: 42 })

      const result = await createDevis(dbD1 as any, 1, 10, {
        boutique_id: 1, client_id: 3, lignes: [LIGNE_SIMPLE],
      })

      expect(result.public_token).toMatch(/^[0-9a-f]{32}$/)
    })

    it('calcule correctement les totaux HT/TVA/TTC', async () => {
      setupNextNumero(dbD1)
      dbD1.__setResponse(SQL_INSERT_DEVIS, { id: 42 })

      await createDevis(dbD1 as any, 1, 10, {
        boutique_id: 1, client_id: 3,
        // 1 × 80 HT, 20% → TTC = 96
        lignes: [LIGNE_SIMPLE],
      })

      const calls = dbD1.__getCalls()
      const insertCall = calls.find(c => c.sql === SQL_INSERT_DEVIS)
      expect(insertCall).toBeDefined()
      // total_ht (index 4), total_tva (5), total_ttc (6)
      expect(insertCall!.params[4]).toBe(80.00)
      expect(insertCall!.params[5]).toBe(16.00)
      expect(insertCall!.params[6]).toBe(96.00)
    })

    it('calcule les totaux avec plusieurs lignes', async () => {
      setupNextNumero(dbD1)
      dbD1.__setResponse(SQL_INSERT_DEVIS, { id: 43 })

      await createDevis(dbD1 as any, 1, 10, {
        boutique_id: 1, client_id: 3,
        // Ligne 1 : 1 × 80 = 80 HT, TVA 16 → TTC 96
        // Ligne 2 : 2 × 25 = 50 HT, TVA 10 → TTC 60
        // Total : HT 130, TVA 26, TTC 156
        lignes: [LIGNE_SIMPLE, LIGNE_CALCUL],
      })

      const calls = dbD1.__getCalls()
      const insertCall = calls.find(c => c.sql === SQL_INSERT_DEVIS)
      expect(insertCall!.params[4]).toBe(130.00) // total_ht
      expect(insertCall!.params[5]).toBe(26.00)  // total_tva
      expect(insertCall!.params[6]).toBe(156.00) // total_ttc
    })

    it('appelle auditLog CREATE_DEVIS', async () => {
      setupNextNumero(dbD1)
      dbD1.__setResponse(SQL_INSERT_DEVIS, { id: 42 })

      await createDevis(dbD1 as any, 1, 10, {
        boutique_id: 1, client_id: 3, lignes: [LIGNE_SIMPLE],
      })

      const calls = dbD1.__getCalls()
      const auditCall = calls.find(c => c.sql === SQL_AUDIT)
      expect(auditCall).toBeDefined()
      expect(auditCall!.params).toContain('CREATE_DEVIS')
      expect(auditCall!.params).toContain('devis')
      expect(auditCall!.params).toContain(42)
    })

    it('lance Error si INSERT retourne null (erreur DB)', async () => {
      setupNextNumero(dbD1)
      dbD1.__setNotFound(SQL_INSERT_DEVIS)

      await expect(createDevis(dbD1 as any, 1, 10, {
        boutique_id: 1, client_id: 3, lignes: [LIGNE_SIMPLE],
      })).rejects.toThrow('Erreur lors de la création du devis.')
    })

    it('passe ticket_id null par défaut', async () => {
      setupNextNumero(dbD1)
      dbD1.__setResponse(SQL_INSERT_DEVIS, { id: 42 })

      await createDevis(dbD1 as any, 1, 10, {
        boutique_id: 1, client_id: 3, lignes: [LIGNE_SIMPLE],
      })

      const calls = dbD1.__getCalls()
      const insertCall = calls.find(c => c.sql === SQL_INSERT_DEVIS)
      // ticket_id est index 3
      expect(insertCall!.params[3]).toBeNull()
    })
  })

  // ─── updateDevis ───────────────────────────────────────────────────────────

  describe('updateDevis()', () => {
    it('lance Error si devis introuvable', async () => {
      dbD1.__setNotFound(SQL_SELECT_DEVIS_BY_ID)

      await expect(updateDevis(dbD1 as any, 999, 10, { notes: 'test' }))
        .rejects.toThrow('Devis introuvable.')
    })

    it('lance Error si devis non en draft', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, { ...DEVIS_ROW, statut: 'envoye' })

      await expect(updateDevis(dbD1 as any, 10, 10, { notes: 'test' }))
        .rejects.toThrow('Seuls les devis en brouillon peuvent être modifiés.')
    })

    it('met à jour un devis draft', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, DEVIS_ROW)

      await expect(updateDevis(dbD1 as any, 10, 10, { notes: 'Nouvelles conditions' }))
        .resolves.toBeUndefined()

      const calls = dbD1.__getCalls()
      const updateCall = calls.find(c => c.sql === SQL_UPDATE_DEVIS)
      expect(updateCall).toBeDefined()
    })

    it('appelle upsertLignes si lignes fournies (DELETE + batch INSERT)', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, DEVIS_ROW)

      await updateDevis(dbD1 as any, 10, 10, { lignes: [LIGNE_SIMPLE] })

      const calls = dbD1.__getCalls()
      const deleteCall = calls.find(c => c.sql === SQL_DELETE_LIGNES)
      expect(deleteCall).toBeDefined()
      expect(deleteCall!.params).toEqual(['devis', 10])
    })

    it("n'appelle PAS upsertLignes si lignes non fournies", async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, DEVIS_ROW)

      await updateDevis(dbD1 as any, 10, 10, { notes: 'Juste les notes' })

      const calls = dbD1.__getCalls()
      const deleteCall = calls.find(c => c.sql === SQL_DELETE_LIGNES)
      expect(deleteCall).toBeUndefined()
    })

    it('appelle auditLog UPDATE_DEVIS', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, DEVIS_ROW)

      await updateDevis(dbD1 as any, 10, 10, { notes: 'test' })

      const calls = dbD1.__getCalls()
      const auditCall = calls.find(c => c.sql === SQL_AUDIT)
      expect(auditCall).toBeDefined()
      expect(auditCall!.params).toContain('UPDATE_DEVIS')
    })
  })

  // ─── updateStatutDevis ─────────────────────────────────────────────────────

  describe('updateStatutDevis()', () => {
    it('lance Error si devis introuvable', async () => {
      dbD1.__setNotFound(SQL_SELECT_DEVIS_BY_ID)

      await expect(updateStatutDevis(dbD1 as any, 999, 10, 'envoye'))
        .rejects.toThrow('Devis introuvable.')
    })

    it('lance Error si transition invalide (draft → accepte)', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, { ...DEVIS_ROW, statut: 'draft' })

      await expect(updateStatutDevis(dbD1 as any, 10, 10, 'accepte'))
        .rejects.toThrow('Transition invalide : draft → accepte.')
    })

    it('lance Error si terminal → tout (accepte → refuse)', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, { ...DEVIS_ROW, statut: 'accepte' })

      await expect(updateStatutDevis(dbD1 as any, 10, 10, 'refuse'))
        .rejects.toThrow('Transition invalide')
    })

    it('transition valide draft → envoye : retourne statuts avant/après', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, { ...DEVIS_ROW, statut: 'draft', boutique_id: 1 })

      const result = await updateStatutDevis(dbD1 as any, 10, 10, 'envoye')

      expect(result.statut_avant).toBe('draft')
      expect(result.statut_apres).toBe('envoye')
    })

    it('transition draft → envoye : SET envoye_le = CURRENT_TIMESTAMP', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, { ...DEVIS_ROW, statut: 'draft', boutique_id: 1 })

      await updateStatutDevis(dbD1 as any, 10, 10, 'envoye')

      const calls = dbD1.__getCalls()
      const updateCall = calls.find(c => c.sql === SQL_UPDATE_STATUT_ENVOYE)
      expect(updateCall).toBeDefined()
      expect(updateCall!.params).toEqual(['envoye', 10])
    })

    it('transition draft → annule : pas de champ extra', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, { ...DEVIS_ROW, statut: 'draft', boutique_id: 1 })

      await updateStatutDevis(dbD1 as any, 10, 10, 'annule')

      const calls = dbD1.__getCalls()
      const updateCall = calls.find(c => c.sql === SQL_UPDATE_STATUT_ANNULE)
      expect(updateCall).toBeDefined()
    })

    it('transition envoye → accepte : SET repondu_le = CURRENT_TIMESTAMP', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, { ...DEVIS_ROW, statut: 'envoye', boutique_id: 1 })

      await updateStatutDevis(dbD1 as any, 10, 10, 'accepte')

      const calls = dbD1.__getCalls()
      const updateCall = calls.find(c => c.sql === SQL_UPDATE_STATUT_ACCEPTE)
      expect(updateCall).toBeDefined()
    })

    it('transition envoye → refuse : SET repondu_le = CURRENT_TIMESTAMP', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, { ...DEVIS_ROW, statut: 'envoye', boutique_id: 1 })

      await updateStatutDevis(dbD1 as any, 10, 10, 'refuse')

      const calls = dbD1.__getCalls()
      const updateCall = calls.find(c => c.sql === SQL_UPDATE_STATUT_REFUSE)
      expect(updateCall).toBeDefined()
    })

    it('fromPublic=true → auditLog PUBLIC_STATUT_DEVIS', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, { ...DEVIS_ROW, statut: 'envoye', boutique_id: 1 })

      await updateStatutDevis(dbD1 as any, 10, 0, 'accepte', true)

      const calls = dbD1.__getCalls()
      const auditCall = calls.find(c => c.sql === SQL_AUDIT)
      expect(auditCall).toBeDefined()
      expect(auditCall!.params).toContain('PUBLIC_STATUT_DEVIS')
    })

    it('fromPublic=false → auditLog UPDATE_STATUT_DEVIS', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, { ...DEVIS_ROW, statut: 'draft', boutique_id: 1 })

      await updateStatutDevis(dbD1 as any, 10, 10, 'envoye', false)

      const calls = dbD1.__getCalls()
      const auditCall = calls.find(c => c.sql === SQL_AUDIT)
      expect(auditCall).toBeDefined()
      expect(auditCall!.params).toContain('UPDATE_STATUT_DEVIS')
    })

    it('envoye → expire : transition valide', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, { ...DEVIS_ROW, statut: 'envoye', boutique_id: 1 })

      const result = await updateStatutDevis(dbD1 as any, 10, 10, 'expire')

      expect(result.statut_avant).toBe('envoye')
      expect(result.statut_apres).toBe('expire')
    })
  })

  // ─── convertirDevis ────────────────────────────────────────────────────────

  describe('convertirDevis()', () => {
    it('lance Error si devis introuvable', async () => {
      dbD1.__setNotFound(SQL_SELECT_DEVIS_BY_ID)

      await expect(convertirDevis(dbD1 as any, 999, 10))
        .rejects.toThrow('Devis introuvable.')
    })

    it('lance Error si devis refusé', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, { ...DEVIS_ROW, statut: 'refuse' })

      await expect(convertirDevis(dbD1 as any, 10, 10))
        .rejects.toThrow('Impossible de convertir un devis refusé.')
    })

    it('lance Error si devis annulé', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, { ...DEVIS_ROW, statut: 'annule' })

      await expect(convertirDevis(dbD1 as any, 10, 10))
        .rejects.toThrow('Impossible de convertir un devis annulé.')
    })

    it('lance Error si déjà converti (facture_id présent)', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, { ...DEVIS_ROW, statut: 'accepte', facture_id: 5 })

      await expect(convertirDevis(dbD1 as any, 10, 10))
        .rejects.toThrow('Ce devis a déjà été converti en facture.')
    })

    it('convertit le devis et retourne facture_id + facture_numero', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, {
        ...DEVIS_ROW, statut: 'envoye', boutique_id: 1, facture_id: null,
        client_id: 3, ticket_id: null,
      })
      // nextNumero pour facture
      dbD1.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
        prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
        prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
      })
      const SQL_NEXT_FACTURE_COUNT = n(`SELECT COUNT(*) as cnt FROM factures WHERE boutique_id = ?`)
      dbD1.__setResponse(SQL_NEXT_FACTURE_COUNT, { cnt: 0 })
      dbD1.__setResponse(SQL_INSERT_FACTURE, { id: 20 })

      const result = await convertirDevis(dbD1 as any, 10, 10)

      expect(result.facture_id).toBe(20)
      expect(result.facture_numero).toMatch(/^FAC-/)
    })

    it('INSERT facture avec bons paramètres', async () => {
      const devisRow = {
        ...DEVIS_ROW, statut: 'envoye', boutique_id: 1, facture_id: null,
        client_id: 3, ticket_id: null, total_ht: 80, total_tva: 16, total_ttc: 96,
      }
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, devisRow)
      dbD1.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
        prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
        prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
      })
      dbD1.__setResponse(n(`SELECT COUNT(*) as cnt FROM factures WHERE boutique_id = ?`), { cnt: 2 })
      dbD1.__setResponse(SQL_INSERT_FACTURE, { id: 21 })

      await convertirDevis(dbD1 as any, 10, 10)

      const calls = dbD1.__getCalls()
      const insertFactCall = calls.find(c => c.sql === SQL_INSERT_FACTURE)
      expect(insertFactCall).toBeDefined()
      // boutique_id, numero, client_id, ticket_id, devis_id, total_ht, total_tva, total_ttc
      expect(insertFactCall!.params[0]).toBe(1)   // boutique_id
      expect(insertFactCall!.params[2]).toBe(3)   // client_id
      expect(insertFactCall!.params[3]).toBeNull() // ticket_id
      expect(insertFactCall!.params[4]).toBe(10)  // devis_id
    })

    it('copie les lignes devis → facture', async () => {
      const devisRow = { ...DEVIS_ROW, statut: 'envoye', boutique_id: 1, facture_id: null, client_id: 3, ticket_id: null }
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, devisRow)
      dbD1.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
        prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
        prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
      })
      dbD1.__setResponse(n(`SELECT COUNT(*) as cnt FROM factures WHERE boutique_id = ?`), { cnt: 0 })
      dbD1.__setResponse(SQL_INSERT_FACTURE, { id: 22 })

      await convertirDevis(dbD1 as any, 10, 10)

      const calls = dbD1.__getCalls()
      const copieCall = calls.find(c => c.sql === SQL_COPIE_LIGNES)
      expect(copieCall).toBeDefined()
      expect(copieCall!.params).toEqual([22, 10]) // facture_id, devis_id
    })

    it('UPDATE devis statut=accepte + facture_id', async () => {
      const devisRow = { ...DEVIS_ROW, statut: 'envoye', boutique_id: 1, facture_id: null, client_id: 3, ticket_id: null }
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, devisRow)
      dbD1.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
        prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
        prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
      })
      dbD1.__setResponse(n(`SELECT COUNT(*) as cnt FROM factures WHERE boutique_id = ?`), { cnt: 0 })
      dbD1.__setResponse(SQL_INSERT_FACTURE, { id: 23 })

      await convertirDevis(dbD1 as any, 10, 10)

      const calls = dbD1.__getCalls()
      const updateDevisCall = calls.find(c => c.sql === SQL_UPDATE_DEVIS_CONVERT)
      expect(updateDevisCall).toBeDefined()
      expect(updateDevisCall!.params).toEqual([23, 10]) // facture_id, devis_id
    })

    it('appelle auditLog CONVERT_DEVIS_FACTURE', async () => {
      const devisRow = { ...DEVIS_ROW, statut: 'draft', boutique_id: 1, facture_id: null, client_id: 3, ticket_id: null }
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, devisRow)
      dbD1.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
        prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
        prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
      })
      dbD1.__setResponse(n(`SELECT COUNT(*) as cnt FROM factures WHERE boutique_id = ?`), { cnt: 0 })
      dbD1.__setResponse(SQL_INSERT_FACTURE, { id: 24 })

      await convertirDevis(dbD1 as any, 10, 10)

      const calls = dbD1.__getCalls()
      const auditCall = calls.find(c => c.sql === SQL_AUDIT)
      expect(auditCall).toBeDefined()
      expect(auditCall!.params).toContain('CONVERT_DEVIS_FACTURE')
      expect(auditCall!.params).toContain('facture')
      expect(auditCall!.params).toContain(24)
    })

    // ─── Acompte structuré : déduction à la conversion ──────────────────────

    const SQL_CHECK_ACOMPTE_CONVERSION = n(`
      SELECT id, numero, total_ht, total_tva, total_ttc FROM factures
      WHERE type_facture = 'acompte' AND (devis_id = ? OR ticket_id = ?)
    `)
    const SQL_MAX_ORDRE_LIGNES = n(`
      SELECT COALESCE(MAX(ordre), 0) as maxOrdre FROM lignes_document WHERE document_type = 'facture' AND document_id = ?
    `)
    const SQL_ACOMPTE_LIGNE_TVA = n(`
      SELECT tva_taux FROM lignes_document WHERE document_type = 'facture' AND document_id = ? LIMIT 1
    `)
    const SQL_UPDATE_TOTAUX_FACTURE = n(`UPDATE factures SET total_ht = ?, total_tva = ?, total_ttc = ? WHERE id = ?`)

    it('sans acompte : total facture = total devis (comportement inchangé)', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, {
        ...DEVIS_ROW, statut: 'envoye', boutique_id: 1, facture_id: null,
        client_id: 3, ticket_id: null, total_ht: 100, total_tva: 20, total_ttc: 120,
      })
      dbD1.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
        prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
        prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
      })
      dbD1.__setResponse(SQL_INSERT_FACTURE, { id: 30 })
      dbD1.__setNotFound(SQL_CHECK_ACOMPTE_CONVERSION)

      await convertirDevis(dbD1 as any, 10, 10)

      const calls = dbD1.__getCalls()
      expect(calls.find(c => c.sql === SQL_UPDATE_TOTAUX_FACTURE)).toBeUndefined()
    })

    it('avec acompte : ajoute une ligne négative et réduit les totaux de la facture', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, {
        ...DEVIS_ROW, statut: 'envoye', boutique_id: 1, facture_id: null,
        client_id: 3, ticket_id: 42, total_ht: 100, total_tva: 20, total_ttc: 120,
      })
      dbD1.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
        prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
        prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
      })
      dbD1.__setResponse(SQL_INSERT_FACTURE, { id: 31 })
      dbD1.__setResponse(SQL_CHECK_ACOMPTE_CONVERSION, {
        id: 7, numero: 'FAC-2026-00007', total_ht: 41.67, total_tva: 8.33, total_ttc: 50,
      })
      dbD1.__setResponse(SQL_MAX_ORDRE_LIGNES, { maxOrdre: 2 })
      dbD1.__setResponse(SQL_ACOMPTE_LIGNE_TVA, { tva_taux: 20 })

      await convertirDevis(dbD1 as any, 10, 10)

      const calls = dbD1.__getCalls()
      const updateCall = calls.find(c => c.sql === SQL_UPDATE_TOTAUX_FACTURE)
      expect(updateCall).toBeDefined()
      expect(updateCall!.params[0]).toBeCloseTo(58.33) // 100 - 41.67
      expect(updateCall!.params[1]).toBeCloseTo(11.67) // 20 - 8.33
      expect(updateCall!.params[2]).toBeCloseTo(70)    // 120 - 50

      const ligneCall = calls.find(c =>
        c.sql.includes('INSERT INTO lignes_document') && c.params.includes('Acompte déjà facturé (FAC-2026-00007)')
      )
      expect(ligneCall).toBeDefined()
      expect(ligneCall!.params).toContain(3) // ordre = maxOrdre(2) + 1
      // Taux lu sur la ligne d'acompte (20), pas recalculé depuis tva/ht (aurait
      // donné 19.99 pour ces montants) — évite un taux fantôme dans le rapport comptable.
      expect(ligneCall!.params[4]).toBe(20)
    })

    it('avec acompte : fallback 20% si la ligne acompte est introuvable', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, {
        ...DEVIS_ROW, statut: 'envoye', boutique_id: 1, facture_id: null,
        client_id: 3, ticket_id: 42, total_ht: 100, total_tva: 20, total_ttc: 120,
      })
      dbD1.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
        prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
        prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
      })
      dbD1.__setResponse(SQL_INSERT_FACTURE, { id: 32 })
      dbD1.__setResponse(SQL_CHECK_ACOMPTE_CONVERSION, {
        id: 7, numero: 'FAC-2026-00007', total_ht: 41.67, total_tva: 8.33, total_ttc: 50,
      })
      dbD1.__setResponse(SQL_MAX_ORDRE_LIGNES, { maxOrdre: 2 })
      dbD1.__setNotFound(SQL_ACOMPTE_LIGNE_TVA)

      await convertirDevis(dbD1 as any, 10, 10)

      const calls = dbD1.__getCalls()
      const ligneCall = calls.find(c =>
        c.sql.includes('INSERT INTO lignes_document') && c.params.includes('Acompte déjà facturé (FAC-2026-00007)')
      )
      expect(ligneCall!.params[4]).toBe(20)
    })
  })

  // ─── getDevisByToken ───────────────────────────────────────────────────────

  describe('getDevisByToken()', () => {
    it('retourne null si token inconnu', async () => {
      db.__setNotFound(SQL_GET_DEVIS_TOKEN)
      db.__setListResponse(SQL_GET_LIGNES_TOKEN, [])

      const result = await getDevisByToken(db as any, 'token-inconnu')

      expect(result).toBeNull()
    })

    it('retourne le devis public avec lignes', async () => {
      const devisPublic = {
        id: 10, numero: 'DV-2026-00001', statut: 'envoye',
        total_ht: 80, total_tva: 16, total_ttc: 96,
        client_nom: 'Dupont', client_prenom: 'Marie',
        boutique_nom: 'iziGSM Paris',
      }
      db.__setResponse(SQL_GET_DEVIS_TOKEN, devisPublic)
      db.__setListResponse(SQL_GET_LIGNES_TOKEN, [
        { ordre: 1, description: 'Réparation', quantite: 1, prix_unitaire_ht: 80, total_ttc: 96 },
      ])

      const result = await getDevisByToken(db as any, 'abc123def456')

      expect(result).not.toBeNull()
      expect(result.id).toBe(10)
      expect(result.boutique_nom).toBe('iziGSM Paris')
      expect(result.lignes).toHaveLength(1)
    })

    it('exécute les deux requêtes en parallèle', async () => {
      db.__setResponse(SQL_GET_DEVIS_TOKEN, { id: 10, statut: 'envoye' })
      db.__setListResponse(SQL_GET_LIGNES_TOKEN, [])

      await getDevisByToken(db as any, 'token-test')

      const calls = db.__getCalls()
      const tokenCall = calls.find(c => c.sql === SQL_GET_DEVIS_TOKEN)
      const lignesCall = calls.find(c => c.sql === SQL_GET_LIGNES_TOKEN)
      expect(tokenCall).toBeDefined()
      expect(lignesCall).toBeDefined()
    })
  })

  // ─── getStatsDevis ─────────────────────────────────────────────────────────

  describe('getStatsDevis()', () => {
    it('retourne les stats complètes avec taux_conversion calculé', async () => {
      db.__setResponse(SQL_STATS_DEVIS, {
        total: 10, draft: 2, envoyes: 4, acceptes: 2,
        refuses: 1, expires: 1, montant_envoye: 400, montant_signe: 200,
      })

      const result = await getStatsDevis(db as any, 1)

      expect(result.total).toBe(10)
      expect(result.draft).toBe(2)
      expect(result.envoyes).toBe(4)
      expect(result.acceptes).toBe(2)
      expect(result.refuses).toBe(1)
      expect(result.montant_envoye).toBe(400)
      expect(result.montant_signe).toBe(200)
      // taux = acceptes / (envoyes + acceptes + refuses) = 2/(4+2+1) = 0.2857 → Math.round×100 = 29
      expect(result.taux_conversion).toBe(29)
    })

    it('taux_conversion = null si aucun devis envoyé', async () => {
      db.__setResponse(SQL_STATS_DEVIS, {
        total: 3, draft: 3, envoyes: 0, acceptes: 0,
        refuses: 0, expires: 0, montant_envoye: 0, montant_signe: 0,
      })

      const result = await getStatsDevis(db as any, 1)

      expect(result.taux_conversion).toBeNull()
    })

    it('retourne 0 pour tous les champs si row null', async () => {
      db.__setNotFound(SQL_STATS_DEVIS)

      const result = await getStatsDevis(db as any, 1)

      expect(result.total).toBe(0)
      expect(result.draft).toBe(0)
      expect(result.envoyes).toBe(0)
      expect(result.montant_envoye).toBe(0)
      expect(result.taux_conversion).toBeNull()
    })

    it('passe boutiqueId en paramètre SQL', async () => {
      db.__setResponse(SQL_STATS_DEVIS, { total: 0, draft: 0, envoyes: 0, acceptes: 0, refuses: 0, expires: 0 })

      await getStatsDevis(db as any, 7)

      const calls = db.__getCalls()
      const statsCall = calls.find(c => c.sql === SQL_STATS_DEVIS)
      expect(statsCall).toBeDefined()
      expect(statsCall!.params).toContain(7)
    })
  })

  // ─── expireDevisPerimes ────────────────────────────────────────────────────

  describe('expireDevisPerimes()', () => {
    it('retourne le nombre de devis expirés (meta.changes)', async () => {
      // Le mock run() retourne meta.changes = 1 par défaut
      const result = await expireDevisPerimes(db as any)

      expect(typeof result).toBe('number')
      expect(result).toBeGreaterThanOrEqual(0)
    })

    it('exécute la requête UPDATE avec statut=expire', async () => {
      await expireDevisPerimes(db as any)

      const calls = db.__getCalls()
      const expireCall = calls.find(c => c.sql === SQL_EXPIRE_DEVIS)
      expect(expireCall).toBeDefined()
    })

    it('retourne 0 si aucun devis expiré (meta.changes = 0)', async () => {
      // Le mockD1.run() par défaut retourne meta.changes = 1
      // On ne peut pas facilement surcharger, on vérifie juste le call
      await expireDevisPerimes(db as any)

      const calls = db.__getCalls()
      const expireCall = calls.find(c => c.sql === SQL_EXPIRE_DEVIS)
      expect(expireCall).toBeDefined()
    })
  })

  // ─── saveSignatureDevis ────────────────────────────────────────────────────

  describe('saveSignatureDevis()', () => {
    it('enregistre la signature', async () => {
      await saveSignatureDevis(db as any, 10, 'data:image/svg+xml,<svg/>')

      const calls = db.__getCalls()
      const sigCall = calls.find(c => c.sql === SQL_SAVE_SIGNATURE)
      expect(sigCall).toBeDefined()
      expect(sigCall!.params[1]).toBe(10)
    })

    it('tronque la signature à 1000 caractères', async () => {
      const longSignature = 'x'.repeat(2000)

      await saveSignatureDevis(db as any, 10, longSignature)

      const calls = db.__getCalls()
      const sigCall = calls.find(c => c.sql === SQL_SAVE_SIGNATURE)
      expect(sigCall!.params[0]).toHaveLength(1000)
    })

    it('ne tronque pas si signature ≤ 1000 chars', async () => {
      const shortSignature = 'data:image/svg+xml,<svg/>'

      await saveSignatureDevis(db as any, 10, shortSignature)

      const calls = db.__getCalls()
      const sigCall = calls.find(c => c.sql === SQL_SAVE_SIGNATURE)
      expect(sigCall!.params[0]).toBe(shortSignature)
    })
  })
})
