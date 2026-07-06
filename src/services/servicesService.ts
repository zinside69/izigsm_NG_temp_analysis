/**
 * @module servicesService
 * @description Model P1 : Catalogue de prestations hiérarchique (catégories + services)
 *              + Référentiel marques/modèles d'appareils avec liaison services suggérés.
 *
 * Rôle architectural (P1 MVC) : Model exclusif — tout le SQL ici.
 * Les routes `src/routes/services.ts` délèguent sans aucun `.prepare()`.
 *
 * Structure hiérarchique :
 *   Catégorie parente → Sous-catégories → Services (prestations)
 *   Exemple : "Téléphones" → "Apple" → "Remplacement écran iPhone 14"
 *
 * `getCatalogueArbre()` retourne la structure complète en mémoire :
 *   ```
 *   [
 *     { ...cat_parent, enfants: [...sous_cats], services: [...svc_direct] },
 *     ...
 *   ]
 *   ```
 *
 * Prix :
 *   `prix_ht` est stocké en base. `prix_ttc` est calculé à la volée :
 *   `prix_ttc = ROUND(prix_ht * (1 + tva_taux / 100), 2)`
 *
 * Soft delete cascade :
 *   La suppression d'une catégorie désactive aussi tous ses services.
 *
 * Sprint 2.4 — MOD-04 Catalogue services
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
 * Retourne toutes les catégories d'une boutique sous forme aplatie (pas arborescente).
 * Triées par `parent_id NULLS FIRST` puis `ordre` puis `nom` (racines en premier).
 * Inclut le nombre de services actifs associés à chaque catégorie.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @returns           Liste plate de `CategorieService` avec `nb_services`
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
 * Crée une catégorie de service (racine ou sous-catégorie).
 *
 * @param db      Binding D1 Cloudflare
 * @param data    `{ boutique_id, nom, parent_id?, description?, couleur?, ordre? }`
 *                — `couleur` par défaut `#6366f1` (indigo), `ordre` par défaut 0
 * @param userId  Identifiant de l'utilisateur (pour audit log)
 * @returns       Identifiant de la catégorie créée
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
 * Met à jour les champs d'une catégorie de service.
 *
 * ATTENTION : `parent_id` peut être `null` (déplacer vers la racine).
 * Utilise `?? null` (pas `COALESCE`) pour permettre la nullification explicite.
 *
 * @param db      Binding D1 Cloudflare
 * @param id      Identifiant de la catégorie
 * @param data    Champs à modifier (tous optionnels)
 * @param userId  Identifiant de l'utilisateur (pour audit log)
 * @returns       void
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
 * Désactive une catégorie (soft delete) et tous ses services en cascade.
 * Les données sont conservées en base — seul `actif = 0` est positionné.
 *
 * @param db      Binding D1 Cloudflare
 * @param id      Identifiant de la catégorie
 * @param userId  Identifiant de l'utilisateur (pour audit log)
 * @returns       void
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
 * Liste paginée des services d'une boutique avec filtres et enrichissement catégorie.
 * `prix_ttc` est calculé à la volée : `ROUND(prix_ht * (1 + tva_taux / 100), 2)`.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param query       Filtres : `categorie_id`, `search` (nom/référence/description), `page`, `limit`
 * @returns           `{ data: Service[], pagination }` enrichi avec `categorie_nom`, `categorie_couleur`
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
 * Récupère un service par son identifiant avec les infos de catégorie.
 * `prix_ttc` calculé à la volée.
 *
 * @param db  Binding D1 Cloudflare
 * @param id  Identifiant du service
 * @returns   `Service` enrichi ou `null` si introuvable / soft-deleted
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
 * Crée un service dans le catalogue de prestations.
 *
 * @param db      Binding D1 Cloudflare
 * @param data    `{ boutique_id, nom, prix_ht, categorie_id?, tva_taux?, duree_minutes?, reference?, garantie_jours? }`
 *                — `tva_taux` par défaut 20%, `garantie_jours` par défaut 0
 * @param userId  Identifiant de l'utilisateur (pour audit log)
 * @returns       Identifiant du service créé
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
 * Met à jour les champs d'un service (PATCH partiel via COALESCE).
 *
 * @param db      Binding D1 Cloudflare
 * @param id      Identifiant du service
 * @param data    Champs à modifier (tous optionnels)
 * @param userId  Identifiant de l'utilisateur (pour audit log)
 * @returns       void
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
 * Désactive un service (soft delete — `actif = 0`).
 *
 * @param db      Binding D1 Cloudflare
 * @param id      Identifiant du service
 * @param userId  Identifiant de l'utilisateur (pour audit log)
 * @returns       void
 */
