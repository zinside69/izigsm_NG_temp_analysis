/**
 * stockService.ts — Model layer pour la gestion des produits et du stock
 * Sprint 2.17 — Extraction depuis routes/stocks.ts (violation P1 résolue)
 * Sprint 2.34 — MOD-04 : familles produits + import catalogue CSV fournisseur
 *
 * Périmètre : produits, catégories, mouvements de stock.
 * Aucun SQL ne doit subsister dans routes/stocks.ts après ce sprint.
 *
 * Fonctions exportées :
 *   listProduits(db, boutiqueId, opts)              — Liste paginée + filtres + alertes stock
 *   getProduitById(db, id)                          — Fiche produit avec derniers mouvements
 *   createProduit(db, boutiqueId, userId, data)     — Création + mouvement stock initial si stock > 0
 *   updateProduit(db, id, userId, data)             — Mise à jour champs éditables
 *   deleteProduit(db, id, userId)                   — Soft delete (actif = 0)
 *   enregistrerMouvement(db, produitId, userId, m)  — Mouvement stock (entrée/sortie/ajustement/inventaire)
 *   listCategories(db, boutiqueId)                  — Catégories + nb_produits
 *   createCategorie(db, boutiqueId, data)           — Création catégorie
 *   getKpisStock(db, boutiqueId)                    — KPIs : valeur stock, ruptures, alertes
 *   importCatalogueCsv(db, boutiqueId, userId, csv) — Import/UPSERT catalogue fournisseur CSV
 */

import { parsePagination, auditLog } from '../lib/db'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TypeMouvement  = 'entree' | 'sortie' | 'ajustement' | 'inventaire'
export type FamilleProduit = 'piece' | 'accessoire' | 'appareil' | 'consommable'

export const FAMILLES: FamilleProduit[] = ['piece', 'accessoire', 'appareil', 'consommable']

export interface ProduitRow {
  id:                   number
  boutique_id:          number
  categorie_id:         number | null
  sku:                  string | null
  nom:                  string
  marque:               string | null
  description:          string | null
  famille:              FamilleProduit
  prix_achat_ht:        number
  prix_achat_cump:      number
  prix_vente_ht:        number
  tva_taux:             number
  stock_actuel:         number
  stock_minimum:        number
  fournisseur:          string | null
  reference_fournisseur: string | null
  code_barre:           string | null
  actif:                number
  created_at:           string
  updated_at:           string
}

export interface ListProduitsOpts {
  categorie_id?: number
  famille?:      FamilleProduit | string
  stock_bas?:    boolean
  search?:       string
  limit?:        number
  offset?:       number
  page?:         number
}

export interface CreateProduitData {
  nom:                   string
  sku?:                  string | null
  marque?:               string | null
  categorie_id?:         number | null
  famille?:              FamilleProduit
  prix_achat_ht?:        number
  prix_vente_ht?:        number
  tva_taux?:             number
  stock_actuel?:         number
  stock_minimum?:        number
  fournisseur?:          string | null
  reference_fournisseur?: string | null
  code_barre?:           string | null
}

export interface UpdateProduitData {
  nom?:                  string
  sku?:                  string | null
  marque?:               string | null
  categorie_id?:         number | null
  famille?:              FamilleProduit
  prix_achat_ht?:        number
  prix_vente_ht?:        number
  tva_taux?:             number
  stock_minimum?:        number
  fournisseur?:          string | null
  code_barre?:           string | null
}

export interface MouvementData {
  type_mouvement: TypeMouvement
  quantite:       number
  motif?:         string | null
  ticket_id?:     number | null
}

export interface CreateCategorieData {
  nom:       string
  parent_id?: number | null
}

