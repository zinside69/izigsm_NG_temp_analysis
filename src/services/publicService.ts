/**
 * @module publicService
 * @description Model layer — accès aux données pour les routes publiques (sans authentification).
 *
 * Routes consommatrices : `routes/public.ts`
 * Principes : P1 (0 SQL dans les controllers) · P4 (JSDoc exhaustif)
 *
 * Fonctions exportées :
 *   getTicketPublicByToken(db, token)       — Suivi ticket client (JOIN clients + boutiques)
 *   getBoutiquePublicBySlug(db, slug)       — Infos vitrine + stats
 *   getStatsBoutiquePublic(db, boutiqueId)  — Compteurs réparations effectuées
 *   getBoutiqueIdBySlug(db, slug)           — Résout slug → { id, nom }
 *   getCategoriesPubliques(db, boutiqueId)  — Catégories de services actives (sans parent)
 *   getServicesPublics(db, boutiqueId)      — Services actifs avec tarifs
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Données publiques d'un ticket renvoyées au client via son tracking_token. */
export interface TicketPublic {
  id:                number
  numero:            string
  tracking_token:    string
  statut:            string
  appareil_marque:   string
  appareil_modele:   string
  description_panne: string
  diagnostic:        string | null
  prix_estime:       number | null
  prix_final:        number | null
  date_reception:    string
  date_promesse:     string | null
  date_livraison:    string | null
  client_prenom:     string
  client_nom:        string
  boutique_nom:      string
  boutique_telephone:string | null
  boutique_email:    string | null
  boutique_adresse:  string | null
  boutique_ville:    string | null
}

/** Infos publiques d'une boutique (vitrine). */
export interface BoutiquePublic {
  id:             number
  nom:            string
  siret:          string | null
  adresse:        string | null
  code_postal:    string | null
  ville:          string | null
  telephone:      string | null
  email:          string | null
  site_web:       string | null
  logo_url:       string | null
  description:    string | null
  horaires:       string | null
  slug:           string
  facebook_url:   string | null
  instagram_url:  string | null
  google_maps_url:string | null
}

/** Compteurs publics d'une boutique. */
export interface StatsBoutiquePublic {
  total_tickets:  number
  tickets_done:   number
}

/** Identifiant minimal d'une boutique par son slug. */
export interface BoutiqueSlugRef {
  id:  number
  nom: string
}

/** Catégorie de service visible publiquement. */
export interface CategoriePublique {
  id:          number
  nom:         string
  description: string | null
  couleur:     string | null
  ordre:       number
}

/** Service visible publiquement avec tarif TTC calculé. */
export interface ServicePublic {
  id:            number
  nom:           string
  description:   string | null
  prix_ht:       number
  tva_taux:      number
  duree_minutes: number | null
  categorie_id:  number
}

// ─── Ticket ───────────────────────────────────────────────────────────────────

/**
 * Retourne les données publiques d'un ticket à partir de son tracking_token.
 * Fait un JOIN clients + boutiques pour exposer les coordonnées utiles au client.
 *
 * @param db    - Instance D1Database (Cloudflare binding)
 * @param token - Valeur du `tracking_token` du ticket (≥ 16 caractères)
 * @returns     `TicketPublic` si trouvé et actif, `null` sinon
 */
export async function getTicketPublicByToken(
  db:    D1Database,
  token: string
): Promise<TicketPublic | null> {
  return db.prepare(`
    SELECT
      t.id,
      t.numero,
      t.tracking_token,
      t.statut,
      t.appareil_marque,
      t.appareil_modele,
      t.description_panne,
      t.diagnostic,
      t.prix_estime,
      t.prix_final,
      t.date_reception,
      t.date_promesse,
      t.date_livraison,
      c.prenom   AS client_prenom,
      c.nom      AS client_nom,
      b.nom      AS boutique_nom,
      b.telephone AS boutique_telephone,
      b.email    AS boutique_email,
      b.adresse  AS boutique_adresse,
      b.ville    AS boutique_ville
    FROM   tickets t
    JOIN   clients  c ON c.id = t.client_id
    JOIN   boutiques b ON b.id = t.boutique_id
    WHERE  t.tracking_token = ? AND t.actif = 1
  `).bind(token).first<TicketPublic>()
}

