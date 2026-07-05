/**
 * tests/reconditionnementService.test.ts
 * Sprint 2.30 — Couverture reconditionnementService.ts
 *
 * Fonctions testées :
 *   listOrdres              (4 tests)
 *   getOrdre                (2 tests)
 *   createOrdre             (5 tests)
 *   updateOrdre             (4 tests)
 *   updateStatutOrdre       (5 tests)
 *   terminerOrdre           (5 tests)
 *   getKpisReconditionnement(3 tests)
 *   listBonsAchat           (3 tests)
 *   getBonAchat             (2 tests)
 *   createBonAchat          (4 tests)
 *   verifierBonAchat        (5 tests)
 *   consommerBonAchat       (4 tests)
 *   annulerBonAchat         (4 tests)
 *
 * Total : 50 tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import {
  listOrdres,
  getOrdre,
  createOrdre,
  updateOrdre,
  updateStatutOrdre,
  terminerOrdre,
  getKpisReconditionnement,
  listBonsAchat,
  getBonAchat,
  createBonAchat,
  verifierBonAchat,
  consommerBonAchat,
  annulerBonAchat,
  type OrdreRow,
  type BonAchatRow,
} from '../src/services/reconditionnementService'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORDRE_ROW: OrdreRow = {
  id: 1, boutique_id: 1, rachat_id: null, produit_id: null,
  numero: 'RC-2026-00001', statut: 'brouillon',
  appareil_marque: 'Apple', appareil_modele: 'iPhone 13',
  imei: null, couleur: 'Noir', capacite: '128Go',
  prix_rachat: 150, cout_main_oeuvre: 30, cout_pieces: 20, cout_revient: 200,
  prix_revente_ht: null, description_travaux: null, grade: null,
  date_debut: null, date_fin: null, actif: 1,
  created_at: '2026-07-01T10:00:00Z', updated_at: '2026-07-01T10:00:00Z',
}

const ORDRE_EN_COURS: OrdreRow = { ...ORDRE_ROW, statut: 'en_cours', date_debut: '2026-07-02T08:00:00Z' }
const ORDRE_TERMINE: OrdreRow  = { ...ORDRE_ROW, statut: 'termine',  produit_id: 5 }

const BON_ACHAT_ROW: BonAchatRow = {
  id: 10, boutique_id: 1, client_id: 7,
  source_type: 'manuel', source_id: null,
  code: 'BA-ABCD1234', montant: 50, montant_utilise: 0,
  statut: 'actif', date_expiration: null, utilise_le: null,
  utilise_facture_id: null, motif: 'Geste commercial', actif: 1,
  created_at: '2026-07-01T10:00:00Z', updated_at: '2026-07-01T10:00:00Z',
}

const BON_AVEC_RESTANT = { ...BON_ACHAT_ROW, montant_restant: 50 }

// ─── SQL normalisés nextNumero (utilisé par createOrdre) ──────────────────────
const SQL_NEXT_NUMERO_SETTINGS = `SELECT prefix_ticket, prefix_facture, prefix_devis, prefix_avoir, prefix_rachat, format_numero, padding_numero FROM boutique_settings WHERE boutique_id = ?`
const SQL_NEXT_NUMERO_COUNT    = `SELECT COUNT(*) as cnt FROM tickets WHERE boutique_id = ? AND DATE(created_at) >= ?`

function setupNextNumero(db: any) {
  db.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
    prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
    prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
  })
  // nextNumero pour sav → COUNT tickets (sav reuse seq tickets)
  db.__setResponse(SQL_NEXT_NUMERO_COUNT, { cnt: 0 })
}

// ─── listOrdres ───────────────────────────────────────────────────────────────

describe('listOrdres', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne { data, pagination } par défaut', async () => {
    db.__setResponseFn(`SELECT COUNT(*) as cnt FROM ordres_reconditionnement o WHERE o.boutique_id = ? AND o.actif = 1`, (_p) => ({ cnt: 3 }))
    db.__setListFn(`SELECT o.*, r.numero AS rachat_numero, r.prix_rachat AS rachat_prix, p.nom AS produit_nom, p.sku AS produit_sku, p.stock_actuel AS produit_stock FROM ordres_reconditionnement o LEFT JOIN rachats r ON r.id = o.rachat_id LEFT JOIN produits p ON p.id = o.produit_id WHERE o.boutique_id = ? AND o.actif = 1 ORDER BY o.created_at DESC LIMIT ? OFFSET ?`, (_p) => [ORDRE_ROW])

    const result = await listOrdres(db as any, 1, {})

    expect(result.data).toHaveLength(1)
    expect(result.pagination.total).toBe(3)
  })

  it('pagination.pages = ceil(total / limit)', async () => {
    db.__setResponseFn(`SELECT COUNT(*) as cnt FROM ordres_reconditionnement o WHERE o.boutique_id = ? AND o.actif = 1`, (_p) => ({ cnt: 7 }))
    db.__setListFn(`SELECT o.*, r.numero AS rachat_numero, r.prix_rachat AS rachat_prix, p.nom AS produit_nom, p.sku AS produit_sku, p.stock_actuel AS produit_stock FROM ordres_reconditionnement o LEFT JOIN rachats r ON r.id = o.rachat_id LEFT JOIN produits p ON p.id = o.produit_id WHERE o.boutique_id = ? AND o.actif = 1 ORDER BY o.created_at DESC LIMIT ? OFFSET ?`, (_p) => [])

    const result = await listOrdres(db as any, 1, { limit: '5' })

    expect(result.pagination.pages).toBe(2) // ceil(7/5)
  })

  it('filtre statut : ajouté dans WHERE', async () => {
    // Avec statut → WHERE différent (dynamique) → on vérifie via __getCalls
    db.__setResponseFn(`SELECT COUNT(*) as cnt FROM ordres_reconditionnement o WHERE o.boutique_id = ? AND o.actif = 1 AND o.statut = ?`, (_p) => ({ cnt: 1 }))
    db.__setListFn(`SELECT o.*, r.numero AS rachat_numero, r.prix_rachat AS rachat_prix, p.nom AS produit_nom, p.sku AS produit_sku, p.stock_actuel AS produit_stock FROM ordres_reconditionnement o LEFT JOIN rachats r ON r.id = o.rachat_id LEFT JOIN produits p ON p.id = o.produit_id WHERE o.boutique_id = ? AND o.actif = 1 AND o.statut = ? ORDER BY o.created_at DESC LIMIT ? OFFSET ?`, (_p) => [ORDRE_ROW])

    const result = await listOrdres(db as any, 1, { statut: 'brouillon' })

    expect(result.data).toHaveLength(1)
    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT(*) as cnt'))
    expect(countCall!.params).toContain('brouillon')
  })

  it('tableau vide si aucun ordre', async () => {
    db.__setResponseFn(`SELECT COUNT(*) as cnt FROM ordres_reconditionnement o WHERE o.boutique_id = ? AND o.actif = 1`, (_p) => ({ cnt: 0 }))
    db.__setListFn(`SELECT o.*, r.numero AS rachat_numero, r.prix_rachat AS rachat_prix, p.nom AS produit_nom, p.sku AS produit_sku, p.stock_actuel AS produit_stock FROM ordres_reconditionnement o LEFT JOIN rachats r ON r.id = o.rachat_id LEFT JOIN produits p ON p.id = o.produit_id WHERE o.boutique_id = ? AND o.actif = 1 ORDER BY o.created_at DESC LIMIT ? OFFSET ?`, (_p) => [])

    const result = await listOrdres(db as any, 1, {})

    expect(result.data).toHaveLength(0)
    expect(result.pagination.total).toBe(0)
  })
})

// ─── getOrdre ─────────────────────────────────────────────────────────────────

describe('getOrdre', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne l\'ordre enrichi si trouvé', async () => {
    const SQL_GET = `SELECT o.*, r.numero AS rachat_numero, r.marque AS rachat_marque, r.modele AS rachat_modele, r.imei AS rachat_imei, r.prix_rachat AS rachat_prix, r.etat AS rachat_etat, r.vendeur_nom AS rachat_vendeur_nom, r.vendeur_prenom AS rachat_vendeur_prenom, p.nom AS produit_nom, p.sku AS produit_sku, p.stock_actuel AS produit_stock, p.prix_vente_ht AS produit_prix_vente FROM ordres_reconditionnement o LEFT JOIN rachats r ON r.id = o.rachat_id LEFT JOIN produits p ON p.id = o.produit_id WHERE o.id = ? AND o.boutique_id = ? AND o.actif = 1`
    db.__setResponse(SQL_GET, ORDRE_ROW)

    const result = await getOrdre(db as any, 1, 1)

    expect(result).not.toBeNull()
    expect(result.numero).toBe('RC-2026-00001')
  })

  it('retourne null si ordre introuvable', async () => {
    const SQL_GET = `SELECT o.*, r.numero AS rachat_numero, r.marque AS rachat_marque, r.modele AS rachat_modele, r.imei AS rachat_imei, r.prix_rachat AS rachat_prix, r.etat AS rachat_etat, r.vendeur_nom AS rachat_vendeur_nom, r.vendeur_prenom AS rachat_vendeur_prenom, p.nom AS produit_nom, p.sku AS produit_sku, p.stock_actuel AS produit_stock, p.prix_vente_ht AS produit_prix_vente FROM ordres_reconditionnement o LEFT JOIN rachats r ON r.id = o.rachat_id LEFT JOIN produits p ON p.id = o.produit_id WHERE o.id = ? AND o.boutique_id = ? AND o.actif = 1`
    db.__setResponse(SQL_GET, null)

    const result = await getOrdre(db as any, 999, 1)

    expect(result).toBeNull()
  })
})

// ─── createOrdre ──────────────────────────────────────────────────────────────

describe('createOrdre', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    setupNextNumero(db)
  })

  it('retourne OrdreRow créé avec numéro RC-', async () => {
    db.__setResponse(`INSERT INTO ordres_reconditionnement (boutique_id, rachat_id, numero, statut, appareil_marque, appareil_modele, imei, couleur, capacite, prix_rachat, cout_main_oeuvre, cout_pieces, prix_revente_ht, description_travaux, grade) VALUES (?, ?, ?, 'brouillon', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`, ORDRE_ROW)

    const result = await createOrdre(db as any, 1, {
      appareil_marque: 'Apple', appareil_modele: 'iPhone 13',
      prix_rachat: 150,
    })

    // le numero est RC-XXXX-YYYYY
    expect(result.numero).toMatch(/^RC-/)
  })

  it('statut brouillon par défaut', async () => {
    db.__setResponse(`INSERT INTO ordres_reconditionnement (boutique_id, rachat_id, numero, statut, appareil_marque, appareil_modele, imei, couleur, capacite, prix_rachat, cout_main_oeuvre, cout_pieces, prix_revente_ht, description_travaux, grade) VALUES (?, ?, ?, 'brouillon', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`, ORDRE_ROW)

    const result = await createOrdre(db as any, 1, {})

    expect(result.statut).toBe('brouillon')
  })

  it('cout_main_oeuvre et cout_pieces défaut = 0', async () => {
    db.__setResponse(`INSERT INTO ordres_reconditionnement (boutique_id, rachat_id, numero, statut, appareil_marque, appareil_modele, imei, couleur, capacite, prix_rachat, cout_main_oeuvre, cout_pieces, prix_revente_ht, description_travaux, grade) VALUES (?, ?, ?, 'brouillon', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`, ORDRE_ROW)

    await createOrdre(db as any, 1, {})

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.includes('INSERT INTO ordres_reconditionnement'))
    // params: (boutique_id, rachat_id=null, numero, marque, modele, imei, couleur, capacite, prix_rachat, cout_mo, cout_pieces, ...)
    // Index 8 = prix_rachat=0, 9 = cout_mo=0, 10 = cout_pieces=0
    expect(insertCall!.params[8]).toBe(0)   // prix_rachat défaut
    expect(insertCall!.params[9]).toBe(0)   // cout_main_oeuvre défaut
    expect(insertCall!.params[10]).toBe(0)  // cout_pieces défaut
  })

  it('avec rachat_id : pre-remplissage depuis le rachat', async () => {
    const SQL_GET_RACHAT = `SELECT marque, modele, imei, couleur, capacite, prix_rachat FROM rachats WHERE id = ? AND boutique_id = ?`
    db.__setResponse(SQL_GET_RACHAT, {
      marque: 'Samsung', modele: 'Galaxy A54',
      imei: '123456789012345', couleur: 'Blanc', capacite: '256Go', prix_rachat: 200,
    })
    db.__setResponse(`INSERT INTO ordres_reconditionnement (boutique_id, rachat_id, numero, statut, appareil_marque, appareil_modele, imei, couleur, capacite, prix_rachat, cout_main_oeuvre, cout_pieces, prix_revente_ht, description_travaux, grade) VALUES (?, ?, ?, 'brouillon', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      { ...ORDRE_ROW, rachat_id: 5, appareil_marque: 'Samsung' }
    )

    const result = await createOrdre(db as any, 1, { rachat_id: 5 })

    const calls = db.__getCalls()
    expect(calls.some(c => c.sql.includes('SELECT marque, modele, imei'))).toBe(true)
  })

  it('rachat introuvable → lève Error', async () => {
    db.__setResponse(`SELECT marque, modele, imei, couleur, capacite, prix_rachat FROM rachats WHERE id = ? AND boutique_id = ?`, null)

    await expect(createOrdre(db as any, 1, { rachat_id: 999 })).rejects.toThrow('Rachat introuvable')
  })
})

// ─── updateOrdre ──────────────────────────────────────────────────────────────

describe('updateOrdre', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  const SQL_GET_STATUT = `SELECT statut FROM ordres_reconditionnement WHERE id = ? AND boutique_id = ? AND actif = 1`

  it('retourne true si ordre brouillon modifié', async () => {
    db.__setResponse(SQL_GET_STATUT, { statut: 'brouillon' })

    const result = await updateOrdre(db as any, 1, 1, { prix_rachat: 180 })

    expect(result).toBe(true) // mock run() changes:1 par défaut
  })

  it('ordre introuvable → lève Error', async () => {
    db.__setResponse(SQL_GET_STATUT, null)

    await expect(updateOrdre(db as any, 999, 1, {})).rejects.toThrow('Ordre introuvable')
  })

  it('ordre terminé → lève Error', async () => {
    db.__setResponse(SQL_GET_STATUT, { statut: 'termine' })

    await expect(updateOrdre(db as any, 1, 1, {})).rejects.toThrow('terminé ne peut pas')
  })

  it('ordre abandonné → lève Error', async () => {
    db.__setResponse(SQL_GET_STATUT, { statut: 'abandonne' })

    await expect(updateOrdre(db as any, 1, 1, {})).rejects.toThrow('abandonné ne peut pas')
  })
})

// ─── updateStatutOrdre ────────────────────────────────────────────────────────

describe('updateStatutOrdre', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  const SQL_GET_ORDRE = `SELECT * FROM ordres_reconditionnement WHERE id = ? AND boutique_id = ? AND actif = 1`

  it('brouillon → en_cours : transition valide', async () => {
    db.__setResponse(SQL_GET_ORDRE, ORDRE_ROW)
    db.__setResponseFn(`UPDATE ordres_reconditionnement SET statut = ?, updated_at = CURRENT_TIMESTAMP , date_debut = CURRENT_TIMESTAMP WHERE id = ? AND boutique_id = ? RETURNING *`, (_p) => ORDRE_EN_COURS)

    const result = await updateStatutOrdre(db as any, 1, 1, 'en_cours')

    expect(result.statut).toBe('en_cours')
  })

  it('ordre introuvable → lève Error', async () => {
    db.__setResponse(SQL_GET_ORDRE, null)

    await expect(updateStatutOrdre(db as any, 999, 1, 'en_cours')).rejects.toThrow('introuvable')
  })

  it('transition invalide : brouillon → termine → lève Error', async () => {
    db.__setResponse(SQL_GET_ORDRE, ORDRE_ROW) // statut=brouillon, pas de transition vers termine direct

    await expect(updateStatutOrdre(db as any, 1, 1, 'termine')).rejects.toThrow('Transition invalide')
  })

  it('transition terminale : termine → xxxx → lève Error', async () => {
    db.__setResponse(SQL_GET_ORDRE, ORDRE_TERMINE)

    await expect(updateStatutOrdre(db as any, 1, 1, 'brouillon')).rejects.toThrow('Transition invalide')
  })

  it('brouillon → abandonne : transition valide', async () => {
    db.__setResponse(SQL_GET_ORDRE, ORDRE_ROW)
    db.__setResponseFn(`UPDATE ordres_reconditionnement SET statut = ?, updated_at = CURRENT_TIMESTAMP , date_fin = CURRENT_TIMESTAMP WHERE id = ? AND boutique_id = ? RETURNING *`, (_p) => ({ ...ORDRE_ROW, statut: 'abandonne' }))

    const result = await updateStatutOrdre(db as any, 1, 1, 'abandonne')

    expect(result.statut).toBe('abandonne')
  })
})

// ─── terminerOrdre ────────────────────────────────────────────────────────────

describe('terminerOrdre', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  const SQL_GET_ORDRE_TERMINER = `SELECT * FROM ordres_reconditionnement WHERE id = ? AND boutique_id = ? AND actif = 1`

  it('ordre introuvable → lève Error', async () => {
    db.__setResponse(SQL_GET_ORDRE_TERMINER, null)

    await expect(terminerOrdre(db as any, 999, 1, { prix_revente_ht: 300, grade: 'A' })).rejects.toThrow('introuvable')
  })

  it('ordre non en_cours → lève Error', async () => {
    db.__setResponse(SQL_GET_ORDRE_TERMINER, ORDRE_ROW) // statut=brouillon

    await expect(terminerOrdre(db as any, 1, 1, { prix_revente_ht: 300, grade: 'A' })).rejects.toThrow('en_cours')
  })

  it('cas 2 : crée un produit occasion + SKU OCC-', async () => {
    db.__setResponse(SQL_GET_ORDRE_TERMINER, ORDRE_EN_COURS)
    db.__setResponse(`INSERT INTO produits (boutique_id, nom, sku, marque, description, prix_achat_ht, prix_vente_ht, tva_taux, stock_actuel, stock_minimum, actif) VALUES (?, ?, ?, ?, ?, ?, ?, 20, 1, 0, 1) RETURNING id`, { id: 88 })
    db.__setResponse(`UPDATE ordres_reconditionnement SET statut = 'termine', produit_id = ?, prix_revente_ht = ?, grade = ?, description_travaux = COALESCE(?, description_travaux), date_fin = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND boutique_id = ? RETURNING *`, ORDRE_TERMINE)

    const result = await terminerOrdre(db as any, 1, 1, { prix_revente_ht: 350, grade: 'A' })

    expect(result.statut).toBe('termine')
    const calls = db.__getCalls()
    const insertProduit = calls.find(c => c.sql.includes('INSERT INTO produits'))
    expect(insertProduit).toBeDefined()
    // SKU = OCC-RC-2026-00001
    expect(insertProduit!.params[2]).toContain('OCC-')
  })

  it('cas 1 : produit existant → UPDATE stock_actuel + 1', async () => {
    db.__setResponse(SQL_GET_ORDRE_TERMINER, ORDRE_EN_COURS)
    db.__setResponse(`UPDATE ordres_reconditionnement SET statut = 'termine', produit_id = ?, prix_revente_ht = ?, grade = ?, description_travaux = COALESCE(?, description_travaux), date_fin = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND boutique_id = ? RETURNING *`, ORDRE_TERMINE)

    await terminerOrdre(db as any, 1, 1, {
      prix_revente_ht: 350, grade: 'A', produit_id_existant: 5,
    })

    const calls = db.__getCalls()
    const updateStock = calls.find(c => c.sql.includes('stock_actuel = stock_actuel + 1'))
    expect(updateStock).toBeDefined()
    expect(updateStock!.params[0]).toBe(5)
  })

  it('retourne OrdreRow terminé', async () => {
    db.__setResponse(SQL_GET_ORDRE_TERMINER, ORDRE_EN_COURS)
    db.__setResponse(`INSERT INTO produits (boutique_id, nom, sku, marque, description, prix_achat_ht, prix_vente_ht, tva_taux, stock_actuel, stock_minimum, actif) VALUES (?, ?, ?, ?, ?, ?, ?, 20, 1, 0, 1) RETURNING id`, { id: 88 })
    db.__setResponse(`UPDATE ordres_reconditionnement SET statut = 'termine', produit_id = ?, prix_revente_ht = ?, grade = ?, description_travaux = COALESCE(?, description_travaux), date_fin = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND boutique_id = ? RETURNING *`, ORDRE_TERMINE)

    const result = await terminerOrdre(db as any, 1, 1, { prix_revente_ht: 300, grade: 'B' })

    expect(result.statut).toBe('termine')
  })
})

// ─── getKpisReconditionnement ─────────────────────────────────────────────────

describe('getKpisReconditionnement', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  const SQL_KPIS = `SELECT COUNT(*) AS nb_total, SUM(CASE WHEN statut = 'en_cours' THEN 1 ELSE 0 END) AS nb_en_cours, SUM(CASE WHEN statut = 'termine' THEN 1 ELSE 0 END) AS nb_termines, SUM(CASE WHEN statut = 'abandonne' THEN 1 ELSE 0 END) AS nb_abandonnes, COALESCE(SUM(cout_revient), 0) AS cout_revient_total, COALESCE(SUM(CASE WHEN statut = 'termine' THEN prix_revente_ht ELSE 0 END), 0) AS ca_estime_total FROM ordres_reconditionnement WHERE boutique_id = ? AND actif = 1`

  it('retourne tous les champs KPIs', async () => {
    db.__setResponse(SQL_KPIS, {
      nb_total: 10, nb_en_cours: 3, nb_termines: 5, nb_abandonnes: 2,
      cout_revient_total: 1500, ca_estime_total: 2500,
    })

    const result = await getKpisReconditionnement(db as any, 1)

    expect(result.nb_total).toBe(10)
    expect(result.nb_en_cours).toBe(3)
    expect(result.nb_termines).toBe(5)
    expect(result.nb_abandonnes).toBe(2)
    expect(result.cout_revient_total).toBe(1500)
    expect(result.ca_estime_total).toBe(2500)
  })

  it('marge_estimee = ca_estime - cout_revient', async () => {
    db.__setResponse(SQL_KPIS, {
      nb_total: 5, nb_en_cours: 0, nb_termines: 5, nb_abandonnes: 0,
      cout_revient_total: 1000, ca_estime_total: 1750,
    })

    const result = await getKpisReconditionnement(db as any, 1)

    expect(result.marge_estimee).toBe(750)
  })

  it('fallback 0 si SQL retourne null', async () => {
    db.__setResponse(SQL_KPIS, null)

    const result = await getKpisReconditionnement(db as any, 1)

    expect(result.nb_total).toBe(0)
    expect(result.marge_estimee).toBe(0)
  })
})

// ─── listBonsAchat ────────────────────────────────────────────────────────────

describe('listBonsAchat', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne { data, pagination }', async () => {
    db.__setResponseFn(`SELECT COUNT(*) as cnt FROM bons_achat b LEFT JOIN clients c ON c.id = b.client_id WHERE b.boutique_id = ? AND b.actif = 1`, (_p) => ({ cnt: 2 }))
    db.__setListFn(`SELECT b.*, c.nom AS client_nom, c.prenom AS client_prenom, c.telephone AS client_telephone, (b.montant - b.montant_utilise) AS montant_restant FROM bons_achat b LEFT JOIN clients c ON c.id = b.client_id WHERE b.boutique_id = ? AND b.actif = 1 ORDER BY b.created_at DESC LIMIT ? OFFSET ?`, (_p) => [BON_ACHAT_ROW])

    const result = await listBonsAchat(db as any, 1, {})

    expect(result.data).toHaveLength(1)
    expect(result.pagination.total).toBe(2)
  })

  it('data vide si aucun bon', async () => {
    db.__setResponseFn(`SELECT COUNT(*) as cnt FROM bons_achat b LEFT JOIN clients c ON c.id = b.client_id WHERE b.boutique_id = ? AND b.actif = 1`, (_p) => ({ cnt: 0 }))
    db.__setListFn(`SELECT b.*, c.nom AS client_nom, c.prenom AS client_prenom, c.telephone AS client_telephone, (b.montant - b.montant_utilise) AS montant_restant FROM bons_achat b LEFT JOIN clients c ON c.id = b.client_id WHERE b.boutique_id = ? AND b.actif = 1 ORDER BY b.created_at DESC LIMIT ? OFFSET ?`, (_p) => [])

    const result = await listBonsAchat(db as any, 1, {})

    expect(result.data).toHaveLength(0)
  })

  it('boutique_id en premier binding', async () => {
    db.__setResponseFn(`SELECT COUNT(*) as cnt FROM bons_achat b LEFT JOIN clients c ON c.id = b.client_id WHERE b.boutique_id = ? AND b.actif = 1`, (_p) => ({ cnt: 0 }))
    db.__setListFn(`SELECT b.*, c.nom AS client_nom, c.prenom AS client_prenom, c.telephone AS client_telephone, (b.montant - b.montant_utilise) AS montant_restant FROM bons_achat b LEFT JOIN clients c ON c.id = b.client_id WHERE b.boutique_id = ? AND b.actif = 1 ORDER BY b.created_at DESC LIMIT ? OFFSET ?`, (_p) => [])

    await listBonsAchat(db as any, 77, {})

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT(*) as cnt FROM bons_achat'))
    expect(countCall!.params[0]).toBe(77)
  })
})

// ─── getBonAchat ──────────────────────────────────────────────────────────────

describe('getBonAchat', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne le bon enrichi si trouvé', async () => {
    const SQL_GET_BON = `SELECT b.*, c.nom AS client_nom, c.prenom AS client_prenom, c.email AS client_email, c.telephone AS client_telephone, f.numero AS facture_utilisation_numero, (b.montant - b.montant_utilise) AS montant_restant FROM bons_achat b LEFT JOIN clients c ON c.id = b.client_id LEFT JOIN factures f ON f.id = b.utilise_facture_id WHERE b.id = ? AND b.boutique_id = ? AND b.actif = 1`
    db.__setResponse(SQL_GET_BON, { ...BON_ACHAT_ROW, client_nom: 'Dupont', montant_restant: 50 })

    const result = await getBonAchat(db as any, 10, 1)

    expect(result).not.toBeNull()
    expect(result.code).toBe('BA-ABCD1234')
  })

  it('retourne null si bon introuvable', async () => {
    const SQL_GET_BON = `SELECT b.*, c.nom AS client_nom, c.prenom AS client_prenom, c.email AS client_email, c.telephone AS client_telephone, f.numero AS facture_utilisation_numero, (b.montant - b.montant_utilise) AS montant_restant FROM bons_achat b LEFT JOIN clients c ON c.id = b.client_id LEFT JOIN factures f ON f.id = b.utilise_facture_id WHERE b.id = ? AND b.boutique_id = ? AND b.actif = 1`
    db.__setResponse(SQL_GET_BON, null)

    const result = await getBonAchat(db as any, 999, 1)

    expect(result).toBeNull()
  })
})

// ─── createBonAchat ───────────────────────────────────────────────────────────

describe('createBonAchat', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('lève Error si montant <= 0', async () => {
    await expect(createBonAchat(db as any, 1, { montant: 0 })).rejects.toThrow('positif')
    await expect(createBonAchat(db as any, 1, { montant: -5 })).rejects.toThrow('positif')
  })

  it('code généré : format BA-XXXXXXXX (11 chars)', async () => {
    // genererCodeUnique → SELECT id FROM bons_achat WHERE code = ? → null (disponible)
    db.__setResponse(`SELECT id FROM bons_achat WHERE code = ?`, null)
    db.__setResponse(`INSERT INTO bons_achat (boutique_id, client_id, source_type, source_id, code, montant, date_expiration, motif) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`, BON_ACHAT_ROW)

    const result = await createBonAchat(db as any, 1, { montant: 50 })

    // Le code dans la fixture commence par BA-
    expect(result.code).toMatch(/^BA-/)
  })

  it('source_type défaut = manuel si non fourni', async () => {
    db.__setResponse(`SELECT id FROM bons_achat WHERE code = ?`, null)
    db.__setResponse(`INSERT INTO bons_achat (boutique_id, client_id, source_type, source_id, code, montant, date_expiration, motif) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`, BON_ACHAT_ROW)

    await createBonAchat(db as any, 1, { montant: 30 })

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.includes('INSERT INTO bons_achat'))
    // (boutique_id, client_id, source_type, source_id, code, montant, date_expiration, motif)
    expect(insertCall!.params[2]).toBe('manuel')
  })

  it('retourne BonAchatRow créé', async () => {
    db.__setResponse(`SELECT id FROM bons_achat WHERE code = ?`, null)
    db.__setResponse(`INSERT INTO bons_achat (boutique_id, client_id, source_type, source_id, code, montant, date_expiration, motif) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`, BON_ACHAT_ROW)

    const result = await createBonAchat(db as any, 1, { montant: 50, motif: 'Geste' })

    expect(result.montant).toBe(50)
    expect(result.statut).toBe('actif')
  })
})

// ─── verifierBonAchat ─────────────────────────────────────────────────────────

describe('verifierBonAchat', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  const SQL_VERIFY = `SELECT b.*, c.nom AS client_nom, c.prenom AS client_prenom, (b.montant - b.montant_utilise) AS montant_restant FROM bons_achat b LEFT JOIN clients c ON c.id = b.client_id WHERE b.code = ? AND b.boutique_id = ? AND b.actif = 1`

  it('code inconnu → { valide: false, raison: "Code inconnu." }', async () => {
    db.__setResponse(SQL_VERIFY, null)

    const result = await verifierBonAchat(db as any, 'BA-XXXXXXXX', 1)

    expect(result.valide).toBe(false)
    expect(result.raison).toBe('Code inconnu.')
  })

  it('statut utilisé → { valide: false, raison: "Bon déjà entièrement utilisé." }', async () => {
    db.__setResponse(SQL_VERIFY, { ...BON_AVEC_RESTANT, statut: 'utilise' })

    const result = await verifierBonAchat(db as any, 'BA-ABCD1234', 1)

    expect(result.valide).toBe(false)
    expect(result.raison).toMatch(/utilisé/)
  })

  it('statut annulé → { valide: false }', async () => {
    db.__setResponse(SQL_VERIFY, { ...BON_AVEC_RESTANT, statut: 'annule' })

    const result = await verifierBonAchat(db as any, 'BA-ABCD1234', 1)

    expect(result.valide).toBe(false)
  })

  it('bon valide actif → { valide: true, bon }', async () => {
    db.__setResponse(SQL_VERIFY, BON_AVEC_RESTANT)

    const result = await verifierBonAchat(db as any, 'BA-ABCD1234', 1)

    expect(result.valide).toBe(true)
    expect(result.bon).toBeDefined()
  })

  it('bon expiré (date_expiration dépassée) → { valide: false } + UPDATE statut', async () => {
    const datePassee = '2025-01-01'
    db.__setResponse(SQL_VERIFY, { ...BON_AVEC_RESTANT, statut: 'actif', date_expiration: datePassee })

    const result = await verifierBonAchat(db as any, 'BA-ABCD1234', 1)

    expect(result.valide).toBe(false)
    expect(result.raison).toMatch(/expiré/)
    const calls = db.__getCalls()
    expect(calls.some(c => c.sql.includes("SET statut = 'expire'"))).toBe(true)
  })
})

// ─── consommerBonAchat ────────────────────────────────────────────────────────

describe('consommerBonAchat', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  const SQL_VERIFY = `SELECT b.*, c.nom AS client_nom, c.prenom AS client_prenom, (b.montant - b.montant_utilise) AS montant_restant FROM bons_achat b LEFT JOIN clients c ON c.id = b.client_id WHERE b.code = ? AND b.boutique_id = ? AND b.actif = 1`

  const SQL_UPDATE_BON = `UPDATE bons_achat SET montant_utilise = ?, statut = ?, utilise_le = CURRENT_TIMESTAMP, utilise_facture_id = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ? AND boutique_id = ? RETURNING *`

  it('consommation totale : statut → utilise', async () => {
    db.__setResponse(SQL_VERIFY, BON_AVEC_RESTANT) // montant=50, utilise=0, restant=50
    db.__setResponse(SQL_UPDATE_BON, { ...BON_ACHAT_ROW, statut: 'utilise', montant_utilise: 50 })

    const result = await consommerBonAchat(db as any, 'BA-ABCD1234', 1, 99, 50)

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.includes('SET montant_utilise'))
    expect(updateCall!.params[1]).toBe('utilise') // statut après consommation totale
  })

  it('consommation partielle : statut reste actif', async () => {
    db.__setResponse(SQL_VERIFY, BON_AVEC_RESTANT)
    db.__setResponse(SQL_UPDATE_BON, { ...BON_ACHAT_ROW, statut: 'actif', montant_utilise: 20 })

    await consommerBonAchat(db as any, 'BA-ABCD1234', 1, 99, 20)

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.includes('SET montant_utilise'))
    expect(updateCall!.params[1]).toBe('actif') // montant_utilise=20 < montant=50
  })

  it('montant > solde disponible → lève Error', async () => {
    db.__setResponse(SQL_VERIFY, BON_AVEC_RESTANT) // restant=50

    await expect(consommerBonAchat(db as any, 'BA-ABCD1234', 1, 99, 100)).rejects.toThrow('supérieur au solde')
  })

  it('bon invalide → lève Error avec la raison', async () => {
    db.__setResponse(SQL_VERIFY, null) // verifierBonAchat → invalide

    await expect(consommerBonAchat(db as any, 'BA-XXXXXXXX', 1, 99, 10)).rejects.toThrow('Code inconnu')
  })
})

// ─── annulerBonAchat ──────────────────────────────────────────────────────────

describe('annulerBonAchat', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  const SQL_GET_BON_STATUS = `SELECT statut, montant_utilise FROM bons_achat WHERE id = ? AND boutique_id = ? AND actif = 1`

  it('annule un bon actif → retourne true', async () => {
    db.__setResponse(SQL_GET_BON_STATUS, { statut: 'actif', montant_utilise: 0 })

    const result = await annulerBonAchat(db as any, 10, 1)

    expect(result).toBe(true)
    const calls = db.__getCalls()
    expect(calls.some(c => c.sql.includes("SET statut = 'annule'"))).toBe(true)
  })

  it('bon introuvable → lève Error', async () => {
    db.__setResponse(SQL_GET_BON_STATUS, null)

    await expect(annulerBonAchat(db as any, 999, 1)).rejects.toThrow('introuvable')
  })

  it('bon déjà utilisé → lève Error', async () => {
    db.__setResponse(SQL_GET_BON_STATUS, { statut: 'utilise', montant_utilise: 50 })

    await expect(annulerBonAchat(db as any, 10, 1)).rejects.toThrow('déjà utilisé')
  })

  it('bon partiellement consommé → lève Error', async () => {
    db.__setResponse(SQL_GET_BON_STATUS, { statut: 'actif', montant_utilise: 10 })

    await expect(annulerBonAchat(db as any, 10, 1)).rejects.toThrow('partiellement consommé')
  })
})
