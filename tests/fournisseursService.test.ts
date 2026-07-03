/**
 * @file tests/fournisseursService.test.ts
 * @description Tests unitaires — src/services/fournisseursService.ts
 *
 * Couverture :
 *   - listFournisseurs()         — pagination, filtre search, compteurs commandes
 *   - getFournisseur()           — null si absent, retourne fournisseur
 *   - createFournisseur()        — INSERT + auditLog, trim nom, nullable fields
 *   - updateFournisseur()        — COALESCE patch + auditLog
 *   - deleteFournisseur()        — soft delete actif=0 + auditLog
 *   - listBonsCommande()         — pagination, filtres statut/fournisseur_id/search
 *   - getBonCommande()           — null si absent, retourne bc + lignes
 *   - createBonCommande()        — numérotation BC-AAAA-NNNNN, calcul montants, lignes, auditLog
 *   - updateStatutBonCommande()  — statuts valides, statut invalide (Error)
 *   - receptionnerBonCommande()  — CUMP, stock, mouvement, Error si reçu/annulé
 *   - getKpisFournisseurs()      — 2 requêtes parallèles
 *   - getProduitsACommander()    — produits sous seuil, alerte rupture/bas, quantite_suggere
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import {
  listFournisseurs,
  getFournisseur,
  createFournisseur,
  updateFournisseur,
  deleteFournisseur,
  listBonsCommande,
  getBonCommande,
  createBonCommande,
  updateStatutBonCommande,
  receptionnerBonCommande,
  getKpisFournisseurs,
  getProduitsACommander,
  type Fournisseur,
  type BonCommande,
  type LigneBonCommande,
} from '../src/services/fournisseursService'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FOURNISSEUR_ROW: Fournisseur = {
  id: 1,
  boutique_id: 1,
  nom: 'Apple Distribution',
  contact: 'Jean Dupont',
  email: 'jean@apple-dist.fr',
  telephone: '0140000001',
  adresse: '1 avenue de la Pomme, Paris',
  site_web: 'https://apple-dist.fr',
  notes: null,
  actif: 1,
}

const BC_ROW: BonCommande = {
  id: 10,
  boutique_id: 1,
  fournisseur_id: 1,
  numero: 'BC-2026-00001',
  statut: 'draft',
  statut_paiement: 'pending',
  date_commande: '2026-07-01T10:00:00',
  date_reception: null,
  montant_ht: 100.00,
  montant_ttc: 120.00,
  notes: null,
  ticket_id: null,
}

const LIGNE_ROW: LigneBonCommande = {
  id: 1,
  bon_commande_id: 10,
  produit_id: 5,
  designation: 'Écran iPhone 14',
  reference: 'SCR-IP14-001',
  quantite_commandee: 2,
  quantite_recue: 0,
  prix_achat_ht: 50.00,
  tva_taux: 20,
}

// ─── SQL normalisés ───────────────────────────────────────────────────────────

const SQL_COUNT_FOURNISSEURS = 'SELECT COUNT(*) as cnt FROM fournisseurs f WHERE f.boutique_id = ? AND f.actif = 1'

const SQL_LIST_FOURNISSEURS = `SELECT f.*, COUNT(bc.id) as nb_commandes, SUM(CASE WHEN bc.statut = 'awaiting_delivery' THEN 1 ELSE 0 END) as nb_en_attente FROM fournisseurs f LEFT JOIN bons_commande bc ON bc.fournisseur_id = f.id WHERE f.boutique_id = ? AND f.actif = 1 GROUP BY f.id ORDER BY f.nom ASC LIMIT ? OFFSET ?`

const SQL_GET_FOURNISSEUR = 'SELECT * FROM fournisseurs WHERE id = ? AND actif = 1'

const SQL_INSERT_FOURNISSEUR = 'INSERT INTO fournisseurs (boutique_id, nom, contact, email, telephone, adresse, site_web, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'

const SQL_UPDATE_FOURNISSEUR = `UPDATE fournisseurs SET nom = COALESCE(?, nom), contact = COALESCE(?, contact), email = COALESCE(?, email), telephone = COALESCE(?, telephone), adresse = COALESCE(?, adresse), site_web = COALESCE(?, site_web), notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND actif = 1`

const SQL_DELETE_FOURNISSEUR = 'UPDATE fournisseurs SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?'

const SQL_AUDIT_LOG = `INSERT INTO audit_log (boutique_id, user_id, action, entite_type, entite_id) VALUES (?, ?, ?, ?, ?)`

const SQL_COUNT_BC = `SELECT COUNT(*) as cnt FROM bons_commande bc LEFT JOIN fournisseurs f ON f.id = bc.fournisseur_id WHERE bc.boutique_id = ?`

const SQL_LIST_BC = `SELECT bc.*, f.nom as fournisseur_nom, f.email as fournisseur_email, f.telephone as fournisseur_telephone, COUNT(l.id) as nb_lignes, SUM(l.quantite_commandee) as total_articles_commandes, SUM(l.quantite_recue) as total_articles_recus FROM bons_commande bc LEFT JOIN fournisseurs f ON f.id = bc.fournisseur_id LEFT JOIN lignes_bon_commande l ON l.bon_commande_id = bc.id WHERE bc.boutique_id = ? GROUP BY bc.id ORDER BY bc.created_at DESC LIMIT ? OFFSET ?`

const SQL_GET_BC = `SELECT bc.*, f.nom as fournisseur_nom, f.email as fournisseur_email, f.telephone as fournisseur_telephone FROM bons_commande bc LEFT JOIN fournisseurs f ON f.id = bc.fournisseur_id WHERE bc.id = ?`

const SQL_GET_LIGNES = `SELECT l.*, p.nom as produit_nom, p.stock_actuel, p.prix_achat_cump FROM lignes_bon_commande l LEFT JOIN produits p ON p.id = l.produit_id WHERE l.bon_commande_id = ? ORDER BY l.id ASC`

const SQL_SEQ_BC = (annee: number) =>
  `SELECT COALESCE(MAX(CAST(SUBSTR(numero, -5) AS INTEGER)), 0) + 1 AS next FROM bons_commande WHERE boutique_id = ? AND numero LIKE 'BC-${annee}-%'`

const SQL_INSERT_BC = `INSERT INTO bons_commande (boutique_id, fournisseur_id, numero, statut, statut_paiement, date_commande, date_livraison_prevue, montant_ht, montant_ttc, notes, ticket_id, user_id) VALUES (?, ?, ?, 'draft', 'pending', CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?) RETURNING id`

const SQL_INSERT_LIGNE_BC = `INSERT INTO lignes_bon_commande (bon_commande_id, produit_id, designation, reference, quantite_commandee, prix_achat_ht, tva_taux) VALUES (?, ?, ?, ?, ?, ?, ?)`

const SQL_UPDATE_STATUT_BC = `UPDATE bons_commande SET statut = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`

const SQL_GET_BC_FOR_RECEPTION = 'SELECT * FROM bons_commande WHERE id = ?'

const SQL_GET_LIGNE_FOR_RECEPTION = 'SELECT * FROM lignes_bon_commande WHERE id = ? AND bon_commande_id = ?'

const SQL_UPDATE_LIGNE_QTY = 'UPDATE lignes_bon_commande SET quantite_recue = quantite_recue + ? WHERE id = ?'

const SQL_GET_PRODUIT_FOR_CUMP = 'SELECT id, stock_actuel, prix_achat_cump, boutique_id FROM produits WHERE id = ?'

const SQL_UPDATE_PRODUIT_CUMP = 'UPDATE produits SET stock_actuel = ?, prix_achat_cump = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'

const SQL_INSERT_MOUVEMENT_STOCK = `INSERT INTO mouvements_stock (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, user_id, motif) VALUES (?, ?, 'reception_commande', ?, ?, ?, ?, ?)`

const SQL_UPDATE_BC_RECEIVED = `UPDATE bons_commande SET statut = 'received', date_reception = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`

const SQL_KPI_FOURNISSEURS = `SELECT COUNT(DISTINCT f.id) as nb_fournisseurs, COUNT(bc.id) as nb_commandes_total, SUM(CASE WHEN bc.statut = 'awaiting_delivery' THEN 1 ELSE 0 END) as nb_en_attente, SUM(CASE WHEN bc.statut = 'received' THEN bc.montant_ht ELSE 0 END) as montant_achats_ht, SUM(CASE WHEN bc.statut_paiement = 'pending' AND bc.statut != 'cancelled' THEN bc.montant_ttc ELSE 0 END) as montant_impaye_ttc FROM fournisseurs f LEFT JOIN bons_commande bc ON bc.fournisseur_id = f.id WHERE f.boutique_id = ? AND f.actif = 1`

const SQL_KPI_A_COMMANDER = 'SELECT COUNT(*) as nb_produits_a_commander FROM produits WHERE boutique_id = ? AND actif = 1 AND stock_actuel <= stock_minimum'

const SQL_PRODUITS_A_COMMANDER = `SELECT p.id, p.nom, p.sku, p.marque, p.stock_actuel, p.stock_minimum, p.prix_achat_ht, p.prix_achat_cump, f.id as fournisseur_id, f.nom as fournisseur_nom, f.email as fournisseur_email, (p.stock_minimum - p.stock_actuel + 1) as quantite_suggere, CASE WHEN p.stock_actuel = 0 THEN 'rupture' ELSE 'bas' END as alerte FROM produits p LEFT JOIN fournisseurs f ON f.id = p.fournisseur_id AND f.actif = 1 WHERE p.boutique_id = ? AND p.actif = 1 AND p.stock_actuel <= p.stock_minimum ORDER BY p.stock_actuel ASC, p.nom ASC`

// ─── listFournisseurs ─────────────────────────────────────────────────────────

describe('listFournisseurs()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse(SQL_COUNT_FOURNISSEURS, { cnt: 1 })
    db.__setListResponse(SQL_LIST_FOURNISSEURS, [{ ...FOURNISSEUR_ROW, nb_commandes: 3, nb_en_attente: 1 }])
  })

  it('retourne data + pagination', async () => {
    const res = await listFournisseurs(db, 1, {})

    expect(res.data).toHaveLength(1)
    expect(res.pagination.total).toBe(1)
    expect(res.pagination.page).toBe(1)
  })

  it('tableau vide si aucun fournisseur', async () => {
    db.__setResponse(SQL_COUNT_FOURNISSEURS, { cnt: 0 })
    db.__setListResponse(SQL_LIST_FOURNISSEURS, [])

    const res = await listFournisseurs(db, 1, {})

    expect(res.data).toEqual([])
  })

  it('filtre search — LIKE sur nom/email/contact', async () => {
    await listFournisseurs(db, 1, { search: 'Apple' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain('%Apple%')
    // 3 LIKE (nom, email, contact)
    expect(countCall?.params.filter(p => p === '%Apple%')).toHaveLength(3)
  })

  it('pagination calcule offset correctement', async () => {
    db.__setResponse(SQL_COUNT_FOURNISSEURS, { cnt: 30 })
    db.__setListResponse(SQL_LIST_FOURNISSEURS, [FOURNISSEUR_ROW])

    const res = await listFournisseurs(db, 1, { page: '2', limit: '10' })

    expect(res.pagination.page).toBe(2)
    expect(res.pagination.pages).toBe(3)
  })

  it('SQL joint bons_commande pour compteurs (nb_commandes / nb_en_attente)', async () => {
    await listFournisseurs(db, 1, {})

    const calls = db.__getCalls()
    const listCall = calls.find(c => c.sql.includes('nb_commandes'))
    expect(listCall?.sql).toContain('LEFT JOIN bons_commande')
  })
})

// ─── getFournisseur ───────────────────────────────────────────────────────────

describe('getFournisseur()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne null si fournisseur absent', async () => {
    db.__setNotFound(SQL_GET_FOURNISSEUR)

    const result = await getFournisseur(db, 999)

    expect(result).toBeNull()
  })

  it('retourne le fournisseur si présent', async () => {
    db.__setResponse(SQL_GET_FOURNISSEUR, FOURNISSEUR_ROW)

    const result = await getFournisseur(db, 1)

    expect(result?.id).toBe(1)
    expect(result?.nom).toBe('Apple Distribution')
  })
})

// ─── createFournisseur ────────────────────────────────────────────────────────

describe('createFournisseur()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse(SQL_INSERT_FOURNISSEUR, { id: 1 })
  })

  it('retourne l\'id du fournisseur créé', async () => {
    const id = await createFournisseur(db, {
      boutique_id: 1,
      nom: 'Apple Distribution',
      email: 'contact@apple-dist.fr',
    }, 5)

    expect(id).toBe(1)
  })

  it('trim appliqué sur le nom', async () => {
    await createFournisseur(db, { boutique_id: 1, nom: '  Fournisseur Test  ' }, 5)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO fournisseurs'))
    // nom est à l'index 1
    expect(insertCall?.params[1]).toBe('Fournisseur Test')
  })

  it('champs optionnels null si absent', async () => {
    await createFournisseur(db, { boutique_id: 1, nom: 'Minimal' }, 5)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO fournisseurs'))
    // contact=2, email=3, telephone=4, adresse=5, site_web=6, notes=7
    expect(insertCall?.params[2]).toBeNull()
    expect(insertCall?.params[3]).toBeNull()
    expect(insertCall?.params[4]).toBeNull()
  })

  it('insère un auditLog après création', async () => {
    await createFournisseur(db, { boutique_id: 1, nom: 'Test' }, 5)

    const calls = db.__getCalls()
    const auditCall = calls.find(c => c.sql.startsWith('INSERT INTO audit_log'))
    expect(auditCall).toBeDefined()
    expect(auditCall?.params).toContain('CREATE_FOURNISSEUR')
  })
})

// ─── updateFournisseur ────────────────────────────────────────────────────────

describe('updateFournisseur()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('exécute UPDATE avec COALESCE', async () => {
    await updateFournisseur(db, 1, { nom: 'Nouveau Nom' }, 5)

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE fournisseurs'))
    expect(updateCall).toBeDefined()
    expect(updateCall?.sql).toContain('COALESCE')
  })

  it('nom trimé dans les params', async () => {
    await updateFournisseur(db, 1, { nom: '  Trimé  ' }, 5)

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE fournisseurs'))
    expect(updateCall?.params[0]).toBe('Trimé')
  })

  it('champs non fournis → null transmis (COALESCE gère la conservation)', async () => {
    await updateFournisseur(db, 1, { email: 'new@email.fr' }, 5)

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE fournisseurs'))
    // nom=0, contact=1 → null car non fourni
    expect(updateCall?.params[0]).toBeNull()
    expect(updateCall?.params[1]).toBeNull()
    expect(updateCall?.params[2]).toBe('new@email.fr')
  })

  it('insère un auditLog après update', async () => {
    await updateFournisseur(db, 1, { nom: 'Test' }, 5)

    const calls = db.__getCalls()
    const auditCall = calls.find(c => c.sql.startsWith('INSERT INTO audit_log'))
    expect(auditCall?.params).toContain('UPDATE_FOURNISSEUR')
  })
})

// ─── deleteFournisseur ────────────────────────────────────────────────────────

describe('deleteFournisseur()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('effectue soft delete (actif = 0)', async () => {
    await deleteFournisseur(db, 1, 5)

    const calls = db.__getCalls()
    const deleteCall = calls.find(c => c.sql.includes('actif = 0'))
    expect(deleteCall).toBeDefined()
    expect(deleteCall?.params[0]).toBe(1) // id
  })

  it('insère un auditLog après delete', async () => {
    await deleteFournisseur(db, 1, 5)

    const calls = db.__getCalls()
    const auditCall = calls.find(c => c.sql.startsWith('INSERT INTO audit_log'))
    expect(auditCall?.params).toContain('DELETE_FOURNISSEUR')
  })

  it('n\'exécute pas DELETE physique', async () => {
    await deleteFournisseur(db, 1, 5)

    const calls = db.__getCalls()
    const physicalDelete = calls.find(c => c.sql.startsWith('DELETE'))
    expect(physicalDelete).toBeUndefined()
  })
})

// ─── listBonsCommande ─────────────────────────────────────────────────────────

describe('listBonsCommande()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse(SQL_COUNT_BC, { cnt: 2 })
    db.__setListResponse(SQL_LIST_BC, [
      { ...BC_ROW, fournisseur_nom: 'Apple Distribution', nb_lignes: 2 },
      { ...BC_ROW, id: 11, numero: 'BC-2026-00002' },
    ])
  })

  it('retourne data + pagination', async () => {
    const res = await listBonsCommande(db, 1, {})

    expect(res.data).toHaveLength(2)
    expect(res.pagination.total).toBe(2)
  })

  it('filtre statut transmis', async () => {
    await listBonsCommande(db, 1, { statut: 'awaiting_delivery' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain('awaiting_delivery')
  })

  it('filtre fournisseur_id converti en Number', async () => {
    await listBonsCommande(db, 1, { fournisseur_id: '1' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain(1)
    // pas de string '1'
    expect(countCall?.params).not.toContain('1')
  })

  it('filtre search — LIKE sur numero et fournisseur.nom', async () => {
    await listBonsCommande(db, 1, { search: 'BC-2026' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain('%BC-2026%')
  })

  it('filtre statut_paiement', async () => {
    await listBonsCommande(db, 1, { statut_paiement: 'paid' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('COUNT'))
    expect(countCall?.params).toContain('paid')
  })
})

// ─── getBonCommande ───────────────────────────────────────────────────────────

describe('getBonCommande()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne null si BC absent', async () => {
    db.__setNotFound(SQL_GET_BC)

    const result = await getBonCommande(db, 999)

    expect(result).toBeNull()
  })

  it('retourne { bc, lignes } si BC présent', async () => {
    db.__setResponse(SQL_GET_BC, { ...BC_ROW, fournisseur_nom: 'Apple Distribution' })
    db.__setListResponse(SQL_GET_LIGNES, [LIGNE_ROW])

    const result = await getBonCommande(db, 10)

    expect(result).not.toBeNull()
    expect(result!.bc.id).toBe(10)
    expect(result!.lignes).toHaveLength(1)
    expect(result!.lignes[0].designation).toBe('Écran iPhone 14')
  })

  it('lignes vide si aucune ligne associée', async () => {
    db.__setResponse(SQL_GET_BC, BC_ROW)
    db.__setListResponse(SQL_GET_LIGNES, [])

    const result = await getBonCommande(db, 10)

    expect(result!.lignes).toEqual([])
  })
})

// ─── createBonCommande ────────────────────────────────────────────────────────

describe('createBonCommande()', () => {
  let db: ReturnType<typeof createMockD1>
  const annee = new Date().getFullYear()

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse(SQL_SEQ_BC(annee), { next: 1 })
    db.__setResponse(SQL_INSERT_BC, { id: 10 })
  })

  it('retourne l\'id du BC créé', async () => {
    const id = await createBonCommande(db, {
      boutique_id: 1,
      fournisseur_id: 1,
      lignes: [{ designation: 'Écran iPhone', quantite_commandee: 2, prix_achat_ht: 50 }],
    }, 5)

    expect(id).toBe(10)
  })

  it('numérotation BC-AAAA-NNNNN (zero-padded 5 chiffres)', async () => {
    await createBonCommande(db, {
      boutique_id: 1,
      fournisseur_id: 1,
      lignes: [{ designation: 'Test', quantite_commandee: 1, prix_achat_ht: 10 }],
    }, 5)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO bons_commande'))
    // numero est à l'index 2
    expect(insertCall?.params[2]).toBe(`BC-${annee}-00001`)
  })

  it('calcule montant_ht correctement', async () => {
    // 2 × 50 = 100.00 HT
    await createBonCommande(db, {
      boutique_id: 1, fournisseur_id: 1,
      lignes: [{ designation: 'A', quantite_commandee: 2, prix_achat_ht: 50 }],
    }, 5)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO bons_commande'))
    // montant_ht est à l'index 7 (boutique_id=0, fournisseur_id=1, numero=2, date_livraison=3, montant_ht=4, montant_ttc=5, notes=6, ticket_id=7, user_id=8)
    // Correction: regardons les paramètres réels
    expect(insertCall?.params).toContain(100)
  })

  it('calcule montant_ttc (TVA 20% par défaut)', async () => {
    // 2 × 50 × 1.20 = 120.00 TTC
    await createBonCommande(db, {
      boutique_id: 1, fournisseur_id: 1,
      lignes: [{ designation: 'A', quantite_commandee: 2, prix_achat_ht: 50 }],
    }, 5)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO bons_commande'))
    expect(insertCall?.params).toContain(120)
  })

  it('calcule montant avec TVA personnalisée', async () => {
    // 1 × 100 × 1.05 = 105.00 TTC
    await createBonCommande(db, {
      boutique_id: 1, fournisseur_id: 1,
      lignes: [{ designation: 'B', quantite_commandee: 1, prix_achat_ht: 100, tva_taux: 5 }],
    }, 5)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.startsWith('INSERT INTO bons_commande'))
    expect(insertCall?.params).toContain(105)
  })

  it('insère chaque ligne dans lignes_bon_commande', async () => {
    await createBonCommande(db, {
      boutique_id: 1, fournisseur_id: 1,
      lignes: [
        { designation: 'Ligne 1', quantite_commandee: 1, prix_achat_ht: 10 },
        { designation: 'Ligne 2', quantite_commandee: 2, prix_achat_ht: 20 },
      ],
    }, 5)

    const calls = db.__getCalls()
    const ligneInserts = calls.filter(c => c.sql.startsWith('INSERT INTO lignes_bon_commande'))
    expect(ligneInserts).toHaveLength(2)
  })

  it('designation trimée dans la ligne', async () => {
    await createBonCommande(db, {
      boutique_id: 1, fournisseur_id: 1,
      lignes: [{ designation: '  Écran  ', quantite_commandee: 1, prix_achat_ht: 50 }],
    }, 5)

    const calls = db.__getCalls()
    const ligneInsert = calls.find(c => c.sql.startsWith('INSERT INTO lignes_bon_commande'))
    // designation est à l'index 2 dans lignes_bon_commande
    expect(ligneInsert?.params[2]).toBe('Écran')
  })

  it('TVA 20% par défaut dans les lignes', async () => {
    await createBonCommande(db, {
      boutique_id: 1, fournisseur_id: 1,
      lignes: [{ designation: 'Test', quantite_commandee: 1, prix_achat_ht: 10 }],
    }, 5)

    const calls = db.__getCalls()
    const ligneInsert = calls.find(c => c.sql.startsWith('INSERT INTO lignes_bon_commande'))
    // tva_taux est à l'index 6
    expect(ligneInsert?.params[6]).toBe(20)
  })

  it('insère un auditLog après création', async () => {
    await createBonCommande(db, {
      boutique_id: 1, fournisseur_id: 1,
      lignes: [{ designation: 'Test', quantite_commandee: 1, prix_achat_ht: 10 }],
    }, 5)

    const calls = db.__getCalls()
    const auditCall = calls.find(c => c.sql.startsWith('INSERT INTO audit_log'))
    expect(auditCall?.params).toContain('CREATE_BON_COMMANDE')
  })

  it('lève Error si INSERT BC retourne null', async () => {
    db.__setNotFound(SQL_INSERT_BC)

    await expect(createBonCommande(db, {
      boutique_id: 1, fournisseur_id: 1,
      lignes: [{ designation: 'Test', quantite_commandee: 1, prix_achat_ht: 10 }],
    }, 5)).rejects.toThrow('Échec création bon de commande.')
  })
})

// ─── updateStatutBonCommande ──────────────────────────────────────────────────

describe('updateStatutBonCommande()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it.each(['draft', 'awaiting_delivery', 'received', 'cancelled'])(
    'statut valide "%s" — UPDATE exécuté',
    async (statut) => {
      await updateStatutBonCommande(db, 10, statut, 5)

      const calls = db.__getCalls()
      const updateCall = calls.find(c => c.sql.startsWith('UPDATE bons_commande'))
      expect(updateCall).toBeDefined()
      expect(updateCall?.params[0]).toBe(statut)
    }
  )

  it('statut invalide — lève Error', async () => {
    await expect(updateStatutBonCommande(db, 10, 'invalid_status', 5))
      .rejects.toThrow('Statut invalide')
  })

  it('insère un auditLog après update', async () => {
    await updateStatutBonCommande(db, 10, 'received', 5)

    const calls = db.__getCalls()
    const auditCall = calls.find(c => c.sql.startsWith('INSERT INTO audit_log'))
    expect(auditCall).toBeDefined()
    expect(auditCall?.params).toContain('BC_STATUT_RECEIVED')
  })
})

// ─── receptionnerBonCommande ──────────────────────────────────────────────────

describe('receptionnerBonCommande()', () => {
  let db: ReturnType<typeof createMockD1>

  const PRODUIT = { id: 5, stock_actuel: 10, prix_achat_cump: 45.00, boutique_id: 1 }

  function setupReception(bcStatut = 'awaiting_delivery') {
    db.__setResponse(SQL_GET_BC_FOR_RECEPTION, { ...BC_ROW, statut: bcStatut, boutique_id: 1 })
    db.__setResponse(SQL_GET_LIGNE_FOR_RECEPTION, LIGNE_ROW)
    db.__setResponse(SQL_GET_PRODUIT_FOR_CUMP, PRODUIT)
  }

  beforeEach(() => {
    db = createMockD1()
  })

  it('lève Error si BC introuvable', async () => {
    db.__setNotFound(SQL_GET_BC_FOR_RECEPTION)

    await expect(receptionnerBonCommande(db, 999, [{ ligne_id: 1, quantite_recue: 1 }], 5))
      .rejects.toThrow('Bon de commande introuvable.')
  })

  it('lève Error si BC déjà reçu', async () => {
    db.__setResponse(SQL_GET_BC_FOR_RECEPTION, { ...BC_ROW, statut: 'received' })

    await expect(receptionnerBonCommande(db, 10, [{ ligne_id: 1, quantite_recue: 1 }], 5))
      .rejects.toThrow('Bon de commande déjà réceptionné.')
  })

  it('lève Error si BC annulé', async () => {
    db.__setResponse(SQL_GET_BC_FOR_RECEPTION, { ...BC_ROW, statut: 'cancelled' })

    await expect(receptionnerBonCommande(db, 10, [{ ligne_id: 1, quantite_recue: 1 }], 5))
      .rejects.toThrow('Bon de commande annulé.')
  })

  it('retourne { nb_produits_mis_a_jour }', async () => {
    setupReception()

    const result = await receptionnerBonCommande(db, 10, [{ ligne_id: 1, quantite_recue: 2 }], 5)

    expect(result).toHaveProperty('nb_produits_mis_a_jour')
    expect(result.nb_produits_mis_a_jour).toBe(1)
  })

  it('CUMP standard : (stock_avant × cump_avant + qty × prix) / stock_après', async () => {
    // stock_avant=10, cump_avant=45, qty=2, prix=50
    // CUMP = (10×45 + 2×50) / 12 = (450 + 100) / 12 = 550/12 = 45.83
    setupReception()

    await receptionnerBonCommande(db, 10, [{ ligne_id: 1, quantite_recue: 2 }], 5)

    const calls = db.__getCalls()
    const updateProduit = calls.find(c => c.sql.startsWith('UPDATE produits'))
    // stock_apres = 12 (index 0), cump (index 1)
    expect(updateProduit?.params[0]).toBe(12)
    expect(updateProduit?.params[1]).toBeCloseTo(45.83, 1)
  })

  it('CUMP si stock_avant = 0 : CUMP = prix_achat_ht', async () => {
    db.__setResponse(SQL_GET_BC_FOR_RECEPTION, { ...BC_ROW, statut: 'awaiting_delivery', boutique_id: 1 })
    db.__setResponse(SQL_GET_LIGNE_FOR_RECEPTION, { ...LIGNE_ROW, prix_achat_ht: 60 })
    db.__setResponse(SQL_GET_PRODUIT_FOR_CUMP, { ...PRODUIT, stock_actuel: 0, prix_achat_cump: 0 })

    await receptionnerBonCommande(db, 10, [{ ligne_id: 1, quantite_recue: 3 }], 5)

    const calls = db.__getCalls()
    const updateProduit = calls.find(c => c.sql.startsWith('UPDATE produits'))
    // stock_apres = 3, CUMP = 60.00
    expect(updateProduit?.params[0]).toBe(3)
    expect(updateProduit?.params[1]).toBe(60)
  })

  it('crée un mouvement de stock reception_commande', async () => {
    setupReception()

    await receptionnerBonCommande(db, 10, [{ ligne_id: 1, quantite_recue: 2 }], 5)

    const calls = db.__getCalls()
    const mvtCall = calls.find(c => c.sql.includes('mouvements_stock'))
    expect(mvtCall).toBeDefined()
    expect(mvtCall?.sql).toContain('reception_commande')
  })

  it('passe le BC en received après réception', async () => {
    setupReception()

    await receptionnerBonCommande(db, 10, [{ ligne_id: 1, quantite_recue: 2 }], 5)

    const calls = db.__getCalls()
    const bcUpdate = calls.find(c => c.sql.includes("statut = 'received'"))
    expect(bcUpdate).toBeDefined()
    expect(bcUpdate?.params[0]).toBe(10)
  })

  it('ignore les lignes avec quantite_recue ≤ 0', async () => {
    db.__setResponse(SQL_GET_BC_FOR_RECEPTION, { ...BC_ROW, statut: 'awaiting_delivery', boutique_id: 1 })

    const result = await receptionnerBonCommande(db, 10, [
      { ligne_id: 1, quantite_recue: 0 },
      { ligne_id: 2, quantite_recue: -1 },
    ], 5)

    expect(result.nb_produits_mis_a_jour).toBe(0)
    const calls = db.__getCalls()
    const ligneCall = calls.find(c => c.sql.startsWith('SELECT * FROM lignes_bon_commande'))
    expect(ligneCall).toBeUndefined()
  })

  it('ligne sans produit_id : pas de MAJ stock (mais quantite_recue mise à jour)', async () => {
    db.__setResponse(SQL_GET_BC_FOR_RECEPTION, { ...BC_ROW, statut: 'awaiting_delivery', boutique_id: 1 })
    db.__setResponse(SQL_GET_LIGNE_FOR_RECEPTION, { ...LIGNE_ROW, produit_id: null })

    const result = await receptionnerBonCommande(db, 10, [{ ligne_id: 1, quantite_recue: 2 }], 5)

    // quantite_recue mise à jour
    const calls = db.__getCalls()
    const updateLigne = calls.find(c => c.sql.startsWith('UPDATE lignes_bon_commande'))
    expect(updateLigne).toBeDefined()
    // Mais nb_produits_mis_a_jour = 0 (pas de produit lié)
    expect(result.nb_produits_mis_a_jour).toBe(0)
  })

  it('insère un auditLog de réception', async () => {
    setupReception()

    await receptionnerBonCommande(db, 10, [{ ligne_id: 1, quantite_recue: 2 }], 5)

    const calls = db.__getCalls()
    const auditCall = calls.find(c => c.sql.startsWith('INSERT INTO audit_log'))
    expect(auditCall?.params).toContain('RECEPTION_BON_COMMANDE')
  })
})

// ─── getKpisFournisseurs ──────────────────────────────────────────────────────

describe('getKpisFournisseurs()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne les 6 champs KPI attendus', async () => {
    db.__setResponse(SQL_KPI_FOURNISSEURS, {
      nb_fournisseurs: 3, nb_commandes_total: 12, nb_en_attente: 2,
      montant_achats_ht: 5000, montant_impaye_ttc: 1200,
    })
    db.__setResponse(SQL_KPI_A_COMMANDER, { nb_produits_a_commander: 5 })

    const result = await getKpisFournisseurs(db, 1)

    expect(result).toHaveProperty('nb_fournisseurs')
    expect(result).toHaveProperty('nb_commandes_total')
    expect(result).toHaveProperty('nb_en_attente')
    expect(result).toHaveProperty('montant_achats_ht')
    expect(result).toHaveProperty('montant_impaye_ttc')
    expect(result).toHaveProperty('nb_produits_a_commander')
  })

  it('valeurs correctes', async () => {
    db.__setResponse(SQL_KPI_FOURNISSEURS, {
      nb_fournisseurs: 3, nb_commandes_total: 10, nb_en_attente: 1,
      montant_achats_ht: 2500, montant_impaye_ttc: 600,
    })
    db.__setResponse(SQL_KPI_A_COMMANDER, { nb_produits_a_commander: 7 })

    const result = await getKpisFournisseurs(db, 1)

    expect(result.nb_fournisseurs).toBe(3)
    expect(result.nb_produits_a_commander).toBe(7)
    expect(result.montant_achats_ht).toBe(2500)
  })

  it('nb_produits_a_commander = 0 si SQL null', async () => {
    db.__setResponse(SQL_KPI_FOURNISSEURS, { nb_fournisseurs: 0, nb_commandes_total: 0 })
    // SQL_KPI_A_COMMANDER retourne null par défaut

    const result = await getKpisFournisseurs(db, 1)

    expect(result.nb_produits_a_commander).toBe(0)
  })

  it('exécute 2 requêtes SQL (Promise.all)', async () => {
    db.__setResponse(SQL_KPI_FOURNISSEURS, { nb_fournisseurs: 0 })
    db.__setResponse(SQL_KPI_A_COMMANDER, { nb_produits_a_commander: 0 })

    await getKpisFournisseurs(db, 1)

    const calls = db.__getCalls()
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('boutique_id transmis aux 2 requêtes', async () => {
    db.__setResponse(SQL_KPI_FOURNISSEURS, { nb_fournisseurs: 0 })
    db.__setResponse(SQL_KPI_A_COMMANDER, { nb_produits_a_commander: 0 })

    await getKpisFournisseurs(db, 99)

    const calls = db.__getCalls()
    for (const call of calls) {
      expect(call.params[0]).toBe(99)
    }
  })
})

// ─── getProduitsACommander ────────────────────────────────────────────────────

describe('getProduitsACommander()', () => {
  let db: ReturnType<typeof createMockD1>

  const PRODUIT_BAS = {
    id: 5, nom: 'Écran iPhone 14', sku: 'SCR-IP14',
    marque: 'Apple', stock_actuel: 2, stock_minimum: 5,
    prix_achat_ht: 50, prix_achat_cump: 48,
    fournisseur_id: 1, fournisseur_nom: 'Apple Distribution', fournisseur_email: null,
    quantite_suggere: 4, alerte: 'bas',
  }

  const PRODUIT_RUPTURE = {
    id: 6, nom: 'Vitre Samsung S24', sku: 'VTR-S24',
    marque: 'Samsung', stock_actuel: 0, stock_minimum: 3,
    prix_achat_ht: 20, prix_achat_cump: 18,
    fournisseur_id: null, fournisseur_nom: null, fournisseur_email: null,
    quantite_suggere: 4, alerte: 'rupture',
  }

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne les produits sous seuil', async () => {
    db.__setListResponse(SQL_PRODUITS_A_COMMANDER, [PRODUIT_RUPTURE, PRODUIT_BAS])

    const result = await getProduitsACommander(db, 1)

    expect(result).toHaveLength(2)
  })

  it('retourne tableau vide si aucun produit en alerte', async () => {
    db.__setListResponse(SQL_PRODUITS_A_COMMANDER, [])

    const result = await getProduitsACommander(db, 1)

    expect(result).toEqual([])
  })

  it('SQL trié par stock_actuel ASC (ruptures en premier)', async () => {
    db.__setListResponse(SQL_PRODUITS_A_COMMANDER, [])

    await getProduitsACommander(db, 1)

    const calls = db.__getCalls()
    const sqlCall = calls.find(c => c.sql.includes('produits'))
    expect(sqlCall?.sql).toContain('ORDER BY p.stock_actuel ASC')
  })

  it('SQL calcule alerte rupture si stock = 0', async () => {
    db.__setListResponse(SQL_PRODUITS_A_COMMANDER, [])

    await getProduitsACommander(db, 1)

    const calls = db.__getCalls()
    const sqlCall = calls.find(c => c.sql.includes('produits'))
    expect(sqlCall?.sql).toContain("CASE WHEN p.stock_actuel = 0 THEN 'rupture' ELSE 'bas' END")
  })

  it('SQL calcule quantite_suggere = stock_minimum - stock_actuel + 1', async () => {
    db.__setListResponse(SQL_PRODUITS_A_COMMANDER, [])

    await getProduitsACommander(db, 1)

    const calls = db.__getCalls()
    const sqlCall = calls.find(c => c.sql.includes('produits'))
    expect(sqlCall?.sql).toContain('p.stock_minimum - p.stock_actuel + 1')
  })

  it('boutique_id transmis en paramètre', async () => {
    db.__setListResponse(SQL_PRODUITS_A_COMMANDER, [])

    await getProduitsACommander(db, 42)

    const calls = db.__getCalls()
    const sqlCall = calls.find(c => c.sql.includes('produits'))
    expect(sqlCall?.params[0]).toBe(42)
  })

  it('LEFT JOIN fournisseurs — null si fournisseur absent', async () => {
    db.__setListResponse(SQL_PRODUITS_A_COMMANDER, [PRODUIT_RUPTURE])

    const result = await getProduitsACommander(db, 1)

    expect(result[0]).toMatchObject({ alerte: 'rupture', fournisseur_nom: null })
  })
})