export interface KpisStock {
  nb_produits:        number
  nb_ruptures:        number
  nb_alertes:         number
  valeur_stock_ht:    number
  valeur_stock_cump:  number
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const TYPES_MOUVEMENT_VALIDES: TypeMouvement[] = ['entree', 'sortie', 'ajustement', 'inventaire']

// ─── Fonctions exportées ──────────────────────────────────────────────────────

/**
 * Liste les produits d'une boutique avec filtres, pagination et calcul de marge.
 * Ajoute l'indicateur alerte_stock : 'ok' | 'bas' | 'rupture'.
 *
 * @param db          — Instance D1Database
 * @param boutiqueId  — ID boutique obligatoire
 * @param opts        — Filtres optionnels : categorie_id, stock_bas, search + pagination
 * @returns           — { data, pagination }
 */
export async function listProduits(
  db: D1Database,
  boutiqueId: number,
  opts: ListProduitsOpts = {}
): Promise<{ data: any[]; pagination: { page: number; limit: number; total: number; pages: number } }> {
  const { limit, offset, page } = parsePagination({
    page:  String(opts.page  ?? 1),
    limit: String(opts.limit ?? 20),
  })

  const conditions: string[] = ['p.boutique_id = ?', 'p.actif = 1']
  const bindings:   any[]    = [boutiqueId]

  if (opts.categorie_id) {
    conditions.push('p.categorie_id = ?')
    bindings.push(opts.categorie_id)
  }
  if (opts.famille && FAMILLES.includes(opts.famille as FamilleProduit)) {
    conditions.push('p.famille = ?')
    bindings.push(opts.famille)
  }
  if (opts.stock_bas) {
    conditions.push('p.stock_actuel <= p.stock_minimum')
  }
  if (opts.search) {
    conditions.push('(p.nom LIKE ? OR p.sku LIKE ? OR p.marque LIKE ?)')
    const s = `%${opts.search}%`
    bindings.push(s, s, s)
  }

  const where = 'WHERE ' + conditions.join(' AND ')

  const totRow = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM produits p ${where}`)
    .bind(...bindings)
    .first<{ cnt: number }>()

  const rows = await db.prepare(`
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
    ${where}
    ORDER  BY p.nom ASC
    LIMIT ? OFFSET ?
  `).bind(...bindings, limit, offset).all()

  return {
    data: rows.results ?? [],
    pagination: {
      page,
      limit,
      total:  totRow?.cnt ?? 0,
      pages:  Math.ceil((totRow?.cnt ?? 0) / limit),
    },
  }
}

/**
 * Retourne la fiche complète d'un produit avec ses 20 derniers mouvements de stock.
 *
 * @param db  — Instance D1Database
 * @param id  — ID du produit
 * @returns   — ProduitRow enrichi avec mouvements, ou null si introuvable
 */
export async function getProduitById(
  db: D1Database,
  id: number
): Promise<any | null> {
  const produit = await db.prepare(`
    SELECT p.*,
           c.nom AS categorie_nom,
           ROUND((p.prix_vente_ht - p.prix_achat_ht) / NULLIF(p.prix_vente_ht, 0) * 100, 1) AS marge_pct
    FROM   produits p
    LEFT JOIN categories c ON c.id = p.categorie_id
    WHERE  p.id = ? AND p.actif = 1
  `).bind(id).first()

  if (!produit) return null

  const mouvements = await db.prepare(`
    SELECT m.*, u.prenom || ' ' || u.nom AS user_nom
    FROM   mouvements_stock m
    LEFT JOIN users u ON u.id = m.user_id
    WHERE  m.produit_id = ?
    ORDER  BY m.created_at DESC
    LIMIT  20
  `).bind(id).all()

  return {
    ...produit,
    mouvements: mouvements.results ?? [],
  }
}

/**
 * Crée un nouveau produit.
 * Si stock_actuel > 0, enregistre automatiquement un mouvement 'entree' (stock initial).
 *
 * @param db          — Instance D1Database
 * @param boutiqueId  — ID boutique
 * @param userId      — ID utilisateur (pour mouvement + audit)
 * @param data        — Données du produit (voir CreateProduitData)
 * @returns           — { id }
 */
export async function createProduit(
  db: D1Database,
  boutiqueId: number,
  userId: number,
  data: CreateProduitData
): Promise<{ id: number }> {
  const famille = FAMILLES.includes(data.famille as FamilleProduit)
    ? data.famille! : 'piece'

  const result = await db.prepare(`
    INSERT INTO produits
      (boutique_id, categorie_id, sku, nom, marque, famille, prix_achat_ht, prix_vente_ht, tva_taux,
       stock_actuel, stock_minimum, fournisseur, reference_fournisseur, code_barre)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    boutiqueId,
    data.categorie_id          ?? null,
    data.sku                   ?? null,
    data.nom,
    data.marque                ?? null,
    famille,
    data.prix_achat_ht         ?? 0,
    data.prix_vente_ht         ?? 0,
    data.tva_taux              ?? 20,
    data.stock_actuel          ?? 0,
    data.stock_minimum         ?? 5,
    data.fournisseur           ?? null,
    data.reference_fournisseur ?? null,
    data.code_barre            ?? null,
  ).first<{ id: number }>()

  const produitId = result!.id

  // Mouvement stock initial si stock de départ > 0
  if ((data.stock_actuel ?? 0) > 0) {
    await db.prepare(`
      INSERT INTO mouvements_stock
        (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, user_id, motif)
      VALUES (?, ?, 'entree', ?, 0, ?, ?, 'Stock initial')
    `).bind(produitId, boutiqueId, data.stock_actuel, data.stock_actuel, userId).run()
  }