export async function deleteService(
  db: D1Database, id: number, userId: number
): Promise<void> {
  await db.prepare(`UPDATE services SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run()
  await auditLog(db, { user_id: userId, action: 'DELETE_SERVICE', entite_type: 'service', entite_id: id })
}

/**
 * Retourne le catalogue complet sous forme d'arbre hiérarchique en mémoire.
 * Exécute 2 requêtes en parallèle (catégories + services) via `Promise.all`.
 *
 * Structure retournée :
 * ```
 * [
 *   {
 *     ...categorie_parente,
 *     enfants: [{ ...sous_cat, services: [Service, ...] }],
 *     services: [Service, ...]  // services directement rattachés au parent
 *   },
 *   ...
 * ]
 * ```
 *
 * `prix_ttc` calculé à la volée pour chaque service.
 * Les catégories orphelines (parent inexistant) sont ignorées dans l'arbre.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @returns           Arbre hiérarchique des catégories et services
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

// ─── Marques d'appareils ──────────────────────────────────────────────────────

export interface MarqueAppareil {
  id:          number
  boutique_id: number
  nom:         string
  logo_url:    string | null
  ordre:       number
  actif:       number
  nb_modeles?: number
}

export interface ModeleAppareil {
  id:          number
  boutique_id: number
  marque_id:   number
  marque_nom?: string
  nom:         string
  type:        string
  annee:       number | null
  actif:       number
}

/**
 * Liste toutes les marques actives d'une boutique, triées par `ordre` puis `nom`.
 * Inclut le compte de modèles actifs associés (`nb_modeles`).
 */
export async function listMarques(
  db: D1Database, boutiqueId: number
): Promise<MarqueAppareil[]> {
  const rows = await db.prepare(`
    SELECT m.*,
           COUNT(mo.id) AS nb_modeles
    FROM   marques_appareils m
    LEFT JOIN modeles_appareils mo ON mo.marque_id = m.id AND mo.actif = 1
    WHERE  m.boutique_id = ? AND m.actif = 1
    GROUP  BY m.id
    ORDER  BY m.ordre ASC, m.nom ASC
  `).bind(boutiqueId).all()
  return rows.results as MarqueAppareil[]
}

/**
 * Crée une marque d'appareil.
 * Contrainte UNIQUE (boutique_id, nom) — lève une erreur si doublon.
 */
export async function createMarque(
  db: D1Database,
  data: { boutique_id: number; nom: string; logo_url?: string; ordre?: number },
  userId: number
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO marques_appareils (boutique_id, nom, logo_url, ordre)
    VALUES (?, ?, ?, ?)
    RETURNING id
  `).bind(
    data.boutique_id,
    data.nom.trim(),
    data.logo_url ?? null,
    data.ordre    ?? 0
  ).first<{ id: number }>()

  await auditLog(db, { boutique_id: data.boutique_id, user_id: userId, action: 'CREATE_MARQUE', entite_type: 'marque_appareil', entite_id: result?.id })
  return result?.id ?? 0
}

/**
 * Met à jour une marque (PATCH partiel via COALESCE).
 */
