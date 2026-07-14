/**
 * @file tests/stockService.test.ts
 * @description Tests unitaires — src/services/stockService.ts
 * Sprint 2.29 — couverture initiale
 * Sprint 2.41-C — +10 tests importCatalogueCsv (E07/E08)
 *
 * Couverture :
 *   - listProduits()          — pagination, filtres categorie_id/stock_bas/search, alerte_stock [Database]
 *   - getProduitById()        — null si absent, fiche + mouvements [Database]
 *   - createProduit()         — INSERT + mouvement initial si stock>0, pas de mouvement si stock=0, auditLog [D1Database]
 *   - updateProduit()         — Error si introuvable, UPDATE COALESCE, auditLog [D1Database]
 *   - deleteProduit()         — soft delete actif=0, auditLog [D1Database]
 *   - enregistrerMouvement()  — type invalide, quantite=0, produit introuvable, [Database]
 *                               entree +delta, sortie -delta, ajustement=valeur absolue,
 *                               inventaire=valeur absolue, stock insuffisant, mouvQuantite delta effectif
 *   - listCategories()        — résultats avec nb_produits, ORDER racines first [Database]
 *   - createCategorie()       — id retourné, parent_id null par défaut [Database]
 *   - getKpisStock()          — 5 champs, fallback 0 si null [Database]
 *   - importCatalogueCsv()    — CSV vide, col nom absente, INSERT nouveau SKU, [D1Database]
 *                               UPDATE SKU existant, famille invalide → 'piece',
 *                               skip ligne sans nom, séparateur point-virgule,
 *                               mouvement entree si stock > 0, dédup SKU inconnu,
 *                               résultat { imported, updated, skipped, errors }
 *
 * Migration Ports & Adapters (2026-07-14) : listProduits/getProduitById/enregistrerMouvement/
 * listCategories/createCategorie/getKpisStock migrées vers le port Database (mockDatabase).
 * createProduit/updateProduit/deleteProduit/importCatalogueCsv restent sur D1Database (mockD1)
 * — dépendent d'auditLog(), non porté.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import { createMockDatabase } from './helpers/mockDatabase'
import {
  listProduits,
  getProduitById,
  createProduit,
  updateProduit,
  deleteProduit,
  enregistrerMouvement,
  listCategories,
  createCategorie,
  getKpisStock,
  importCatalogueCsv,
  type ProduitRow,
  type KpisStock,
} from '../src/services/stockService'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PRODUIT_ROW: ProduitRow = {
  id: 5,
  boutique_id: 1,
  categorie_id: 2,
  sku: 'ECR-IP14-001',
  nom: 'Écran iPhone 14',
  marque: 'Apple',
  description: null,
  prix_achat_ht: 50.00,
  prix_achat_cump: 50.00,
  prix_vente_ht: 90.00,
  tva_taux: 20,
  stock_actuel: 10,
  stock_minimum: 3,
  fournisseur: 'Apple Dist',
  reference_fournisseur: 'ECRAN-IP14',
  code_barre: '1234567890123',
  actif: 1,
  created_at: '2026-01-01T10:00:00',
  updated_at: '2026-01-01T10:00:00',
}

const PRODUIT_ENRICHI = {
  ...PRODUIT_ROW,
  categorie_nom: 'Écrans',
  marge_pct: 44.4,
}

const CATEGORIE_ROW = {
  id: 2,
  boutique_id: 1,
  nom: 'Écrans',
  parent_id: null,
  actif: 1,
  nb_produits: 5,
}

const KPIS_ROW: KpisStock = {
  nb_produits: 42,
  nb_ruptures: 3,
  nb_alertes: 7,
  valeur_stock_ht: 2150.50,
  valeur_stock_cump: 2200.00,
}

// ─── Helpers SQL normalisés ────────────────────────────────────────────────────

// Normalisation : trim + collapse whitespace (identique à mockD1)
function n(sql: string) {
  return sql.replace(/\s+/g, ' ').trim()
}

// SQL COUNT pour listProduits (sans filtres)
const SQL_COUNT_BASE = n(`SELECT COUNT(*) AS cnt FROM produits p WHERE p.boutique_id = ? AND p.actif = 1`)

// SQL SELECT principal listProduits
const SQL_SELECT_BASE = n(`
  SELECT p.*,
         c.nom AS categorie_nom,
         ROUND((p.prix_vente_ht - p.prix_achat_ht) / NULLIF(p.prix_vente_ht, 0) * 100, 1) AS marge_pct,
         CASE
           WHEN p.stock_actuel = 0               THEN 'rupture'
           WHEN p.stock_actuel <= p.stock_minimum THEN 'bas'
           ELSE 'ok'
         END AS alerte_stock
  FROM   produits p
  LEFT JOIN categories c ON c.id = p.categorie_id
  WHERE p.boutique_id = ? AND p.actif = 1
  ORDER  BY p.nom ASC
  LIMIT ? OFFSET ?
`)

// SQL getProduitById
const SQL_GET_PRODUIT = n(`
  SELECT p.*,
         c.nom AS categorie_nom,
         ROUND((p.prix_vente_ht - p.prix_achat_ht) / NULLIF(p.prix_vente_ht, 0) * 100, 1) AS marge_pct
  FROM   produits p
  LEFT JOIN categories c ON c.id = p.categorie_id
  WHERE  p.id = ? AND p.actif = 1
`)

const SQL_GET_MOUVEMENTS = n(`
  SELECT m.*, u.prenom || ' ' || u.nom AS user_nom
  FROM   mouvements_stock m
  LEFT JOIN users u ON u.id = m.user_id
  WHERE  m.produit_id = ?
  ORDER  BY m.created_at DESC
  LIMIT  20
`)

// SQL guard updateProduit / enregistrerMouvement
const SQL_CHECK_PRODUIT_ACTIF = n(`SELECT id FROM produits WHERE id = ? AND actif = 1`)

const SQL_CHECK_PRODUIT_STOCK = n(`SELECT id, stock_actuel, boutique_id FROM produits WHERE id = ? AND actif = 1`)

// SQL INSERT produit
const SQL_INSERT_PRODUIT = n(`
  INSERT INTO produits
    (boutique_id, categorie_id, sku, nom, marque, famille, prix_achat_ht, prix_vente_ht, tva_taux,
     stock_actuel, stock_minimum, fournisseur, reference_fournisseur, code_barre)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING id
`)

// SQL mouvement initial
const SQL_INSERT_MOUVEMENT_INITIAL = n(`
  INSERT INTO mouvements_stock
    (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, user_id, motif)
  VALUES (?, ?, 'entree', ?, 0, ?, ?, 'Stock initial')
`)

// SQL UPDATE produit (COALESCE)
const SQL_UPDATE_PRODUIT = n(`
  UPDATE produits SET
    nom          = COALESCE(?, nom),
    sku          = COALESCE(?, sku),
    marque       = COALESCE(?, marque),
    categorie_id = COALESCE(?, categorie_id),
    famille      = COALESCE(?, famille),
    prix_achat_ht= COALESCE(?, prix_achat_ht),
    prix_vente_ht= COALESCE(?, prix_vente_ht),
    tva_taux     = COALESCE(?, tva_taux),
    stock_minimum= COALESCE(?, stock_minimum),
    fournisseur  = COALESCE(?, fournisseur),
    code_barre   = COALESCE(?, code_barre),
    updated_at   = CURRENT_TIMESTAMP
  WHERE id = ?
`)

// SQL soft delete
const SQL_SOFT_DELETE = n(`UPDATE produits SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)

// SQL UPDATE stock (enregistrerMouvement)
const SQL_UPDATE_STOCK = n(`UPDATE produits SET stock_actuel = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)

// SQL INSERT mouvement
const SQL_INSERT_MOUVEMENT = n(`
  INSERT INTO mouvements_stock
    (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, ticket_id, user_id, motif)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

// SQL listCategories
const SQL_LIST_CATEGORIES = n(`
  SELECT c.*, COUNT(p.id) AS nb_produits
  FROM   categories c
  LEFT JOIN produits p ON p.categorie_id = c.id AND p.actif = 1
  WHERE  c.boutique_id = ? AND c.actif = 1
  GROUP  BY c.id
  ORDER  BY c.parent_id NULLS FIRST, c.nom
`)

// SQL createCategorie
const SQL_INSERT_CATEGORIE = n(`INSERT INTO categories (boutique_id, nom, parent_id) VALUES (?, ?, ?) RETURNING id`)

// SQL getKpisStock
const SQL_KPIS_STOCK = n(`
  SELECT
    COUNT(*)                                                         AS nb_produits,
    SUM(CASE WHEN stock_actuel = 0 THEN 1 ELSE 0 END)               AS nb_ruptures,
    SUM(CASE WHEN stock_actuel > 0
             AND stock_actuel <= stock_minimum THEN 1 ELSE 0 END)   AS nb_alertes,
    ROUND(SUM(stock_actuel * prix_achat_ht), 2)                     AS valeur_stock_ht,
    ROUND(SUM(stock_actuel * prix_achat_cump), 2)                   AS valeur_stock_cump
  FROM produits
  WHERE boutique_id = ? AND actif = 1
`)

// SQL auditLog (table = audit_logs, colonnes réelles dans lib/db.ts)
const SQL_AUDIT = n(`
  INSERT INTO audit_logs (boutique_id, user_id, action, entite_type, entite_id, donnees_avant, donnees_apres, ip_address)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)

// ─── SQL importCatalogueCsv ───────────────────────────────────────────────────

const SQL_IMPORT_SELECT_SKU = n(
  `SELECT id, stock_actuel FROM produits WHERE boutique_id = ? AND sku = ? AND actif = 1 LIMIT 1`
)

const SQL_IMPORT_UPDATE_PRODUIT = n(`
  UPDATE produits SET
    nom           = ?,
    famille       = ?,
    prix_achat_ht = ?,
    prix_vente_ht = ?,
    tva_taux      = ?,
    marque        = COALESCE(?, marque),
    fournisseur   = COALESCE(?, fournisseur),
    updated_at    = CURRENT_TIMESTAMP
  WHERE id = ?
`)

const SQL_IMPORT_INSERT_PRODUIT = n(`
  INSERT INTO produits
    (boutique_id, sku, nom, marque, famille, prix_achat_ht, prix_vente_ht,
     tva_taux, stock_actuel, stock_minimum, fournisseur)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 5, ?)
  RETURNING id
`)

const SQL_IMPORT_MOUVEMENT_ENTREE = n(`
  INSERT INTO mouvements_stock
    (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, user_id, motif)
  VALUES (?, ?, 'entree', ?, 0, ?, ?, 'Import catalogue CSV')
`)

const SQL_IMPORT_MOUVEMENT_INVENTAIRE = n(`
  INSERT INTO mouvements_stock
    (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, user_id, motif)
  VALUES (?, ?, 'inventaire', ?, ?, ?, ?, 'Import catalogue CSV')
`)

const SQL_IMPORT_UPDATE_STOCK = n(
  `UPDATE produits SET stock_actuel = ? WHERE id = ?`
)

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('stockService', () => {
  let db:   ReturnType<typeof createMockDatabase>
  let dbD1: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db   = createMockDatabase()
    dbD1 = createMockD1()
  })

  // ─── listProduits ──────────────────────────────────────────────────────────

  describe('listProduits()', () => {
    it('retourne une liste vide si aucun produit', async () => {
      db.__setResponse(SQL_COUNT_BASE, { cnt: 0 })
      db.__setListResponse(SQL_SELECT_BASE, [])

      const result = await listProduits(db as any, 1)

      expect(result.data).toEqual([])
      expect(result.pagination.total).toBe(0)
      expect(result.pagination.pages).toBe(0)
    })

    it('retourne les produits avec pagination par défaut (page=1, limit=20)', async () => {
      db.__setResponse(SQL_COUNT_BASE, { cnt: 2 })
      db.__setListResponse(SQL_SELECT_BASE, [PRODUIT_ENRICHI, { ...PRODUIT_ENRICHI, id: 6, nom: 'Batterie iPhone 14' }])

      const result = await listProduits(db as any, 1)

      expect(result.data).toHaveLength(2)
      expect(result.pagination.page).toBe(1)
      expect(result.pagination.limit).toBe(20)
      expect(result.pagination.total).toBe(2)
      expect(result.pagination.pages).toBe(1)
    })

    it('pagination personnalisée : page=2, limit=5', async () => {
      const sqlCountP = n(`SELECT COUNT(*) AS cnt FROM produits p WHERE p.boutique_id = ? AND p.actif = 1`)
      db.__setResponse(sqlCountP, { cnt: 12 })
      db.__setListResponse(n(`
        SELECT p.*,
               c.nom AS categorie_nom,
               ROUND((p.prix_vente_ht - p.prix_achat_ht) / NULLIF(p.prix_vente_ht, 0) * 100, 1) AS marge_pct,
               CASE
                 WHEN p.stock_actuel = 0               THEN 'rupture'
                 WHEN p.stock_actuel <= p.stock_minimum THEN 'bas'
                 ELSE 'ok'
               END AS alerte_stock
        FROM   produits p
        LEFT JOIN categories c ON c.id = p.categorie_id
        WHERE p.boutique_id = ? AND p.actif = 1
        ORDER  BY p.nom ASC
        LIMIT ? OFFSET ?
      `), [PRODUIT_ENRICHI])

      const result = await listProduits(db as any, 1, { page: 2, limit: 5 })

      expect(result.pagination.page).toBe(2)
      expect(result.pagination.limit).toBe(5)
      expect(result.pagination.total).toBe(12)
      expect(result.pagination.pages).toBe(3)
    })

    it('filtre par categorie_id', async () => {
      const sqlCountCat = n(`SELECT COUNT(*) AS cnt FROM produits p WHERE p.boutique_id = ? AND p.actif = 1 AND p.categorie_id = ?`)
      db.__setResponse(sqlCountCat, { cnt: 1 })

      const sqlSelectCat = n(`
        SELECT p.*,
               c.nom AS categorie_nom,
               ROUND((p.prix_vente_ht - p.prix_achat_ht) / NULLIF(p.prix_vente_ht, 0) * 100, 1) AS marge_pct,
               CASE
                 WHEN p.stock_actuel = 0               THEN 'rupture'
                 WHEN p.stock_actuel <= p.stock_minimum THEN 'bas'
                 ELSE 'ok'
               END AS alerte_stock
        FROM   produits p
        LEFT JOIN categories c ON c.id = p.categorie_id
        WHERE p.boutique_id = ? AND p.actif = 1 AND p.categorie_id = ?
        ORDER  BY p.nom ASC
        LIMIT ? OFFSET ?
      `)
      db.__setListResponse(sqlSelectCat, [PRODUIT_ENRICHI])

      const result = await listProduits(db as any, 1, { categorie_id: 2 })

      expect(result.data).toHaveLength(1)
      expect(result.pagination.total).toBe(1)
    })

    it('filtre stock_bas : ajoute condition stock_actuel <= stock_minimum', async () => {
      const sqlCountBas = n(`SELECT COUNT(*) AS cnt FROM produits p WHERE p.boutique_id = ? AND p.actif = 1 AND p.stock_actuel <= p.stock_minimum`)
      db.__setResponse(sqlCountBas, { cnt: 3 })

      const sqlSelectBas = n(`
        SELECT p.*,
               c.nom AS categorie_nom,
               ROUND((p.prix_vente_ht - p.prix_achat_ht) / NULLIF(p.prix_vente_ht, 0) * 100, 1) AS marge_pct,
               CASE
                 WHEN p.stock_actuel = 0               THEN 'rupture'
                 WHEN p.stock_actuel <= p.stock_minimum THEN 'bas'
                 ELSE 'ok'
               END AS alerte_stock
        FROM   produits p
        LEFT JOIN categories c ON c.id = p.categorie_id
        WHERE p.boutique_id = ? AND p.actif = 1 AND p.stock_actuel <= p.stock_minimum
        ORDER  BY p.nom ASC
        LIMIT ? OFFSET ?
      `)
      db.__setListResponse(sqlSelectBas, [
        { ...PRODUIT_ENRICHI, stock_actuel: 2, alerte_stock: 'bas' },
        { ...PRODUIT_ENRICHI, id: 6, stock_actuel: 0, alerte_stock: 'rupture' },
        { ...PRODUIT_ENRICHI, id: 7, stock_actuel: 1, alerte_stock: 'bas' },
      ])

      const result = await listProduits(db as any, 1, { stock_bas: true })

      expect(result.data).toHaveLength(3)
      expect(result.pagination.total).toBe(3)
    })

    it('filtre search : LIKE sur nom/sku/marque', async () => {
      const sqlCountSearch = n(`SELECT COUNT(*) AS cnt FROM produits p WHERE p.boutique_id = ? AND p.actif = 1 AND (p.nom LIKE ? OR p.sku LIKE ? OR p.marque LIKE ?)`)
      db.__setResponse(sqlCountSearch, { cnt: 1 })

      const sqlSelectSearch = n(`
        SELECT p.*,
               c.nom AS categorie_nom,
               ROUND((p.prix_vente_ht - p.prix_achat_ht) / NULLIF(p.prix_vente_ht, 0) * 100, 1) AS marge_pct,
               CASE
                 WHEN p.stock_actuel = 0               THEN 'rupture'
                 WHEN p.stock_actuel <= p.stock_minimum THEN 'bas'
                 ELSE 'ok'
               END AS alerte_stock
        FROM   produits p
        LEFT JOIN categories c ON c.id = p.categorie_id
        WHERE p.boutique_id = ? AND p.actif = 1 AND (p.nom LIKE ? OR p.sku LIKE ? OR p.marque LIKE ?)
        ORDER  BY p.nom ASC
        LIMIT ? OFFSET ?
      `)
      db.__setListResponse(sqlSelectSearch, [PRODUIT_ENRICHI])

      const result = await listProduits(db as any, 1, { search: 'iPhone' })

      expect(result.data).toHaveLength(1)
    })

    it('cnt null → total=0, pages=0', async () => {
      db.__setResponse(SQL_COUNT_BASE, null)
      db.__setListResponse(SQL_SELECT_BASE, [])

      const result = await listProduits(db as any, 1)

      expect(result.pagination.total).toBe(0)
      expect(result.pagination.pages).toBe(0)
    })
  })

  // ─── getProduitById ────────────────────────────────────────────────────────

  describe('getProduitById()', () => {
    it('retourne null si produit inexistant', async () => {
      db.__setNotFound(SQL_GET_PRODUIT)

      const result = await getProduitById(db as any, 999)

      expect(result).toBeNull()
    })

    it('retourne la fiche produit enrichie avec mouvements', async () => {
      db.__setResponse(SQL_GET_PRODUIT, PRODUIT_ENRICHI)
      db.__setListResponse(SQL_GET_MOUVEMENTS, [
        { id: 1, produit_id: 5, type_mouvement: 'entree', quantite: 10, user_nom: 'Marie Dupont' },
      ])

      const result = await getProduitById(db as any, 5)

      expect(result).not.toBeNull()
      expect(result.id).toBe(5)
      expect(result.nom).toBe('Écran iPhone 14')
      expect(result.categorie_nom).toBe('Écrans')
      expect(result.mouvements).toHaveLength(1)
      expect(result.mouvements[0].type_mouvement).toBe('entree')
    })

    it('retourne liste vide de mouvements si aucun mouvement', async () => {
      db.__setResponse(SQL_GET_PRODUIT, PRODUIT_ENRICHI)
      db.__setListResponse(SQL_GET_MOUVEMENTS, [])

      const result = await getProduitById(db as any, 5)

      expect(result.mouvements).toEqual([])
    })

    it('ne fait pas de requête mouvements si produit null', async () => {
      db.__setNotFound(SQL_GET_PRODUIT)

      await getProduitById(db as any, 999)

      const calls = db.__getCalls()
      const mouvCalls = calls.filter(c => c.sql.includes('mouvements_stock'))
      expect(mouvCalls).toHaveLength(0)
    })
  })

  // ─── createProduit ─────────────────────────────────────────────────────────

  describe('createProduit()', () => {
    it('crée un produit et retourne son id', async () => {
      dbD1.__setResponse(SQL_INSERT_PRODUIT, { id: 42 })

      const result = await createProduit(dbD1 as any, 1, 10, { nom: 'Nouveau Produit' })

      expect(result).toEqual({ id: 42 })
    })

    it('enregistre un mouvement stock initial si stock_actuel > 0', async () => {
      dbD1.__setResponse(SQL_INSERT_PRODUIT, { id: 42 })

      await createProduit(dbD1 as any, 1, 10, { nom: 'Produit avec stock', stock_actuel: 15 })

      const calls = dbD1.__getCalls()
      const mouvCall = calls.find(c => c.sql === SQL_INSERT_MOUVEMENT_INITIAL)
      expect(mouvCall).toBeDefined()
      // params: produitId, boutiqueId, quantite, stock_actuel, userId
      expect(mouvCall!.params).toEqual([42, 1, 15, 15, 10])
    })

    it("n'enregistre PAS de mouvement si stock_actuel = 0", async () => {
      dbD1.__setResponse(SQL_INSERT_PRODUIT, { id: 43 })

      await createProduit(dbD1 as any, 1, 10, { nom: 'Produit sans stock', stock_actuel: 0 })

      const calls = dbD1.__getCalls()
      const mouvCall = calls.find(c => c.sql === SQL_INSERT_MOUVEMENT_INITIAL)
      expect(mouvCall).toBeUndefined()
    })

    it("n'enregistre PAS de mouvement si stock_actuel omis (défaut 0)", async () => {
      dbD1.__setResponse(SQL_INSERT_PRODUIT, { id: 44 })

      await createProduit(dbD1 as any, 1, 10, { nom: 'Produit défaut' })

      const calls = dbD1.__getCalls()
      const mouvCall = calls.find(c => c.sql === SQL_INSERT_MOUVEMENT_INITIAL)
      expect(mouvCall).toBeUndefined()
    })

    it('appelle auditLog CREATE_PRODUIT', async () => {
      dbD1.__setResponse(SQL_INSERT_PRODUIT, { id: 42 })

      await createProduit(dbD1 as any, 1, 10, { nom: 'Produit Audit' })

      const calls = dbD1.__getCalls()
      const auditCall = calls.find(c => c.sql === SQL_AUDIT)
      expect(auditCall).toBeDefined()
      expect(auditCall!.params).toContain('CREATE_PRODUIT')
      expect(auditCall!.params).toContain('produit')
      expect(auditCall!.params).toContain(42)
    })

    it('utilise les valeurs par défaut : tva=20, stock_min=5', async () => {
      dbD1.__setResponse(SQL_INSERT_PRODUIT, { id: 45 })

      await createProduit(dbD1 as any, 1, 10, { nom: 'Produit défauts' })

      const calls = dbD1.__getCalls()
      const insertCall = calls.find(c => c.sql === SQL_INSERT_PRODUIT)
      expect(insertCall).toBeDefined()
      // famille(5), prix_achat_ht(6), prix_vente_ht(7), tva_taux(8), stock_actuel(9), stock_minimum(10)
      expect(insertCall!.params[8]).toBe(20)
      expect(insertCall!.params[10]).toBe(5)
    })
  })

  // ─── updateProduit ─────────────────────────────────────────────────────────

  describe('updateProduit()', () => {
    it('lance une Error si produit introuvable', async () => {
      dbD1.__setNotFound(SQL_CHECK_PRODUIT_ACTIF)

      await expect(updateProduit(dbD1 as any, 999, 10, { nom: 'Test' }))
        .rejects.toThrow('Produit introuvable.')
    })

    it('met à jour un produit existant', async () => {
      dbD1.__setResponse(SQL_CHECK_PRODUIT_ACTIF, { id: 5 })

      await expect(updateProduit(dbD1 as any, 5, 10, { nom: 'Nouvel écran', prix_vente_ht: 95 }))
        .resolves.toBeUndefined()

      const calls = dbD1.__getCalls()
      const updateCall = calls.find(c => c.sql === SQL_UPDATE_PRODUIT)
      expect(updateCall).toBeDefined()
    })

    it('appelle auditLog UPDATE_PRODUIT', async () => {
      dbD1.__setResponse(SQL_CHECK_PRODUIT_ACTIF, { id: 5 })

      await updateProduit(dbD1 as any, 5, 10, { nom: 'Nom modifié' })

      const calls = dbD1.__getCalls()
      const auditCall = calls.find(c => c.sql === SQL_AUDIT)
      expect(auditCall).toBeDefined()
      expect(auditCall!.params).toContain('UPDATE_PRODUIT')
      expect(auditCall!.params).toContain('produit')
      expect(auditCall!.params).toContain(5)
    })

    it('passe null pour les champs non fournis (COALESCE)', async () => {
      dbD1.__setResponse(SQL_CHECK_PRODUIT_ACTIF, { id: 5 })

      await updateProduit(dbD1 as any, 5, 10, { nom: 'Seulement le nom' })

      const calls = dbD1.__getCalls()
      const updateCall = calls.find(c => c.sql === SQL_UPDATE_PRODUIT)
      expect(updateCall).toBeDefined()
      // sku null (index 1), marque null (index 2), etc.
      expect(updateCall!.params[0]).toBe('Seulement le nom')
      expect(updateCall!.params[1]).toBeNull()
      expect(updateCall!.params[2]).toBeNull()
    })
  })

  // ─── deleteProduit ─────────────────────────────────────────────────────────

  describe('deleteProduit()', () => {
    it('soft-delete : actif = 0', async () => {
      await deleteProduit(dbD1 as any, 5, 10)

      const calls = dbD1.__getCalls()
      const deleteCall = calls.find(c => c.sql === SQL_SOFT_DELETE)
      expect(deleteCall).toBeDefined()
      expect(deleteCall!.params).toEqual([5])
    })

    it('appelle auditLog DELETE_PRODUIT', async () => {
      await deleteProduit(dbD1 as any, 5, 10)

      const calls = dbD1.__getCalls()
      const auditCall = calls.find(c => c.sql === SQL_AUDIT)
      expect(auditCall).toBeDefined()
      expect(auditCall!.params).toContain('DELETE_PRODUIT')
      expect(auditCall!.params).toContain('produit')
      expect(auditCall!.params).toContain(5)
    })

    it('ne fait PAS de guard avant le soft delete', async () => {
      await deleteProduit(dbD1 as any, 999, 10)

      const calls = dbD1.__getCalls()
      const guardCall = calls.find(c => c.sql === SQL_CHECK_PRODUIT_ACTIF)
      expect(guardCall).toBeUndefined()
    })
  })

  // ─── enregistrerMouvement ──────────────────────────────────────────────────

  describe('enregistrerMouvement()', () => {
    it('lance Error si type_mouvement invalide', async () => {
      await expect(enregistrerMouvement(db as any, 5, 10, {
        type_mouvement: 'transfert' as any,
        quantite: 3,
      })).rejects.toThrow('type_mouvement invalide')
    })

    it('lance Error si quantite = 0', async () => {
      await expect(enregistrerMouvement(db as any, 5, 10, {
        type_mouvement: 'entree',
        quantite: 0,
      })).rejects.toThrow('quantite doit être différente de 0')
    })

    it('lance Error si produit introuvable', async () => {
      db.__setNotFound(SQL_CHECK_PRODUIT_STOCK)

      await expect(enregistrerMouvement(db as any, 999, 10, {
        type_mouvement: 'entree',
        quantite: 5,
      })).rejects.toThrow('Produit introuvable.')
    })

    it('entree : stock_apres = stock_actuel + quantite', async () => {
      db.__setResponse(SQL_CHECK_PRODUIT_STOCK, { id: 5, stock_actuel: 10, boutique_id: 1 })

      const result = await enregistrerMouvement(db as any, 5, 10, {
        type_mouvement: 'entree',
        quantite: 5,
      })

      expect(result.stock_avant).toBe(10)
      expect(result.stock_apres).toBe(15)

      const calls = db.__getCalls()
      const updateStockCall = calls.find(c => c.sql === SQL_UPDATE_STOCK)
      expect(updateStockCall!.params).toEqual([15, 5])
    })

    it('sortie : stock_apres = stock_actuel - quantite', async () => {
      db.__setResponse(SQL_CHECK_PRODUIT_STOCK, { id: 5, stock_actuel: 10, boutique_id: 1 })

      const result = await enregistrerMouvement(db as any, 5, 10, {
        type_mouvement: 'sortie',
        quantite: 3,
      })

      expect(result.stock_avant).toBe(10)
      expect(result.stock_apres).toBe(7)
    })

    it('sortie : stock insuffisant → Error', async () => {
      db.__setResponse(SQL_CHECK_PRODUIT_STOCK, { id: 5, stock_actuel: 2, boutique_id: 1 })

      await expect(enregistrerMouvement(db as any, 5, 10, {
        type_mouvement: 'sortie',
        quantite: 5,
      })).rejects.toThrow('Stock insuffisant. Stock actuel : 2.')
    })

    it('ajustement : stock_apres = quantite (valeur absolue cible)', async () => {
      db.__setResponse(SQL_CHECK_PRODUIT_STOCK, { id: 5, stock_actuel: 10, boutique_id: 1 })

      const result = await enregistrerMouvement(db as any, 5, 10, {
        type_mouvement: 'ajustement',
        quantite: 6,
      })

      expect(result.stock_avant).toBe(10)
      expect(result.stock_apres).toBe(6)
    })

    it('ajustement : mouvQuantite = delta effectif (stock_apres - stock_avant)', async () => {
      db.__setResponse(SQL_CHECK_PRODUIT_STOCK, { id: 5, stock_actuel: 10, boutique_id: 1 })

      await enregistrerMouvement(db as any, 5, 10, {
        type_mouvement: 'ajustement',
        quantite: 6,
      })

      const calls = db.__getCalls()
      const insertMouvCall = calls.find(c => c.sql === SQL_INSERT_MOUVEMENT)
      expect(insertMouvCall).toBeDefined()
      // mouvQuantite = 6 - 10 = -4
      expect(insertMouvCall!.params[3]).toBe(-4)
    })

    it('inventaire : identique à ajustement', async () => {
      db.__setResponse(SQL_CHECK_PRODUIT_STOCK, { id: 5, stock_actuel: 8, boutique_id: 1 })

      const result = await enregistrerMouvement(db as any, 5, 10, {
        type_mouvement: 'inventaire',
        quantite: 12,
      })

      expect(result.stock_avant).toBe(8)
      expect(result.stock_apres).toBe(12)
    })

    it('ajustement impossible si cible negative → Error', async () => {
      db.__setResponse(SQL_CHECK_PRODUIT_STOCK, { id: 5, stock_actuel: 5, boutique_id: 1 })

      await expect(enregistrerMouvement(db as any, 5, 10, {
        type_mouvement: 'ajustement',
        quantite: -3,
      })).rejects.toThrow('Stock insuffisant')
    })

    it('INSERT mouvement avec bons paramètres (type=entree)', async () => {
      db.__setResponse(SQL_CHECK_PRODUIT_STOCK, { id: 5, stock_actuel: 10, boutique_id: 1 })

      await enregistrerMouvement(db as any, 5, 10, {
        type_mouvement: 'entree',
        quantite: 5,
        motif: 'Réception BC-001',
        ticket_id: null,
      })

      const calls = db.__getCalls()
      const mouvCall = calls.find(c => c.sql === SQL_INSERT_MOUVEMENT)
      expect(mouvCall).toBeDefined()
      // params: produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, ticket_id, user_id, motif
      expect(mouvCall!.params[0]).toBe(5)   // produit_id
      expect(mouvCall!.params[1]).toBe(1)   // boutique_id
      expect(mouvCall!.params[2]).toBe('entree')
      expect(mouvCall!.params[3]).toBe(5)   // delta
      expect(mouvCall!.params[4]).toBe(10)  // stock_avant
      expect(mouvCall!.params[5]).toBe(15)  // stock_apres
      expect(mouvCall!.params[6]).toBeNull() // ticket_id
      expect(mouvCall!.params[7]).toBe(10)  // user_id
      expect(mouvCall!.params[8]).toBe('Réception BC-001')
    })

    it('motif null par défaut', async () => {
      db.__setResponse(SQL_CHECK_PRODUIT_STOCK, { id: 5, stock_actuel: 5, boutique_id: 1 })

      await enregistrerMouvement(db as any, 5, 10, {
        type_mouvement: 'entree',
        quantite: 2,
      })

      const calls = db.__getCalls()
      const mouvCall = calls.find(c => c.sql === SQL_INSERT_MOUVEMENT)
      expect(mouvCall!.params[8]).toBeNull()
    })
  })

  // ─── listCategories ────────────────────────────────────────────────────────

  describe('listCategories()', () => {
    it('retourne une liste vide si aucune catégorie', async () => {
      db.__setListResponse(SQL_LIST_CATEGORIES, [])

      const result = await listCategories(db as any, 1)

      expect(result).toEqual([])
    })

    it('retourne les catégories avec nb_produits', async () => {
      const cat2 = { ...CATEGORIE_ROW, id: 3, nom: 'Batteries', nb_produits: 8 }
      db.__setListResponse(SQL_LIST_CATEGORIES, [CATEGORIE_ROW, cat2])

      const result = await listCategories(db as any, 1)

      expect(result).toHaveLength(2)
      expect(result[0].nom).toBe('Écrans')
      expect(result[0].nb_produits).toBe(5)
      expect(result[1].nom).toBe('Batteries')
    })

    it('passe boutiqueId en paramètre SQL', async () => {
      db.__setListResponse(SQL_LIST_CATEGORIES, [])

      await listCategories(db as any, 7)

      const calls = db.__getCalls()
      const catCall = calls.find(c => c.sql === SQL_LIST_CATEGORIES)
      expect(catCall).toBeDefined()
      expect(catCall!.params).toContain(7)
    })
  })

  // ─── createCategorie ───────────────────────────────────────────────────────

  describe('createCategorie()', () => {
    it('crée une catégorie racine (parent_id null) et retourne son id', async () => {
      db.__setResponse(SQL_INSERT_CATEGORIE, { id: 10 })

      const result = await createCategorie(db as any, 1, { nom: 'Accessoires' })

      expect(result).toEqual({ id: 10 })

      const calls = db.__getCalls()
      const insertCall = calls.find(c => c.sql === SQL_INSERT_CATEGORIE)
      expect(insertCall).toBeDefined()
      expect(insertCall!.params).toEqual([1, 'Accessoires', null])
    })

    it('crée une sous-catégorie avec parent_id', async () => {
      db.__setResponse(SQL_INSERT_CATEGORIE, { id: 11 })

      const result = await createCategorie(db as any, 1, { nom: 'Coques', parent_id: 3 })

      expect(result).toEqual({ id: 11 })

      const calls = db.__getCalls()
      const insertCall = calls.find(c => c.sql === SQL_INSERT_CATEGORIE)
      expect(insertCall!.params).toEqual([1, 'Coques', 3])
    })
  })

  // ─── getKpisStock ──────────────────────────────────────────────────────────

  describe('getKpisStock()', () => {
    it('retourne les KPIs depuis la DB', async () => {
      db.__setResponse(SQL_KPIS_STOCK, KPIS_ROW)

      const result = await getKpisStock(db as any, 1)

      expect(result.nb_produits).toBe(42)
      expect(result.nb_ruptures).toBe(3)
      expect(result.nb_alertes).toBe(7)
      expect(result.valeur_stock_ht).toBe(2150.50)
      expect(result.valeur_stock_cump).toBe(2200.00)
    })

    it('retourne 0 pour tous les champs si la row est null', async () => {
      db.__setNotFound(SQL_KPIS_STOCK)

      const result = await getKpisStock(db as any, 1)

      expect(result.nb_produits).toBe(0)
      expect(result.nb_ruptures).toBe(0)
      expect(result.nb_alertes).toBe(0)
      expect(result.valeur_stock_ht).toBe(0)
      expect(result.valeur_stock_cump).toBe(0)
    })

    it('retourne 0 pour les champs null (produits sans prix)', async () => {
      db.__setResponse(SQL_KPIS_STOCK, {
        nb_produits: 5,
        nb_ruptures: null,
        nb_alertes: null,
        valeur_stock_ht: null,
        valeur_stock_cump: null,
      })

      const result = await getKpisStock(db as any, 1)

      expect(result.nb_produits).toBe(5)
      expect(result.nb_ruptures).toBe(0)
      expect(result.nb_alertes).toBe(0)
      expect(result.valeur_stock_ht).toBe(0)
      expect(result.valeur_stock_cump).toBe(0)
    })

    it('passe boutiqueId en paramètre SQL', async () => {
      db.__setResponse(SQL_KPIS_STOCK, KPIS_ROW)

      await getKpisStock(db as any, 3)

      const calls = db.__getCalls()
      const kpisCall = calls.find(c => c.sql === SQL_KPIS_STOCK)
      expect(kpisCall).toBeDefined()
      expect(kpisCall!.params).toContain(3)
    })
  })

  // ─── importCatalogueCsv() ───────────────────────────────────────────────────

  describe('importCatalogueCsv()', () => {
    let db: ReturnType<typeof createMockD1>

    beforeEach(() => { db = createMockD1() })

    const CSV_VALIDE = [
      'sku,nom,prix_achat_ht,prix_vente_ht,stock_actuel,famille,tva_taux,marque,fournisseur',
      'ECR-IP14,Écran iPhone 14,50,90,5,piece,20,Apple,Apple Dist',
    ].join('\n')

    const CSV_SEMICOLON = [
      'sku;nom;prix_achat_ht;prix_vente_ht;stock_actuel;famille;tva_taux',
      'ECR-IP15;Écran iPhone 15;55;95;3;piece;20',
    ].join('\n')

    it('lève une erreur si le CSV est vide ou sans données', async () => {
      await expect(
        importCatalogueCsv(db as any, 1, 1, 'sku,nom')
      ).rejects.toThrow('vide')
    })

    it('lève une erreur si la colonne nom est absente', async () => {
      const csv = 'sku,prix_achat_ht\nECR-001,50'
      await expect(
        importCatalogueCsv(db as any, 1, 1, csv)
      ).rejects.toThrow('nom')
    })

    it('insère un nouveau produit si le SKU est inconnu', async () => {
      db.__setResponse(SQL_IMPORT_SELECT_SKU, null)          // SKU absent
      db.__setResponse(SQL_IMPORT_INSERT_PRODUIT, { id: 10 })

      const result = await importCatalogueCsv(db as any, 1, 1, CSV_VALIDE)

      expect(result.imported).toBe(1)
      expect(result.updated).toBe(0)
      expect(result.skipped).toBe(0)
      const calls = db.__getCalls()
      const insertCall = calls.find(c => c.sql === SQL_IMPORT_INSERT_PRODUIT)
      expect(insertCall).toBeDefined()
      // params[2] = nom
      expect(insertCall!.params[2]).toBe('Écran iPhone 14')
    })

    it('met à jour un produit existant si le SKU est connu', async () => {
      db.__setResponse(SQL_IMPORT_SELECT_SKU, { id: 5, stock_actuel: 5 }) // même stock → pas de mouvement
      // run() répond par défaut success

      const result = await importCatalogueCsv(db as any, 1, 1, CSV_VALIDE)

      expect(result.updated).toBe(1)
      expect(result.imported).toBe(0)
      const calls = db.__getCalls()
      const updateCall = calls.find(c => c.sql === SQL_IMPORT_UPDATE_PRODUIT)
      expect(updateCall).toBeDefined()
      // params : [nom, famille, paHt, pvHt, tva, marque, fourn, id]
      expect(updateCall!.params[0]).toBe('Écran iPhone 14')
      expect(updateCall!.params[7]).toBe(5)
    })

    it('crée un mouvement inventaire si le stock CSV diffère du stock existant', async () => {
      // stock_actuel existant = 2, CSV stock = 5 → delta = 3 → mouvement inventaire
      db.__setResponse(SQL_IMPORT_SELECT_SKU, { id: 5, stock_actuel: 2 })

      const result = await importCatalogueCsv(db as any, 1, 1, CSV_VALIDE)

      expect(result.updated).toBe(1)
      const calls = db.__getCalls()
      const mouvCall = calls.find(c => c.sql === SQL_IMPORT_MOUVEMENT_INVENTAIRE)
      expect(mouvCall).toBeDefined()
      // params : [produit_id=5, boutique_id=1, quantite=3, stock_avant=2, stock_apres=5, user_id=1]
      expect(mouvCall!.params[0]).toBe(5)
      expect(mouvCall!.params[2]).toBe(3)   // delta
      expect(mouvCall!.params[3]).toBe(2)   // stock_avant
      expect(mouvCall!.params[4]).toBe(5)   // stock_apres
    })

    it('normalise famille invalide en "piece"', async () => {
      const csvFamilleInvalide = [
        'sku,nom,famille',
        'SKU-001,Produit test,gadget',    // "gadget" n'est pas dans FAMILLES
      ].join('\n')
      db.__setResponse(SQL_IMPORT_SELECT_SKU, null)
      db.__setResponse(SQL_IMPORT_INSERT_PRODUIT, { id: 20 })

      await importCatalogueCsv(db as any, 1, 1, csvFamilleInvalide)

      const calls = db.__getCalls()
      const insertCall = calls.find(c => c.sql === SQL_IMPORT_INSERT_PRODUIT)
      expect(insertCall).toBeDefined()
      // params[4] = famille
      expect(insertCall!.params[4]).toBe('piece')
    })

    it('ignore une ligne sans nom et l\'ajoute aux erreurs', async () => {
      const csvSansNom = [
        'sku,nom,prix_achat_ht',
        'SKU-001,,50',
      ].join('\n')

      const result = await importCatalogueCsv(db as any, 1, 1, csvSansNom)

      expect(result.skipped).toBe(1)
      expect(result.imported).toBe(0)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain('nom manquant')
    })

    it('accepte le séparateur point-virgule', async () => {
      db.__setResponse(SQL_IMPORT_SELECT_SKU, null)
      db.__setResponse(SQL_IMPORT_INSERT_PRODUIT, { id: 15 })

      const result = await importCatalogueCsv(db as any, 1, 1, CSV_SEMICOLON)

      expect(result.imported).toBe(1)
      const calls = db.__getCalls()
      const insertCall = calls.find(c => c.sql === SQL_IMPORT_INSERT_PRODUIT)
      expect(insertCall!.params[2]).toBe('Écran iPhone 15')
    })

    it('crée un mouvement entrée si le produit est nouveau et stock > 0', async () => {
      db.__setResponse(SQL_IMPORT_SELECT_SKU, null)
      db.__setResponse(SQL_IMPORT_INSERT_PRODUIT, { id: 10 })

      await importCatalogueCsv(db as any, 1, 99, CSV_VALIDE)

      const calls = db.__getCalls()
      const mouvCall = calls.find(c => c.sql === SQL_IMPORT_MOUVEMENT_ENTREE)
      expect(mouvCall).toBeDefined()
      // params : [produit_id=10, boutique_id=1, quantite=5, stock_apres=5, user_id=99]
      // SQL: VALUES (?, ?, 'entree', ?, 0, ?, ?, 'Import catalogue CSV')
      // bind: (res.id, boutiqueId, stock, stock, userId) → indices [0..4]
      expect(mouvCall!.params[0]).toBe(10)
      expect(mouvCall!.params[2]).toBe(5)
      expect(mouvCall!.params[4]).toBe(99)  // userId
    })

    it('ne crée pas de mouvement entrée si le nouveau produit a stock = 0', async () => {
      const csvStock0 = [
        'sku,nom,stock_actuel',
        'SKU-ZERO,Produit zéro stock,0',
      ].join('\n')
      db.__setResponse(SQL_IMPORT_SELECT_SKU, null)
      db.__setResponse(SQL_IMPORT_INSERT_PRODUIT, { id: 30 })

      await importCatalogueCsv(db as any, 1, 1, csvStock0)

      const calls = db.__getCalls()
      const mouvCall = calls.find(c => c.sql === SQL_IMPORT_MOUVEMENT_ENTREE)
      expect(mouvCall).toBeUndefined()
    })

    it('retourne la structure { imported, updated, skipped, errors }', async () => {
      db.__setResponse(SQL_IMPORT_SELECT_SKU, null)
      db.__setResponse(SQL_IMPORT_INSERT_PRODUIT, { id: 50 })

      const result = await importCatalogueCsv(db as any, 1, 1, CSV_VALIDE)

      expect(result).toHaveProperty('imported')
      expect(result).toHaveProperty('updated')
      expect(result).toHaveProperty('skipped')
      expect(result).toHaveProperty('errors')
      expect(Array.isArray(result.errors)).toBe(true)
    })
  })
})
