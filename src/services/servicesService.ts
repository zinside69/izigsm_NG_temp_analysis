/**
 * services/servicesService.ts — Logique métier : Catalogue services hiérarchique
 * Rôle architectural (P3 BFF Hono) : Model — accès D1, calculs, requêtes SQL.
 * Les routes ne contiennent aucun SQL — elles délèguent à ce service.
 */

import { parsePagination, auditLog, calculTva } from '../lib/db'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CategorieService {
  id:          number
  boutique_id: number
  parent_id:   number | null
  nom:         string
  description: string | null
  couleur:     string
  ordre:       number
  actif:       number
}

export interface Service {
  id:             number
  boutique_id:    number
  categorie_id:   number | null
  nom:            string
  description:    string | null
  prix_ht:        number
  tva_taux:       number
  prix_ttc:       number
  duree_minutes:  number | null
  reference:      string | null
  garantie_jours: number
  actif:          number
}

// ─── Catégories ───────────────────────────────────────────────────────────────

/**
 * Retourne toutes les catégories d'une boutique (arbre aplati, triées par ordre).
 * Inclut le nombre de services actifs par catégorie.
 */
export async function listCategories(
  db: D1Database, boutiqueId: number
): Promise<CategorieService[]> {
  const rows = await db.prepare(`
    SELECT c.*,
           COUNT(s.id) as nb_services
    FROM   categories_services c
    LEFT JOIN services s ON s.categorie_id = c.id AND s.actif = 1
    WHERE  c.boutique_id = ? AND c.actif = 1
    GROUP  BY c.id
    ORDER  BY c.parent_id NULLS FIRST, c.ordre ASC, c.nom ASC
  `).bind(boutiqueId).all()
  return rows.results as CategorieService[]
}

/**
 * Crée une catégorie de service.
 * @returns id de la catégorie créée
 */
export async function createCategorie(
  db: D1Database,
  data: { boutique_id: number; nom: string; parent_id?: number | null; description?: string; couleur?: string; ordre?: number },
  userId: number
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO categories_services (boutique_id, nom, parent_id, description, couleur, ordre)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    data.boutique_id,
    data.nom.trim(),
    data.parent_id   ?? null,
    data.description ?? null,
    data.couleur     ?? '#6366f1',
    data.ordre       ?? 0
  ).first<{ id: number }>()

  await auditLog(db, { boutique_id: data.boutique_id, user_id: userId, action: 'CREATE_CATEGORIE_SERVICE', entite_type: 'categorie_service', entite_id: result?.id })
  return result?.id ?? 0
}

/**
 * Met à jour une catégorie de service.
 */