export async function updateMarque(
  db: D1Database,
  id: number,
  data: { nom?: string; logo_url?: string | null; ordre?: number },
  userId: number
): Promise<void> {
  await db.prepare(`
    UPDATE marques_appareils
    SET nom        = COALESCE(?, nom),
        logo_url   = COALESCE(?, logo_url),
        ordre      = COALESCE(?, ordre),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(data.nom?.trim() ?? null, data.logo_url ?? null, data.ordre ?? null, id).run()
  await auditLog(db, { user_id: userId, action: 'UPDATE_MARQUE', entite_type: 'marque_appareil', entite_id: id })
}

/**
 * Désactive une marque et tous ses modèles (soft delete cascade).
 */
export async function deleteMarque(
  db: D1Database, id: number, userId: number
): Promise<void> {
  await db.prepare(`UPDATE modeles_appareils SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE marque_id = ?`).bind(id).run()
  await db.prepare(`UPDATE marques_appareils SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run()
  await auditLog(db, { user_id: userId, action: 'DELETE_MARQUE', entite_type: 'marque_appareil', entite_id: id })
}

// ─── Modèles d'appareils ──────────────────────────────────────────────────────

/**
 * Liste les modèles actifs d'une boutique.
 * Filtrage optionnel par `marque_id` ou `search` (nom).
 * Retourne `marque_nom` en jointure.
 */
export async function listModeles(
  db: D1Database,
  boutiqueId: number,
  query: { marque_id?: number; search?: string; type?: string } = {}
): Promise<ModeleAppareil[]> {
  const conditions = ['mo.boutique_id = ?', 'mo.actif = 1']
  const bindings: any[] = [boutiqueId]

  if (query.marque_id) {
    conditions.push('mo.marque_id = ?')
    bindings.push(query.marque_id)
  }
  if (query.type) {
    conditions.push('mo.type = ?')
    bindings.push(query.type)
  }
  if (query.search) {
    conditions.push('(mo.nom LIKE ? OR ma.nom LIKE ?)')
    const s = `%${query.search}%`
    bindings.push(s, s)
  }

  const rows = await db.prepare(`
    SELECT mo.*,
           ma.nom AS marque_nom
    FROM   modeles_appareils mo
    JOIN   marques_appareils ma ON ma.id = mo.marque_id
    WHERE  ${conditions.join(' AND ')}
    ORDER  BY ma.nom ASC, mo.nom ASC
  `).bind(...bindings).all()

  return rows.results as ModeleAppareil[]
}

/**
 * Crée un modèle rattaché à une marque.
 * Contrainte UNIQUE (boutique_id, marque_id, nom).
 */
export async function createModele(
  db: D1Database,
  data: { boutique_id: number; marque_id: number; nom: string; type?: string; annee?: number },
  userId: number
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO modeles_appareils (boutique_id, marque_id, nom, type, annee)
    VALUES (?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    data.boutique_id,
    data.marque_id,
    data.nom.trim(),
    data.type  ?? 'smartphone',
    data.annee ?? null
  ).first<{ id: number }>()

  await auditLog(db, { boutique_id: data.boutique_id, user_id: userId, action: 'CREATE_MODELE', entite_type: 'modele_appareil', entite_id: result?.id })
  return result?.id ?? 0
}

/**
 * Met à jour un modèle (PATCH partiel).
 */
export async function updateModele(
  db: D1Database,
  id: number,
  data: { nom?: string; type?: string; annee?: number | null },
  userId: number
): Promise<void> {
  await db.prepare(`
    UPDATE modeles_appareils
    SET nom        = COALESCE(?, nom),
        type       = COALESCE(?, type),
        annee      = COALESCE(?, annee),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(data.nom?.trim() ?? null, data.type ?? null, data.annee ?? null, id).run()
  await auditLog(db, { user_id: userId, action: 'UPDATE_MODELE', entite_type: 'modele_appareil', entite_id: id })
}

/**
 * Désactive un modèle (soft delete).
 * Les liaisons service_modeles sont désactivées en cascade via la FK ON DELETE CASCADE.
 */
export async function deleteModele(
  db: D1Database, id: number, userId: number
): Promise<void> {
  await db.prepare(`UPDATE modeles_appareils SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run()
  await auditLog(db, { user_id: userId, action: 'DELETE_MODELE', entite_type: 'modele_appareil', entite_id: id })
}

// ─── Liaison service ↔ modèle ─────────────────────────────────────────────────

/**
 * Retourne les services suggérés pour un modèle d'appareil donné.
 * Utilisé lors de la création d'un ticket pour pré-remplir les prestations.
 * `prix_ht_effectif` = prix override si défini, sinon prix catalogue.
 */
export async function getServicesByModele(
  db: D1Database, modeleId: number
): Promise<object[]> {
  const rows = await db.prepare(`
    SELECT s.id,
           s.nom,
           s.description,
           s.reference,
           s.tva_taux,
           s.garantie_jours,
           s.duree_minutes,
           COALESCE(sm.prix_ht_specifique, s.prix_ht) AS prix_ht_effectif,
           ROUND(COALESCE(sm.prix_ht_specifique, s.prix_ht) * (1 + s.tva_taux / 100), 2) AS prix_ttc_effectif,
           sm.prix_ht_specifique,
           c.nom    AS categorie_nom,
           c.couleur AS categorie_couleur
    FROM   service_modeles sm
    JOIN   services s  ON s.id = sm.service_id AND s.actif = 1
    LEFT JOIN categories_services c ON c.id = s.categorie_id
    WHERE  sm.modele_id = ? AND sm.actif = 1
    ORDER  BY c.nom ASC, s.nom ASC
  `).bind(modeleId).all()
  return rows.results
}

/**
 * Associe un service à un modèle (avec prix override optionnel).
 * Idempotent : si la liaison existe déjà (même inactif), la réactive et met à jour le prix.
 */
export async function linkServiceModele(
  db: D1Database,
  data: { service_id: number; modele_id: number; prix_ht_specifique?: number | null },
  userId: number
): Promise<void> {
  await db.prepare(`
    INSERT INTO service_modeles (service_id, modele_id, prix_ht_specifique, actif)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(service_id, modele_id) DO UPDATE SET
      prix_ht_specifique = excluded.prix_ht_specifique,
      actif              = 1,
      created_at         = created_at
  `).bind(data.service_id, data.modele_id, data.prix_ht_specifique ?? null).run()
  await auditLog(db, { user_id: userId, action: 'LINK_SERVICE_MODELE', entite_type: 'service_modele', entite_id: data.modele_id, meta: { service_id: data.service_id } })
}

/**
 * Dissocie un service d'un modèle (soft delete via actif = 0).
 */
export async function unlinkServiceModele(
  db: D1Database,
  data: { service_id: number; modele_id: number },
  userId: number
): Promise<void> {
  await db.prepare(`
    UPDATE service_modeles SET actif = 0
    WHERE service_id = ? AND modele_id = ?
  `).bind(data.service_id, data.modele_id).run()
  await auditLog(db, { user_id: userId, action: 'UNLINK_SERVICE_MODELE', entite_type: 'service_modele', entite_id: data.modele_id, meta: { service_id: data.service_id } })
}

/**
 * Retourne toutes les liaisons service_modeles d'un modèle
 * sous forme plate (service_id + nom + prix_ht_specifique + actif).
 * Utile pour afficher la liste des services configurés dans l'UI.
 */
export async function getModeleWithServices(
  db: D1Database, modeleId: number
): Promise<{ modele: ModeleAppareil | null; services: object[] }> {
  const [modeleRow, services] = await Promise.all([
    db.prepare(`
      SELECT mo.*, ma.nom AS marque_nom
      FROM   modeles_appareils mo
      JOIN   marques_appareils ma ON ma.id = mo.marque_id
      WHERE  mo.id = ? AND mo.actif = 1
    `).bind(modeleId).first(),
    getServicesByModele(db, modeleId)
  ])
  return { modele: modeleRow as ModeleAppareil ?? null, services }
}
