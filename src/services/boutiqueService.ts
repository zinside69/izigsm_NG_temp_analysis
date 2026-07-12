import type { Database } from '../ports/database'

/**
 * @module services/boutiqueService
 * @description Service Boutiques — toutes les opérations SQL liées à la gestion
 *              des boutiques, de leurs paramètres et de leurs statistiques.
 *
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12) — les 8
 * fonctions sont migrées intégralement, aucune ne dépend d'`auditLog()`.
 *
 * Rôle architectural (P1 Modularité) :
 *   Ce service est le seul endroit où des requêtes SQL concernant `boutiques`,
 *   `boutique_settings`, `clients`, `tickets`, `factures` et `produits` sont
 *   émises dans le contexte de la gestion des boutiques.
 *   `routes/boutiques.ts` est un controller pur qui appelle ce service — 0 SQL direct.
 *
 * Fonctions exposées :
 *   - `listAllBoutiques()`      → toutes les boutiques actives (admin)
 *   - `listBoutiqueForUser()`   → boutique d'un utilisateur précis (non-admin)
 *   - `getBoutiqueById()`       → détail boutique par id
 *   - `getBoutiqueSettings()`   → paramètres d'une boutique
 *   - `createBoutique()`        → INSERT boutique + boutique_settings
 *   - `updateBoutique()`        → UPDATE COALESCE infos boutique
 *   - `updateBoutiqueSettings()` → UPDATE COALESCE paramètres boutique
 *   - `getStatsBoutique()`      → 4 KPIs en parallèle (Promise.all)
 *
 * Conventions SQL :
 *   - Toutes les requêtes utilisent des paramètres liés (`?`) — pas d'interpolation
 *   - COALESCE sur champs optionnels pour un comportement PATCH-like
 *   - Promise.all pour les lectures parallèles (optimisation latence D1)
 *   - Les requêtes de lecture retournent `null` si aucun résultat (`.first<T>()`)
 *   - Les requêtes de liste retournent un tableau vide si aucun résultat (`.all()`)
 *
 * @see routes/boutiques.ts  Controller qui consomme ce service
 * @see lib/nf525.ts         Vérification et clôture NF525 (déjà un service dédié)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Représentation d'une boutique (champs principaux).
 */
export interface Boutique {
  id:           number
  nom:          string
  slug:         string | null
  siret:        string | null
  tva_numero:   string | null
  adresse:      string | null
  code_postal:  string | null
  ville:        string | null
  telephone:    string | null
  email:        string | null
  site_web:     string | null
  description:  string | null
  actif:        number
}

/**
 * Paramètres opérationnels d'une boutique (`boutique_settings`).
 */
export interface BoutiqueSettings {
  boutique_id:                number
  tva_taux_defaut:            number
  paiement_especes:           number
  paiement_cb:                number
  paiement_cheque:            number
  paiement_virement:          number
  prefix_ticket:              string | null
  prefix_facture:             string | null
  prefix_devis:               string | null
  prefix_avoir:               string | null
  prefix_rachat:              string | null
  format_numero:              string | null
  padding_numero:             number | null
  garantie_defaut_jours:      number | null
  delai_relance_jours:        number | null
  mention_facture:            string | null
  pied_de_page:               string | null
  email_provider:             string | null
  email_from:                 string | null
}

/**
 * KPIs globaux d'une boutique (4 indicateurs).
 */
export interface StatsBoutique {
  nb_clients:          number
  tickets_en_cours:    number
  ca_mois:             number
  produits_stock_bas:  number
}

/**
 * Données pour la création d'une boutique (champs optionnels en string | null).
 */
export interface CreateBoutiqueInput {
  nom:         string
  slug:        string
  siret:       string | null
  tva_numero:  string | null
  adresse:     string | null
  code_postal: string | null
  ville:       string | null
  telephone:   string | null
  email:       string | null
}

/**
 * Données pour la mise à jour d'une boutique (tous les champs sont optionnels).
 */
export interface UpdateBoutiqueInput {
  nom:             string | null
  siret:           string | null
  tva_numero:      string | null
  adresse:         string | null
  code_postal:     string | null
  ville:           string | null
  telephone:       string | null
  email:           string | null
  site_web:        string | null
  slug:            string | null
  description:     string | null
  facebook_url:    string | null
  instagram_url:   string | null
  google_maps_url: string | null
}

/**
 * Données pour la mise à jour des paramètres d'une boutique.
 * Tous les champs sont optionnels (COALESCE SQL côté service).
 */