  await auditLog(db, {
    boutique_id: boutiqueId,
    user_id:     userId,
    action:      'CREATE_PRODUIT',
    entite_type: 'produit',
    entite_id:   produitId,
  })

  return { id: produitId }
}

/**
 * Met à jour les champs éditables d'un produit (hors stock_actuel, géré par enregistrerMouvement).
 *
 * @param db      — Instance D1Database
 * @param id      — ID du produit
 * @param userId  — ID utilisateur (pour audit)
 * @param data    — Champs à modifier (voir UpdateProduitData)
 * @throws        — Error si produit introuvable
 */
export async function updateProduit(
  db: D1Database,
  id: number,
  userId: number,
  data: UpdateProduitData
): Promise<void> {
  const existing = await db
    .prepare('SELECT id FROM produits WHERE id = ? AND actif = 1')
    .bind(id)
    .first()
  if (!existing) throw new Error('Produit introuvable.')

  const familleUpd = data.famille && FAMILLES.includes(data.famille as FamilleProduit)
    ? data.famille : null

  await db.prepare(`
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
  `).bind(
    data.nom          ?? null,
    data.sku          ?? null,
    data.marque       ?? null,
    data.categorie_id ?? null,
    familleUpd,
    data.prix_achat_ht ?? null,
    data.prix_vente_ht ?? null,
    data.tva_taux      ?? null,
    data.stock_minimum ?? null,
    data.fournisseur  ?? null,
    data.code_barre   ?? null,
    id,
  ).run()

  await auditLog(db, {
    user_id:     userId,
    action:      'UPDATE_PRODUIT',
    entite_type: 'produit',
    entite_id:   id,
  })
}

/**
 * Soft-delete un produit (actif = 0).
 *
 * @param db      — Instance D1Database
 * @param id      — ID du produit
 * @param userId  — ID utilisateur (pour audit)
 */