// ─── Boutique publique ────────────────────────────────────────────────────────

/**
 * Retourne les informations publiques d'une boutique à partir de son slug.
 * Seules les boutiques actives (`actif = 1`) sont retournées.
 *
 * @param db   - Instance D1Database
 * @param slug - Slug URL de la boutique (ex. `"izigsm-paris-11"`)
 * @returns    `BoutiquePublic` si trouvée et active, `null` sinon
 */
export async function getBoutiquePublicBySlug(
  db:   D1Database,
  slug: string
): Promise<BoutiquePublic | null> {
  return db.prepare(`
    SELECT id, nom, siret, adresse, code_postal, ville, telephone, email,
           site_web, logo_url, description, horaires, slug,
           facebook_url, instagram_url, google_maps_url
    FROM boutiques
    WHERE slug = ? AND actif = 1
  `).bind(slug).first<BoutiquePublic>()
}

/**
 * Retourne les compteurs publics d'activité d'une boutique.
 * Utilisé sur la vitrine pour afficher « N réparations effectuées ».
 *
 * @param db         - Instance D1Database
 * @param boutiqueId - ID interne de la boutique
 * @returns          `StatsBoutiquePublic` (never null — fallback 0 si aucune donnée)
 */
export async function getStatsBoutiquePublic(
  db:         D1Database,
  boutiqueId: number
): Promise<StatsBoutiquePublic> {
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS total_tickets,
      SUM(CASE WHEN statut = 'DELIVERED' THEN 1 ELSE 0 END) AS tickets_done
    FROM tickets WHERE boutique_id = ? AND actif = 1
  `).bind(boutiqueId).first<StatsBoutiquePublic>()

  return {
    total_tickets: row?.total_tickets ?? 0,
    tickets_done:  row?.tickets_done  ?? 0,
  }
}

// ─── Catalogue ────────────────────────────────────────────────────────────────

/**
 * Résout un slug en identifiant et nom de boutique (accès minimal).
 * Utilisé avant de charger le catalogue pour ne pas joindre toutes les colonnes.
 *
 * @param db   - Instance D1Database
 * @param slug - Slug URL de la boutique
 * @returns    `{ id, nom }` si active, `null` sinon
 */
export async function getBoutiqueIdBySlug(
  db:   D1Database,
  slug: string
): Promise<BoutiqueSlugRef | null> {
  return db.prepare(
    'SELECT id, nom FROM boutiques WHERE slug = ? AND actif = 1'
  ).bind(slug).first<BoutiqueSlugRef>()
}

/**
 * Retourne les catégories de services racines (sans parent) actives d'une boutique.
 * Triées par ordre d'affichage puis par nom.
 *
 * @param db         - Instance D1Database
 * @param boutiqueId - ID de la boutique
 * @returns          Liste de `CategoriePublique` (peut être vide)
 */
export async function getCategoriesPubliques(
  db:         D1Database,
  boutiqueId: number
): Promise<CategoriePublique[]> {
  const rows = await db.prepare(`
    SELECT id, nom, description, couleur, ordre
    FROM categories_services
    WHERE boutique_id = ? AND actif = 1 AND parent_id IS NULL
    ORDER BY ordre ASC, nom ASC
  `).bind(boutiqueId).all<CategoriePublique>()

  return rows.results ?? []
}

/**
 * Retourne les services actifs d'une boutique avec leurs données tarifaires brutes.
 * Le prix TTC est calculé côté appelant (`prix_ht × (1 + tva_taux/100)`).
 * Triés par catégorie puis par nom.
 *
 * @param db         - Instance D1Database
 * @param boutiqueId - ID de la boutique
 * @returns          Liste de `ServicePublic` (peut être vide)
 */
export async function getServicesPublics(
  db:         D1Database,
  boutiqueId: number
): Promise<ServicePublic[]> {
  const rows = await db.prepare(`
    SELECT s.id, s.nom, s.description, s.prix_ht, s.tva_taux,
           s.duree_minutes, s.categorie_id
    FROM   services s
    WHERE  s.boutique_id = ? AND s.actif = 1
    ORDER  BY s.categorie_id ASC, s.nom ASC
  `).bind(boutiqueId).all<ServicePublic>()

  return rows.results ?? []
}