export interface UpdateSettingsInput {
  tva_taux_defaut:            number | null
  horaires:                   any    | null
  notif_email_actif:          boolean | null
  notif_sms_actif:            boolean | null
  paiement_especes:           boolean | null
  paiement_cb:                boolean | null
  paiement_cheque:            boolean | null
  paiement_virement:          boolean | null
  prefix_ticket:              string | null
  prefix_facture:             string | null
  prefix_devis:               string | null
  prefix_avoir:               string | null
  prefix_rachat:              string | null
  format_numero:              string | null
  padding_numero:             number | null
  garantie_defaut_jours:      number | null
  delai_relance_jours:        number | null
  mention_facture:            string | null
  pied_de_page:               string | null
  email_provider:             string | null
  email_api_key:              string | null
  email_from:                 string | null
  email_notif_ticket_cree:    boolean | null
  email_notif_ticket_termine: boolean | null
  email_notif_sav_ouvert:     boolean | null
  email_notif_relance:        boolean | null
}

// ─── listAllBoutiques ─────────────────────────────────────────────────────────

/**
 * Liste toutes les boutiques actives (accès administrateur).
 *
 * Retourne toutes les boutiques triées par nom.
 * Réservé aux utilisateurs avec le rôle `admin`.
 *
 * @param db  Port Database
 * @returns   Tableau de boutiques actives, trié alphabétiquement
 */
export async function listAllBoutiques(db: Database): Promise<Boutique[]> {
  return db.all<Boutique>('SELECT * FROM boutiques WHERE actif = 1 ORDER BY nom')
}

// ─── listBoutiqueForUser ──────────────────────────────────────────────────────

/**
 * Retourne la boutique d'un utilisateur (accès non-admin).
 *
 * Un utilisateur non-admin ne peut accéder qu'à sa propre boutique.
 * Retourne un tableau (vide ou avec 1 élément) pour cohérence avec `listAllBoutiques()`.
 *
 * @param db         Port Database
 * @param boutiqueId Identifiant de la boutique de l'utilisateur (issu du JWT)
 * @returns          Tableau contenant 0 ou 1 boutique
 */
export async function listBoutiqueForUser(
  db: Database,
  boutiqueId: number
): Promise<Boutique[]> {
  return db.all<Boutique>('SELECT * FROM boutiques WHERE id = ? AND actif = 1', [boutiqueId])
}

// ─── getBoutiqueById ──────────────────────────────────────────────────────────

/**
 * Récupère une boutique active par son identifiant.
 *
 * Utilisé dans `GET /:id` pour le détail d'une boutique.
 * La clause `AND actif = 1` empêche l'accès aux boutiques désactivées.
 *
 * @param db  Port Database
 * @param id  Identifiant numérique de la boutique
 * @returns   `Boutique` si trouvée et active, `null` sinon
 */
export async function getBoutiqueById(
  db: Database,
  id: number
): Promise<Boutique | null> {
  return db.get<Boutique>('SELECT * FROM boutiques WHERE id = ? AND actif = 1', [id])
}

// ─── getBoutiqueSettings ──────────────────────────────────────────────────────

/**
 * Récupère les paramètres opérationnels d'une boutique.
 *
 * Utilisé conjointement avec `getBoutiqueById()` dans `GET /:id`.
 * Peut retourner `null` si la boutique n'a pas encore de settings (cas rare —
 * normalement créés avec `createBoutique()`).
 *
 * @param db         Port Database
 * @param boutiqueId Identifiant numérique de la boutique
 * @returns          `BoutiqueSettings` ou `null` si non initialisés
 */
export async function getBoutiqueSettings(
  db: Database,
  boutiqueId: number
): Promise<BoutiqueSettings | null> {
  return db.get<BoutiqueSettings>('SELECT * FROM boutique_settings WHERE boutique_id = ?', [boutiqueId])
}

// ─── createBoutique ───────────────────────────────────────────────────────────

/**
 * Crée une nouvelle boutique et initialise ses paramètres par défaut.
 *
 * Séquence (2 opérations) :
 *   1. INSERT INTO boutiques (toutes les colonnes) RETURNING id
 *   2. INSERT INTO boutique_settings (boutique_id) ← initialise avec DEFAULT SQL
 *
 * Le slug est auto-généré dans le controller avant l'appel (normalisation des accents).
 *
 * @param db    Port Database
 * @param data  Données de la boutique à créer (voir `CreateBoutiqueInput`)
 * @returns     L'identifiant numérique de la boutique créée, `null` si échec
 */
