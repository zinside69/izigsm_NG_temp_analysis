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
 *   AVANT (2026-10-06, ticket 04 prix TTC — le TTC est stocké et fait foi) :
 *   `prix_ht` est stocké en base. `prix_ttc` est calculé à la volée :
 *   `prix_ttc = ROUND(prix_ht * (1 + tva_taux / 100), 2)`
 *   Depuis la migration 0064 : `prix_ttc` est stocké et fait foi (décision Q1), `prix_ht` en est déduit
 *   et reste écrit. Même chose pour un prix par modèle (`prix_ttc_specifique`, au taux du service).
 *
 * Soft delete cascade :
 *   La suppression d'une catégorie désactive aussi tous ses services.
 *
 * Sprint 2.4 — MOD-04 Catalogue services
 */

import { parsePagination, auditLog, calculTva } from '../lib/db'
import { prixDeVenteACreer, prixDeVenteAModifier, prixTtcDepuisHt, estUnNombreFini } from '../lib/prixVente'
import type { Database } from '../ports/database'

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
  db: Database, boutiqueId: number
): Promise<CategorieService[]> {
  return db.all<CategorieService>(`
    SELECT c.*,
           COUNT(s.id) as nb_services
    FROM   categories_services c
    LEFT JOIN services s ON s.categorie_id = c.id AND s.actif = 1
    WHERE  c.boutique_id = ? AND c.actif = 1
    GROUP  BY c.id
    ORDER  BY c.parent_id NULLS FIRST, c.ordre ASC, c.nom ASC
  `, [boutiqueId])
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

/**
 * Retourne uniquement le `boutique_id` d'une catégorie de services.
 * Utilisé par la garde d'isolation de `PUT/DELETE /services/categories/:id`
 * (`routes/services.ts`), sur le modèle de `getBonCommandeBoutiqueId()`
 * (`services/fournisseursService.ts`) et `getTicketBoutiqueId()`
 * (`services/ticketService.ts`) — évite de charger une catégorie complète
 * juste pour vérifier l'appartenance.
 *
 * @param db  Port Database
 * @param id  Identifiant de la catégorie
 * @returns   `{ boutique_id }` ou `null` si introuvable
 */
export async function getCategorieBoutiqueId(
  db: Database, id: number
): Promise<{ boutique_id: number } | null> {
  return db.get<{ boutique_id: number }>('SELECT boutique_id FROM categories_services WHERE id = ?', [id])
}

// ─── Services (prestations) ───────────────────────────────────────────────────

/**
 * Liste paginée des services d'une boutique avec filtres et enrichissement catégorie.
 * AVANT (2026-10-06, ticket 04 prix TTC), ligne de cette documentation :
 *   * `prix_ttc` est calculé à la volée : `ROUND(prix_ht * (1 + tva_taux / 100), 2)`.
 * Depuis : `prix_ttc` est la colonne stockée (migration 0064), qui fait foi.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param query       Filtres : `categorie_id`, `search` (nom/référence/description), `page`, `limit`
 * @returns           `{ data: Service[], pagination }` enrichi avec `categorie_nom`, `categorie_couleur`
 */
export async function listServices(
  db: Database,
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

  const total = await db.get<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM services s ${where}`, bindings
  )

  // `s.*` porte `prix_ttc` stocké (migration 0064)
  // AVANT (2026-10-06, ticket 04 prix TTC — TTC stocké, plus recalculé), ligne retirée de la requête :
  //            ROUND(s.prix_ht * (1 + s.tva_taux / 100), 2) as prix_ttc,
  const rows = await db.all(`
    SELECT s.*,
           c.nom   as categorie_nom,
           c.couleur as categorie_couleur
    FROM   services s
    LEFT JOIN categories_services c ON c.id = s.categorie_id
    ${where}
    ORDER  BY c.ordre ASC, c.nom ASC, s.nom ASC
    LIMIT ? OFFSET ?
  `, [...bindings, limit, offset])

  return {
    data:       rows,
    pagination: { page, limit, total: total?.cnt ?? 0, pages: Math.ceil((total?.cnt ?? 0) / limit) }
  }
}

/**
 * Récupère un service par son identifiant avec les infos de catégorie.
 * AVANT (2026-10-06, ticket 04 prix TTC), ligne de cette documentation :
 *   * `prix_ttc` calculé à la volée.
 * Depuis : `prix_ttc` stocké (migration 0064).
 *
 * @param db  Binding D1 Cloudflare
 * @param id  Identifiant du service
 * @returns   `Service` enrichi ou `null` si introuvable / soft-deleted
 */
export async function getService(
  db: Database, id: number
): Promise<Service | null> {
  // `s.*` porte `prix_ttc` stocké (migration 0064)
  // AVANT (2026-10-06, ticket 04 prix TTC — TTC stocké, plus recalculé), ligne retirée de la requête :
  //            ROUND(s.prix_ht * (1 + s.tva_taux / 100), 2) as prix_ttc,
  return db.get<Service>(`
    SELECT s.*,
           c.nom    as categorie_nom,
           c.couleur as categorie_couleur
    FROM   services s
    LEFT JOIN categories_services c ON c.id = s.categorie_id
    WHERE  s.id = ? AND s.actif = 1
  `, [id])
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
  // AVANT (2026-10-06, ticket 04 prix TTC — le TTC fait foi ; le HT seul reste accepté en transition) :
  //     prix_ht: number; tva_taux?: number; duree_minutes?: number; reference?: string; garantie_jours?: number
  data: {
    boutique_id: number; categorie_id?: number | null; nom: string; description?: string
    prix_ht?: number; prix_ttc?: number; tva_taux?: number; duree_minutes?: number; reference?: string; garantie_jours?: number
  },
  userId: number
): Promise<number> {
  // Taux en nombre : un « 10 » reçu en texte se concaténerait dans (100 + taux) — revue du ticket 04
  const tauxTva = tauxEnNombre(data.tva_taux) ?? 20
  // TTC prioritaire, sinon HT converti (ancien écran) : même règle que les pièces (ticket 01)
  const prix = prixDeVenteACreer(data.prix_ttc, data.prix_ht, tauxTva)

  // AVANT (2026-10-06, ticket 04 prix TTC — prix HT déduit, prix_ttc ajouté en fin de liste) :
  //     (boutique_id, categorie_id, nom, description, prix_ht, tva_taux, duree_minutes, reference, garantie_jours)
  //   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  //     data.prix_ht,
  //     data.tva_taux        ?? 20,
  //     data.garantie_jours  ?? 0
  const result = await db.prepare(`
    INSERT INTO services
      (boutique_id, categorie_id, nom, description, prix_ht, tva_taux, duree_minutes, reference, garantie_jours,
       prix_ttc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    data.boutique_id,
    data.categorie_id    ?? null,
    data.nom.trim(),
    data.description     ?? null,
    prix.ht,
    tauxTva,
    data.duree_minutes   ?? null,
    data.reference       ?? null,
    data.garantie_jours  ?? 0,
    prix.ttc
  ).first<{ id: number }>()

  await auditLog(db, { boutique_id: data.boutique_id, user_id: userId, action: 'CREATE_SERVICE', entite_type: 'service', entite_id: result?.id })
  return result?.id ?? 0
}

/** Un taux de TVA reçu (nombre ou texte numérique) en nombre ; absent → `undefined`. */
function tauxEnNombre(taux: unknown): number | undefined {
  const tauxAbsent = taux === undefined || taux === null || taux === ''
  if (tauxAbsent) return undefined
  return Number(taux)
}

/**
 * Prix par modèle d'un service dont le taux change (Q20) : chaque HT spécifique est gardé, son TTC
 * recalculé au nouveau taux par `prixTtcDepuisHt()` — jamais un second calcul en SQL.
 */
async function recalculerPrixParModele(db: D1Database, serviceId: number, nouveauTaux: number): Promise<void> {
  const prixParModele = await db.prepare(`
    SELECT modele_id, prix_ht_specifique
    FROM   service_modeles
    WHERE  service_id = ?
      AND  prix_ht_specifique IS NOT NULL   -- NULL = le prix du service s'applique, rien à recalculer
  `).bind(serviceId).all<{ modele_id: number; prix_ht_specifique: number }>()

  for (const prix of prixParModele.results ?? []) {
    await db.prepare('UPDATE service_modeles SET prix_ttc_specifique = ? WHERE service_id = ? AND modele_id = ?')
      .bind(prixTtcDepuisHt(prix.prix_ht_specifique, nouveauTaux), serviceId, prix.modele_id).run()
  }
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
  // AVANT (2026-10-06, ticket 04 prix TTC — `prix_ttc` accepté, prioritaire sur `prix_ht`) :
  //     prix_ht?: number; tva_taux?: number; duree_minutes?: number; reference?: string; garantie_jours?: number
  data: {
    categorie_id?: number | null; nom?: string; description?: string
    prix_ht?: number; prix_ttc?: number; tva_taux?: number; duree_minutes?: number; reference?: string; garantie_jours?: number
  },
  userId: number
): Promise<void> {
  // Taux en nombre : un « 10 » reçu en texte se concaténerait dans (100 + taux) — revue du ticket 04
  const tauxEnvoye = tauxEnNombre(data.tva_taux)
  const unPrixOuUnTauxEstEnvoye =
    data.prix_ttc !== undefined || data.prix_ht !== undefined || tauxEnvoye !== undefined

  // null = ni prix ni taux changé : les colonnes de prix restent telles quelles (COALESCE)
  let nouveauPrix: { ttc: number; ht: number } | null = null
  let tauxChange = false
  if (unPrixOuUnTauxEstEnvoye) {
    // Prix et taux actuels, relus en base : la règle de modification en dépend (Q20, TTC renvoyé à l'identique)
    const actuel = await db.prepare('SELECT prix_ht, tva_taux, prix_ttc FROM services WHERE id = ?')
      .bind(id).first<{ prix_ht: number; tva_taux: number; prix_ttc: number }>()
    if (actuel) {
      nouveauPrix = prixDeVenteAModifier(data.prix_ttc, data.prix_ht, tauxEnvoye,
        { ht: actuel.prix_ht, tauxTva: actuel.tva_taux, ttc: actuel.prix_ttc })
      tauxChange = tauxEnvoye !== undefined && tauxEnvoye !== actuel.tva_taux
    }
  }

  // AVANT (2026-10-06, ticket 04 prix TTC — prix écrits depuis prixDeVenteAModifier(), TTC compris ;
  // taux écrit en nombre) :
  //       prix_ht         = COALESCE(?, prix_ht),
  //     data.prix_ht        ?? null,
  //     data.tva_taux       ?? null,
  await db.prepare(`
    UPDATE services SET
      categorie_id    = COALESCE(?, categorie_id),
      nom             = COALESCE(?, nom),
      description     = COALESCE(?, description),
      prix_ht         = COALESCE(?, prix_ht),
      prix_ttc        = COALESCE(?, prix_ttc),
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
    nouveauPrix?.ht     ?? null,
    nouveauPrix?.ttc    ?? null,
    tauxEnvoye          ?? null,
    data.duree_minutes  ?? null,
    data.reference      ?? null,
    data.garantie_jours ?? null,
    id
  ).run()

  // Taux du service changé : ses prix par modèle suivent la même règle (Q20) — HT gardé, TTC recalculé
  // au nouveau taux par `prixTtcDepuisHt()`, seul point des conversions. Un prix spécifique NULL reste NULL.
  if (tauxChange) {
    await recalculerPrixParModele(db, id, tauxEnvoye as number)
  }
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
 * AVANT (2026-10-06, ticket 04 prix TTC), ligne de cette documentation :
 *   * `prix_ttc` calculé à la volée pour chaque service.
 * Depuis : `prix_ttc` stocké pour chaque service (migration 0064).
 * Les catégories orphelines (parent inexistant) sont ignorées dans l'arbre.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @returns           Arbre hiérarchique des catégories et services
 */
export async function getCatalogueArbre(
  db: Database, boutiqueId: number
): Promise<object[]> {
  const [cats, svcs] = await Promise.all([
    db.all<any>(`
      SELECT * FROM categories_services
      WHERE boutique_id = ? AND actif = 1
      ORDER BY parent_id NULLS FIRST, ordre ASC, nom ASC
    `, [boutiqueId]),
    // `s.*` porte `prix_ttc` stocké (migration 0064)
    // AVANT (2026-10-06, ticket 04 prix TTC — TTC stocké, plus recalculé) :
    //       SELECT s.*, ROUND(s.prix_ht * (1 + s.tva_taux / 100), 2) as prix_ttc
    db.all<any>(`
      SELECT s.*
      FROM   services s
      WHERE  s.boutique_id = ? AND s.actif = 1
      ORDER  BY s.nom ASC
    `, [boutiqueId])
  ])

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
  id:           number
  nom:          string
  brand_slug:   string | null
  logo_url:     string | null
  device_count: number
  source:       string
  ordre:        number
  actif:        number
  synced_at:    string | null
  nb_modeles?:  number
}

export interface ModeleAppareil {
  id:          number
  marque_id:   number
  marque_nom?: string
  nom:         string
  phone_slug:  string | null
  type:        string
  annee:       number | null
  image_url:   string | null
  source:      string
  actif:       number
}

/**
 * Liste toutes les marques actives du référentiel global, triées par `ordre` puis `nom`.
 * Inclut le compte de modèles actifs associés (`nb_modeles`).
 * Référentiel global Sprint 2.39 — plus de boutique_id.
 */
export async function listMarques(
  db: Database
): Promise<MarqueAppareil[]> {
  return db.all<MarqueAppareil>(`
    SELECT m.*,
           COUNT(mo.id) AS nb_modeles
    FROM   marques_appareils m
    LEFT JOIN modeles_appareils mo ON mo.marque_id = m.id AND mo.actif = 1
    WHERE  m.actif = 1
    GROUP  BY m.id
    ORDER  BY m.ordre ASC, m.nom ASC
  `)
}

/**
 * Crée une marque dans le référentiel global.
 * Contrainte UNIQUE sur brand_slug — lève une erreur si doublon.
 */
export async function createMarque(
  db: D1Database,
  data: { nom: string; logo_url?: string; ordre?: number; brand_slug?: string },
  userId: number
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO marques_appareils (nom, logo_url, ordre, brand_slug, source)
    VALUES (?, ?, ?, ?, 'manual')
    RETURNING id
  `).bind(
    data.nom.trim(),
    data.logo_url   ?? null,
    data.ordre      ?? 0,
    data.brand_slug ?? null
  ).first<{ id: number }>()

  await auditLog(db, { user_id: userId, action: 'CREATE_MARQUE', entite_type: 'marque_appareil', entite_id: result?.id })
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
 * Liste les modèles actifs du référentiel global.
 * Filtrage optionnel par `marque_id`, `search` (nom), `type`, `limit`.
 * Référentiel global Sprint 2.39 — plus de boutique_id.
 */
export async function listModeles(
  db: Database,
  query: { marque_id?: number; search?: string; type?: string; limit?: number } = {}
): Promise<ModeleAppareil[]> {
  const conditions = ['mo.actif = 1']
  const bindings: any[] = []

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

  const limitClause = query.limit ? `LIMIT ${parseInt(String(query.limit), 10)}` : 'LIMIT 500'

  return db.all<ModeleAppareil>(`
    SELECT mo.*,
           ma.nom AS marque_nom
    FROM   modeles_appareils mo
    JOIN   marques_appareils ma ON ma.id = mo.marque_id
    WHERE  ${conditions.join(' AND ')}
    ORDER  BY ma.nom ASC, mo.nom ASC
    ${limitClause}
  `, bindings)
}

/**
 * Crée un modèle manuellement dans le référentiel global.
 * Contrainte UNIQUE (marque_id, nom).
 */
export async function createModele(
  db: D1Database,
  data: { marque_id: number; nom: string; type?: string; annee?: number; phone_slug?: string },
  userId: number
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO modeles_appareils (marque_id, nom, type, annee, phone_slug, source)
    VALUES (?, ?, ?, ?, ?, 'manual')
    RETURNING id
  `).bind(
    data.marque_id,
    data.nom.trim(),
    data.type       ?? 'smartphone',
    data.annee      ?? null,
    data.phone_slug ?? null
  ).first<{ id: number }>()

  await auditLog(db, { user_id: userId, action: 'CREATE_MODELE', entite_type: 'modele_appareil', entite_id: result?.id })
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
 *
 * Isolation multi-tenant : le modèle est global (référentiel partagé, migration 0031),
 * mais les services liés appartiennent chacun à une boutique (`services.boutique_id`
 * NOT NULL depuis la migration 0013). Sans le filtre `s.boutique_id`, cette requête
 * renvoyait le nom, la description et les prix HT/TTC des services de TOUTES les
 * boutiques ayant lié un service à ce modèle — fuite de tarifs entre concurrents.
 * `boutiqueId` doit toujours venir du JWT (`getBoutiqueId()`), jamais du corps de requête.
 *
 * @param db          Port Database
 * @param modeleId    Identifiant du modèle d'appareil (référentiel global)
 * @param boutiqueId  Boutique appelante — seuls ses services sont retournés
 */
export async function getServicesByModele(
  db: Database, modeleId: number, boutiqueId: number
): Promise<object[]> {
  // AVANT (2026-10-06, ticket 04 prix TTC — TTC stocké : prix par modèle s'il existe, sinon le service ;
  // `sm.prix_ttc_specifique` ajouté à la suite de `sm.prix_ht_specifique`), ligne remplacée dans la requête :
  //            ROUND(COALESCE(sm.prix_ht_specifique, s.prix_ht) * (1 + s.tva_taux / 100), 2) AS prix_ttc_effectif,
  return db.all<any>(`
    SELECT s.id,
           s.nom,
           s.description,
           s.reference,
           s.tva_taux,
           s.garantie_jours,
           s.duree_minutes,
           COALESCE(sm.prix_ht_specifique, s.prix_ht) AS prix_ht_effectif,
           COALESCE(sm.prix_ttc_specifique, s.prix_ttc) AS prix_ttc_effectif,
           sm.prix_ht_specifique,
           sm.prix_ttc_specifique,
           c.nom    AS categorie_nom,
           c.couleur AS categorie_couleur
    FROM   service_modeles sm
    JOIN   services s  ON s.id = sm.service_id AND s.actif = 1
    LEFT JOIN categories_services c ON c.id = s.categorie_id
    WHERE  sm.modele_id = ? AND sm.actif = 1 AND s.boutique_id = ?
    ORDER  BY c.nom ASC, s.nom ASC
  `, [modeleId, boutiqueId])
}

/**
 * Prix spécifique d'un service pour un modèle (ticket 04 prix TTC) : TTC envoyé (prioritaire), HT
 * déduit au taux du service ; sinon HT envoyé par un ancien écran, TTC calculé ; sinon aucun prix
 * spécifique (`null` / `null` : le prix du service s'applique).
 */
async function prixSpecifiqueDuModele(
  db: D1Database,
  data: { service_id: number; prix_ht_specifique?: number | null; prix_ttc_specifique?: number | null },
): Promise<{ ht: number | null; ttc: number | null }> {
  const aucunPrixEnvoye = !estUnNombreFini(data.prix_ttc_specifique) && !estUnNombreFini(data.prix_ht_specifique)
  if (aucunPrixEnvoye) return { ht: null, ttc: null }

  const service = await db.prepare('SELECT tva_taux FROM services WHERE id = ?')
    .bind(data.service_id).first<{ tva_taux: number }>()
  const tauxDuService = service?.tva_taux ?? 20

  // Même règle que tout prix de vente : TTC prioritaire, sinon HT converti (`prixDeVenteACreer()`)
  return prixDeVenteACreer(data.prix_ttc_specifique, data.prix_ht_specifique, tauxDuService)
}

/**
 * Associe un service à un modèle (avec prix override optionnel).
 * Idempotent : si la liaison existe déjà (même inactif), la réactive et met à jour le prix.
 */
export async function linkServiceModele(
  db: D1Database,
  // AVANT (2026-10-06, ticket 04 prix TTC — `prix_ttc_specifique` accepté, prioritaire) :
  //   data: { service_id: number; modele_id: number; prix_ht_specifique?: number | null },
  data: { service_id: number; modele_id: number; prix_ht_specifique?: number | null; prix_ttc_specifique?: number | null },
  userId: number
): Promise<void> {
  const prix = await prixSpecifiqueDuModele(db, data)

  // AVANT (2026-10-06, ticket 04 prix TTC — TTC spécifique écrit avec le HT, en fin de liste) :
  //     INSERT INTO service_modeles (service_id, modele_id, prix_ht_specifique, actif)
  //     VALUES (?, ?, ?, 1)
  //   `).bind(data.service_id, data.modele_id, data.prix_ht_specifique ?? null).run()
  await db.prepare(`
    INSERT INTO service_modeles (service_id, modele_id, prix_ht_specifique, actif, prix_ttc_specifique)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(service_id, modele_id) DO UPDATE SET
      prix_ht_specifique = excluded.prix_ht_specifique,
      prix_ttc_specifique = excluded.prix_ttc_specifique,
      actif              = 1,
      created_at         = created_at
  `).bind(data.service_id, data.modele_id, prix.ht, prix.ttc).run()
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
 *
 * Le modèle lui-même est global (aucun `boutique_id` à comparer) ; l'isolation porte
 * sur les services retournés — voir `getServicesByModele()`.
 *
 * @param db          Port Database
 * @param modeleId    Identifiant du modèle d'appareil (référentiel global)
 * @param boutiqueId  Boutique appelante — seuls ses services sont retournés
 */
export async function getModeleWithServices(
  db: Database, modeleId: number, boutiqueId: number
): Promise<{ modele: ModeleAppareil | null; services: object[] }> {
  const [modeleRow, services] = await Promise.all([
    db.get<ModeleAppareil>(`
      SELECT mo.*, ma.nom AS marque_nom
      FROM   modeles_appareils mo
      JOIN   marques_appareils ma ON ma.id = mo.marque_id
      WHERE  mo.id = ? AND mo.actif = 1
    `, [modeleId]),
    getServicesByModele(db, modeleId, boutiqueId)
  ])
  return { modele: modeleRow ?? null, services }
}