export async function deleteProduit(
  db: D1Database,
  id: number,
  userId: number
): Promise<void> {
  await db
    .prepare('UPDATE produits SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(id)
    .run()

  await auditLog(db, {
    user_id:     userId,
    action:      'DELETE_PRODUIT',
    entite_type: 'produit',
    entite_id:   id,
  })
}

/**
 * Enregistre un mouvement de stock et met à jour stock_actuel du produit.
 *
 * Types de mouvement :
 *   - 'entree'     : quantite ajoutée au stock
 *   - 'sortie'     : quantite retirée du stock
 *   - 'ajustement' : quantite = valeur absolue cible (correction inventaire)
 *   - 'inventaire' : identique à ajustement
 *
 * @param db        — Instance D1Database
 * @param produitId — ID du produit concerné
 * @param userId    — ID utilisateur
 * @param m         — Données du mouvement (voir MouvementData)
 * @returns         — { stock_avant, stock_apres }
 * @throws          — Error si type invalide, stock insuffisant ou produit introuvable
 */
export async function enregistrerMouvement(
  db: D1Database,
  produitId: number,
  userId: number,
  m: MouvementData
): Promise<{ stock_avant: number; stock_apres: number }> {
  if (!TYPES_MOUVEMENT_VALIDES.includes(m.type_mouvement)) {
    throw new Error(`type_mouvement invalide. Valeurs acceptées : ${TYPES_MOUVEMENT_VALIDES.join(', ')}.`)
  }
  if (m.quantite === 0) {
    throw new Error('quantite doit être différente de 0.')
  }

  const produit = await db
    .prepare('SELECT id, stock_actuel, boutique_id FROM produits WHERE id = ? AND actif = 1')
    .bind(produitId)
    .first<{ id: number; stock_actuel: number; boutique_id: number }>()
  if (!produit) throw new Error('Produit introuvable.')

  const estAjustement = m.type_mouvement === 'ajustement' || m.type_mouvement === 'inventaire'
  const delta         = m.type_mouvement === 'sortie' ? -Math.abs(m.quantite) : Math.abs(m.quantite)
  const stockApres    = estAjustement ? m.quantite : produit.stock_actuel + delta

  if (stockApres < 0) {
    throw new Error(`Stock insuffisant. Stock actuel : ${produit.stock_actuel}.`)
  }

  // Quantité réelle pour l'historique (delta effectif sur ajustement)
  const mouvQuantite = estAjustement ? stockApres - produit.stock_actuel : delta

  await db
    .prepare('UPDATE produits SET stock_actuel = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(stockApres, produitId)
    .run()

  await db.prepare(`
    INSERT INTO mouvements_stock
      (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, ticket_id, user_id, motif)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    produitId,
    produit.boutique_id,
    m.type_mouvement,
    mouvQuantite,
    produit.stock_actuel,
    stockApres,
    m.ticket_id ?? null,
    userId,
    m.motif     ?? null,
  ).run()

  return { stock_avant: produit.stock_actuel, stock_apres: stockApres }
}

/**
 * Liste les catégories d'une boutique avec le nombre de produits actifs par catégorie.
 * Ordre : racines (parent_id NULL) en premier, puis alphabétique.
 *
 * @param db          — Instance D1Database
 * @param boutiqueId  — ID boutique
 * @returns           — Tableau de catégories avec nb_produits
 */
export async function listCategories(
  db: D1Database,
  boutiqueId: number
): Promise<any[]> {
  const rows = await db.prepare(`
    SELECT c.*, COUNT(p.id) AS nb_produits
    FROM   categories c
    LEFT JOIN produits p ON p.categorie_id = c.id AND p.actif = 1
    WHERE  c.boutique_id = ? AND c.actif = 1
    GROUP  BY c.id
    ORDER  BY c.parent_id NULLS FIRST, c.nom
  `).bind(boutiqueId).all()

  return rows.results ?? []
}

/**
 * Crée une nouvelle catégorie de produits.
 *
 * @param db          — Instance D1Database
 * @param boutiqueId  — ID boutique
 * @param data        — { nom, parent_id? }
 * @returns           — { id }
 */
export async function createCategorie(
  db: D1Database,
  boutiqueId: number,
  data: CreateCategorieData
): Promise<{ id: number }> {
  const result = await db.prepare(
    'INSERT INTO categories (boutique_id, nom, parent_id) VALUES (?, ?, ?) RETURNING id'
  ).bind(boutiqueId, data.nom, data.parent_id ?? null).first<{ id: number }>()

  return { id: result!.id }
}

/**
 * Calcule les KPIs de stock d'une boutique.
 *
// ─── Import catalogue CSV ─────────────────────────────────────────────────────

/**
 * Parse et importe un catalogue produits depuis un CSV fournisseur.
 *
 * Format CSV (1ère ligne = en-têtes, séparateur , ou ;) :
 *   sku, nom, prix_achat_ht, prix_vente_ht, stock_actuel, famille, tva_taux, marque, fournisseur
 *
 * Règles métier :
 *   - SKU connu → UPDATE (nom, prix, famille, fournisseur) + ajustement stock si différent
 *   - SKU absent/inconnu → INSERT nouveau produit
 *   - Colonne obligatoire : nom
 *   - Famille validée contre FAMILLES, défaut 'piece' si invalide
 *   - Limite 500 lignes par import (anti-abus)
 */
export async function importCatalogueCsv(
  db:         D1Database,
  boutiqueId: number,
  userId:     number,
  csvText:    string
): Promise<{ imported: number; updated: number; skipped: number; errors: string[] }> {
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (lines.length < 2) throw new Error('CSV vide ou sans données.')

  const sep = lines[0].includes(';') ? ';' : ','

  function parseLine(line: string): string[] {
    const fields: string[] = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = !inQ
      } else if (ch === sep && !inQ) {
        fields.push(cur.trim()); cur = ''
      } else {
        cur += ch
      }
    }
    fields.push(cur.trim())
    return fields
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/^\uFEFF/, '').trim())
  const idx     = (name: string) => headers.indexOf(name)

  const iSku     = idx('sku')
  const iNom     = idx('nom')
  const iPaHt    = idx('prix_achat_ht')
  const iPvHt    = idx('prix_vente_ht')
  const iStock   = idx('stock_actuel')
  const iFamille = idx('famille')
  const iTva     = idx('tva_taux')
  const iMarque  = idx('marque')
  const iFourn   = idx('fournisseur')

  if (iNom === -1) throw new Error('Colonne "nom" obligatoire introuvable dans le CSV.')

  const dataLines = lines.slice(1).filter(l => l.trim() !== '').slice(0, 500)

  let imported = 0, updated = 0, skipped = 0
  const errors: string[] = []

  for (let li = 0; li < dataLines.length; li++) {
    const row = parseLine(dataLines[li])
    const num = li + 2

    try {
      const nom = row[iNom]?.trim()
      if (!nom) { skipped++; errors.push(`Ligne ${num} : nom manquant — ignorée.`); continue }

      const sku     = iSku    >= 0 && row[iSku]?.trim()   ? row[iSku].trim()  : null
      const paHt    = iPaHt   >= 0 ? parseFloat(row[iPaHt]  ?? '0') || 0  : 0
      const pvHt    = iPvHt   >= 0 ? parseFloat(row[iPvHt]  ?? '0') || 0  : 0
      const stock   = iStock  >= 0 ? parseInt(row[iStock]   ?? '0', 10) || 0 : 0
      const tva     = iTva    >= 0 ? parseFloat(row[iTva]   ?? '20') || 20 : 20
      const marque  = iMarque >= 0 ? row[iMarque]?.trim() || null : null
      const fourn   = iFourn  >= 0 ? row[iFourn]?.trim()  || null : null
      const famRaw  = iFamille >= 0 ? row[iFamille]?.trim().toLowerCase() : ''
      const famille = FAMILLES.includes(famRaw as FamilleProduit) ? (famRaw as FamilleProduit) : 'piece'

      if (sku) {
        const existing = await db
          .prepare('SELECT id, stock_actuel FROM produits WHERE boutique_id = ? AND sku = ? AND actif = 1 LIMIT 1')
          .bind(boutiqueId, sku)
          .first<{ id: number; stock_actuel: number }>()

        if (existing) {
          await db.prepare(`
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
          `).bind(nom, famille, paHt, pvHt, tva, marque, fourn, existing.id).run()

          if (stock > 0 && stock !== existing.stock_actuel) {
            await db.prepare(`
              INSERT INTO mouvements_stock
                (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, user_id, motif)
              VALUES (?, ?, 'inventaire', ?, ?, ?, ?, 'Import catalogue CSV')
            `).bind(existing.id, boutiqueId, stock - existing.stock_actuel,
                    existing.stock_actuel, stock, userId).run()
            await db.prepare('UPDATE produits SET stock_actuel = ? WHERE id = ?')
              .bind(stock, existing.id).run()
          }

          updated++
          continue
        }
      }

      // INSERT nouveau produit
      const res = await db.prepare(`
        INSERT INTO produits
          (boutique_id, sku, nom, marque, famille, prix_achat_ht, prix_vente_ht,
           tva_taux, stock_actuel, stock_minimum, fournisseur)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 5, ?)
        RETURNING id
      `).bind(boutiqueId, sku, nom, marque, famille, paHt, pvHt, tva, stock, fourn)
        .first<{ id: number }>()

      if (res && stock > 0) {
        await db.prepare(`
          INSERT INTO mouvements_stock
            (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, user_id, motif)
          VALUES (?, ?, 'entree', ?, 0, ?, ?, 'Import catalogue CSV')
        `).bind(res.id, boutiqueId, stock, stock, userId).run()
      }

      imported++
    } catch (e: any) {
      skipped++
      errors.push(`Ligne ${num} : ${e.message}`)
    }
  }

  await auditLog(db, {
    boutique_id: boutiqueId,
    user_id:     userId,
    action:      'IMPORT_CATALOGUE_CSV',
    entite_type: 'produit',
    details:     JSON.stringify({ imported, updated, skipped }),
  })

  return { imported, updated, skipped, errors }
}

// ─── KPIs stock ───────────────────────────────────────────────────────────────

/**
 * @param db          — Instance D1Database
 * @param boutiqueId  — ID boutique
 * @returns           — { nb_produits, nb_ruptures, nb_alertes, valeur_stock_ht, valeur_stock_cump }
 */
export async function getKpisStock(
  db: D1Database,
  boutiqueId: number
): Promise<KpisStock> {
  const row = await db.prepare(`
    SELECT
      COUNT(*)                                                         AS nb_produits,
      SUM(CASE WHEN stock_actuel = 0 THEN 1 ELSE 0 END)               AS nb_ruptures,
      SUM(CASE WHEN stock_actuel > 0
               AND stock_actuel <= stock_minimum THEN 1 ELSE 0 END)   AS nb_alertes,
      ROUND(SUM(stock_actuel * prix_achat_ht), 2)                     AS valeur_stock_ht,
      ROUND(SUM(stock_actuel * prix_achat_cump), 2)                   AS valeur_stock_cump
    FROM produits
    WHERE boutique_id = ? AND actif = 1
  `).bind(boutiqueId).first<any>()

  return {
    nb_produits:       row?.nb_produits      ?? 0,
    nb_ruptures:       row?.nb_ruptures       ?? 0,
    nb_alertes:        row?.nb_alertes        ?? 0,
    valeur_stock_ht:   row?.valeur_stock_ht   ?? 0,
    valeur_stock_cump: row?.valeur_stock_cump ?? 0,
  }
}