export async function createBoutique(
  db: Database,
  data: CreateBoutiqueInput
): Promise<number | null> {
  const result = await db.get<{ id: number }>(`
    INSERT INTO boutiques (nom, slug, siret, tva_numero, adresse, code_postal, ville, telephone, email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `, [
    data.nom, data.slug, data.siret, data.tva_numero,
    data.adresse, data.code_postal, data.ville,
    data.telephone, data.email
  ])

  if (result?.id) {
    // Initialiser les settings avec les valeurs par défaut (colonnes DEFAULT en SQL)
    await db.run('INSERT INTO boutique_settings (boutique_id) VALUES (?)', [result.id])
  }

  return result?.id ?? null
}

// ─── updateBoutique ───────────────────────────────────────────────────────────

/**
 * Met à jour les informations d'identité et de contact d'une boutique.
 *
 * Utilise `COALESCE(?, col)` pour ne mettre à jour que les champs fournis —
 * comportement PATCH-like avec une requête PUT (tous les champs sont envoyés,
 * les non-modifiés sont `null` et COALESCE conserve la valeur existante).
 *
 * 14 champs modifiables : nom, siret, tva_numero, adresse, code_postal, ville,
 * telephone, email, site_web, slug, description, facebook_url, instagram_url,
 * google_maps_url.
 *
 * @param db   Port Database
 * @param id   Identifiant numérique de la boutique à modifier
 * @param data Données de mise à jour (voir `UpdateBoutiqueInput`)
 * @returns    Promesse résolue après l'UPDATE (pas de valeur de retour)
 */
export async function updateBoutique(
  db: Database,
  id: number,
  data: UpdateBoutiqueInput
): Promise<void> {
  await db.run(`
    UPDATE boutiques SET
      nom=COALESCE(?,nom), siret=COALESCE(?,siret), tva_numero=COALESCE(?,tva_numero),
      adresse=COALESCE(?,adresse), code_postal=COALESCE(?,code_postal), ville=COALESCE(?,ville),
      telephone=COALESCE(?,telephone), email=COALESCE(?,email), site_web=COALESCE(?,site_web),
      slug=COALESCE(?,slug), description=COALESCE(?,description),
      facebook_url=COALESCE(?,facebook_url), instagram_url=COALESCE(?,instagram_url),
      google_maps_url=COALESCE(?,google_maps_url),
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `, [
    data.nom, data.siret, data.tva_numero,
    data.adresse, data.code_postal, data.ville,
    data.telephone, data.email, data.site_web,
    data.slug, data.description,
    data.facebook_url, data.instagram_url, data.google_maps_url,
    id
  ])
}

// ─── updateBoutiqueSettings ───────────────────────────────────────────────────

/**
 * Met à jour les paramètres opérationnels d'une boutique.
 *
 * Gère 22 paramètres en une seule requête UPDATE.
 * Les booléens sont convertis en `0/1` pour la compatibilité SQLite.
 * Les champs non fournis (`null`) conservent leur valeur via COALESCE.
 *
 * Paramètres gérés :
 *   - TVA et paiements : `tva_taux_defaut`, `paiement_*`
 *   - Numérotation     : `prefix_*`, `format_numero`, `padding_numero`
 *   - Métier           : `garantie_defaut_jours`, `delai_relance_jours`, `mention_facture`, `pied_de_page`
 *   - Email            : `email_provider`, `email_api_key`, `email_from`, `email_notif_*`
 *   - Notifications    : `notif_email_actif`, `notif_sms_actif`, `horaires`
 *
 * @param db         Port Database
 * @param boutiqueId Identifiant numérique de la boutique
 * @param data       Paramètres à mettre à jour (voir `UpdateSettingsInput`)
 * @returns          Promesse résolue après l'UPDATE (pas de valeur de retour)
 */