export async function updateCategorie(
  db: D1Database,
  id: number,
  data: { nom?: string; parent_id?: number | null; description?: string; couleur?: string; ordre?: number },
  userId: number
): Promise<void> {
  await db.prepare(`
    UPDATE categories_services
    SET nom         = COALESCE(?, nom),
        parent_id   = ?,
        description = COALESCE(?, description),
        couleur     = COALESCE(?, couleur),
        ordre       = COALESCE(?, ordre),
        updated_at  = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    data.nom         ?? null,
    data.parent_id   !== undefined ? data.parent_id : null,
    data.description ?? null,
    data.couleur     ?? null,
    data.ordre       ?? null,
    id
  ).run()
  await auditLog(db, { user_id: userId, action: 'UPDATE_CATEGORIE_SERVICE', entite_type: 'categorie_service', entite_id: id })
}

/**
 * Désactive (soft delete) une catégorie.
 * Désactive aussi tous les services de cette catégorie.
 */
export async function deleteCategorie(
  db: D1Database, id: number, userId: number
): Promise<void> {
  await db.prepare(`UPDATE services SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE categorie_id = ?`).bind(id).run()
  await db.prepare(`UPDATE categories_services SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run()
  await auditLog(db, { user_id: userId, action: 'DELETE_CATEGORIE_SERVICE', entite_type: 'categorie_service', entite_id: id })
}

// ─── Services (prestations) ───────────────────────────────────────────────────

/**
 * Liste les services d'une boutique avec pagination et filtres.
 * Calcule prix_ttc à la volée.
 */
export async function listServices(
  db: D1Database,
  boutiqueId: number,
  query: Record<string, string>
) {
  const { limit, offset, page } = parsePagination(query)

  const conditions = ['s.boutique_id = ?', 's.actif = 1']
  const bindings: any[] = [boutiqueId]

  if (query.categorie_id) {
    conditions.push('s.categorie_id = ?')
    bindings.push(parseInt(query.categorie_id, 10))
  }
  if (query.search) {
    conditions.push('(s.nom LIKE ? OR s.reference LIKE ? OR s.description LIKE ?)')
    const q = `%${query.search}%`
    bindings.push(q, q, q)
  }

  const where = 'WHERE ' + conditions.join(' AND ')

  const total = await db.prepare(
    `SELECT COUNT(*) as cnt FROM services s ${where}`
  ).bind(...bindings).first<{ cnt: number }>()

  const rows = await db.prepare(`
    SELECT s.*,
           ROUND(s.prix_ht * (1 + s.tva_taux / 100), 2) as prix_ttc,
           c.nom   as categorie_nom,
           c.couleur as categorie_couleur
    FROM   services s
    LEFT JOIN categories_services c ON c.id = s.categorie_id
    ${where}
    ORDER  BY c.ordre ASC, c.nom ASC, s.nom ASC
    LIMIT ? OFFSET ?
  `).bind(...bindings, limit, offset).all()

  return {
    data:       rows.results,
    pagination: { page, limit, total: total?.cnt ?? 0, pages: Math.ceil((total?.cnt ?? 0) / limit) }
  }
}

/**
 * Retourne un service par son id avec sa catégorie.
 */
export async function getService(
  db: D1Database, id: number
): Promise<Service | null> {
  const row = await db.prepare(`
    SELECT s.*,
           ROUND(s.prix_ht * (1 + s.tva_taux / 100), 2) as prix_ttc,
           c.nom    as categorie_nom,
           c.couleur as categorie_couleur
    FROM   services s
    LEFT JOIN categories_services c ON c.id = s.categorie_id
    WHERE  s.id = ? AND s.actif = 1
  `).bind(id).first()
  return (row as Service) ?? null
}

/**
 * Crée un service dans le catalogue.
 * @returns id du service créé
 */
export async function createService(
  db: D1Database,
  data: {
    boutique_id: number; categorie_id?: number | null; nom: string; description?: string
    prix_ht: number; tva_taux?: number; duree_minutes?: number; reference?: string; garantie_jours?: number
  },
  userId: number
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO services
      (boutique_id, categorie_id, nom, description, prix_ht, tva_taux, duree_minutes, reference, garantie_jours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    data.boutique_id,
    data.categorie_id    ?? null,
    data.nom.trim(),
    data.description     ?? null,
    data.prix_ht,
    data.tva_taux        ?? 20,
    data.duree_minutes   ?? null,
    data.reference       ?? null,
    data.garantie_jours  ?? 0
  ).first<{ id: number }>()

  await auditLog(db, { boutique_id: data.boutique_id, user_id: userId, action: 'CREATE_SERVICE', entite_type: 'service', entite_id: result?.id })
  return result?.id ?? 0
}

/**
 * Met à jour un service existant.
 */
export async function updateService(
  db: D1Database,
  id: number,
  data: {
    categorie_id?: number | null; nom?: string; description?: string
    prix_ht?: number; tva_taux?: number; duree_minutes?: number; reference?: string; garantie_jours?: number
  },
  userId: number
): Promise<void> {
  await db.prepare(`
    UPDATE services SET
      categorie_id    = COALESCE(?, categorie_id),
      nom             = COALESCE(?, nom),
      description     = COALESCE(?, description),
      prix_ht         = COALESCE(?, prix_ht),
      tva_taux        = COALESCE(?, tva_taux),
      duree_minutes   = COALESCE(?, duree_minutes),
      reference       = COALESCE(?, reference),
      garantie_jours  = COALESCE(?, garantie_jours),
      updated_at      = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    data.categorie_id   ?? null,
    data.nom?.trim()    ?? null,
    data.description    ?? null,
    data.prix_ht        ?? null,
    data.tva_taux       ?? null,
    data.duree_minutes  ?? null,
    data.reference      ?? null,
    data.garantie_jours ?? null,
    id
  ).run()
  await auditLog(db, { user_id: userId, action: 'UPDATE_SERVICE', entite_type: 'service', entite_id: id })
}

/**
 * Désactive (soft delete) un service.
 */
export async function deleteService(
  db: D1Database, id: number, userId: number
): Promise<void> {
  await db.prepare(`UPDATE services SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run()
  await auditLog(db, { user_id: userId, action: 'DELETE_SERVICE', entite_type: 'service', entite_id: id })
}

/**
 * Retourne le catalogue complet structuré en arbre (catégories + leurs services).
 * Utilisé par le frontend pour afficher l'arborescence.
 */
export async function getCatalogueArbre(
  db: D1Database, boutiqueId: number
): Promise<object[]> {
  const [categories, services] = await Promise.all([
    db.prepare(`
      SELECT * FROM categories_services
      WHERE boutique_id = ? AND actif = 1
      ORDER BY parent_id NULLS FIRST, ordre ASC, nom ASC
    `).bind(boutiqueId).all(),
    db.prepare(`
      SELECT s.*, ROUND(s.prix_ht * (1 + s.tva_taux / 100), 2) as prix_ttc
      FROM   services s
      WHERE  s.boutique_id = ? AND s.actif = 1
      ORDER  BY s.nom ASC
    `).bind(boutiqueId).all()
  ])

  const cats = categories.results as any[]
  const svcs = services.results as any[]

  // Construire arbre : parents → enfants → services
  const racines = cats.filter(c => !c.parent_id).map(parent => ({
    ...parent,
    enfants:  cats.filter(c => c.parent_id === parent.id).map(enfant => ({
      ...enfant,
      services: svcs.filter(s => s.categorie_id === enfant.id)
    })),
    services: svcs.filter(s => s.categorie_id === parent.id)
  }))

  return racines
}