export async function updateBoutiqueSettings(
  db: Database,
  boutiqueId: number,
  data: UpdateSettingsInput
): Promise<void> {
  // Conversion booléens → 0/1 pour SQLite (avec gestion null)
  const toInt = (v: boolean | null | undefined): number | null =>
    v != null ? (v ? 1 : 0) : null

  await db.run(`
    UPDATE boutique_settings SET
      tva_taux_defaut=?, horaires=?, notif_email_actif=?, notif_sms_actif=?,
      paiement_especes=?, paiement_cb=?, paiement_cheque=?, paiement_virement=?,
      prefix_ticket=COALESCE(?,prefix_ticket), prefix_facture=COALESCE(?,prefix_facture),
      prefix_devis=COALESCE(?,prefix_devis),   prefix_avoir=COALESCE(?,prefix_avoir),
      prefix_rachat=COALESCE(?,prefix_rachat),
      format_numero=COALESCE(?,format_numero),  padding_numero=COALESCE(?,padding_numero),
      garantie_defaut_jours=COALESCE(?,garantie_defaut_jours),
      delai_relance_jours=COALESCE(?,delai_relance_jours),
      mention_facture=COALESCE(?,mention_facture),
      pied_de_page=COALESCE(?,pied_de_page),
      email_provider=COALESCE(?,email_provider),
      email_api_key=COALESCE(?,email_api_key),
      email_from=COALESCE(?,email_from),
      email_notif_ticket_cree=COALESCE(?,email_notif_ticket_cree),
      email_notif_ticket_termine=COALESCE(?,email_notif_ticket_termine),
      email_notif_sav_ouvert=COALESCE(?,email_notif_sav_ouvert),
      email_notif_relance=COALESCE(?,email_notif_relance),
      updated_at=CURRENT_TIMESTAMP
    WHERE boutique_id=?
  `, [
    data.tva_taux_defaut ?? 20,
    data.horaires ? JSON.stringify(data.horaires) : null,
    toInt(data.notif_email_actif) ?? 0,
    toInt(data.notif_sms_actif)   ?? 0,
    toInt(data.paiement_especes)  ?? 0,
    toInt(data.paiement_cb)       ?? 0,
    toInt(data.paiement_cheque)   ?? 0,
    toInt(data.paiement_virement) ?? 0,
    data.prefix_ticket   ?? null, data.prefix_facture ?? null,
    data.prefix_devis    ?? null, data.prefix_avoir   ?? null,
    data.prefix_rachat   ?? null,
    data.format_numero   ?? null, data.padding_numero ?? null,
    data.garantie_defaut_jours ?? null,
    data.delai_relance_jours   ?? null,
    data.mention_facture ?? null,
    data.pied_de_page    ?? null,
    data.email_provider  ?? null,
    data.email_api_key   ?? null,
    data.email_from      ?? null,
    toInt(data.email_notif_ticket_cree),
    toInt(data.email_notif_ticket_termine),
    toInt(data.email_notif_sav_ouvert),
    toInt(data.email_notif_relance),
    boutiqueId
  ])
}

// ─── getStatsBoutique ─────────────────────────────────────────────────────────

/**
 * Calcule les 4 KPIs globaux d'une boutique en parallèle.
 *
 * Utilise `Promise.all` pour exécuter les 4 requêtes D1 simultanément,
 * réduisant la latence totale à ~1 RTT au lieu de 4 RTTs séquentiels.
 *
 * Indicateurs calculés :
 *   - `nb_clients`         : nombre de clients actifs (`actif = 1`)
 *   - `tickets_en_cours`   : tickets actifs hors statuts `livre` et `annule`
 *   - `ca_mois`            : CA TTC des factures `payee` du mois courant
 *   - `produits_stock_bas` : produits dont `stock_actuel <= stock_minimum`
 *
 * @param db         Port Database
 * @param boutiqueId Identifiant numérique de la boutique
 * @returns          `StatsBoutique` avec les 4 indicateurs (0 si aucune donnée)
 */
export async function getStatsBoutique(
  db: Database,
  boutiqueId: number
): Promise<StatsBoutique> {
  // 4 requêtes en parallèle via Promise.all pour optimiser la latence
  const [clients, tickets, ca_mois, stock_bas] = await Promise.all([
    db.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM clients WHERE boutique_id = ? AND actif = 1', [boutiqueId]
    ),

    db.get<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM tickets WHERE boutique_id = ? AND statut NOT IN ('livre','annule') AND actif = 1", [boutiqueId]
    ),

    db.get<{ ca: number }>(
      "SELECT COALESCE(SUM(total_ttc),0) as ca FROM factures WHERE boutique_id = ? AND statut='payee' AND strftime('%Y-%m',date_emission) = strftime('%Y-%m','now')", [boutiqueId]
    ),

    db.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM produits WHERE boutique_id = ? AND stock_actuel <= stock_minimum AND actif = 1', [boutiqueId]
    ),
  ])

  return {
    nb_clients:          clients?.cnt  ?? 0,
    tickets_en_cours:    tickets?.cnt  ?? 0,
    ca_mois:             ca_mois?.ca   ?? 0,
    produits_stock_bas:  stock_bas?.cnt ?? 0,
  }
}
