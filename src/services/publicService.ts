import type { Database } from '../ports/database'

/**
 * @module publicService
 * @description Model layer — accès aux données pour les routes publiques (sans authentification).
 *
 * Routes consommatrices : `routes/public.ts`
 * Principes : P1 (0 SQL dans les controllers) · P4 (JSDoc exhaustif)
 *
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12) — les 8
 * fonctions sont des lectures/écritures publiques sans `auditLog()` (action
 * anonyme, pas d'utilisateur à tracer), aucune ne dépend de `D1Database` direct.
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
  boutique_slug:     string | null
  /** Statut du devis le plus récent lié au ticket, ou `null` si aucun — pilote la
   *  couleur (gris/orange/vert) de l'étape "Accord" dans la timeline `suivi.html`. */
  devis_statut:      string | null
  /** Montant TTC de la facture d'acompte liée, ou null si aucun acompte. */
  acompte_montant:   number | null
  /** Numéro de la facture d'acompte liée, ou null si aucun acompte. */
  acompte_numero:    string | null
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
 * @param db    - Port Database (implémentation D1 aujourd'hui, Postgres à la bascule VPS)
 * @param token - Valeur du `tracking_token` du ticket (≥ 16 caractères)
 * @returns     `TicketPublic` si trouvé et actif, `null` sinon
 */
export async function getTicketPublicByToken(
  db:    Database,
  token: string
): Promise<TicketPublic | null> {
  return db.get<TicketPublic>(`
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
      b.ville    AS boutique_ville,
      b.slug     AS boutique_slug,
      d.statut   AS devis_statut,
      fa.total_ttc AS acompte_montant,
      fa.numero    AS acompte_numero
    FROM   tickets t
    JOIN   clients  c ON c.id = t.client_id
    JOIN   boutiques b ON b.id = t.boutique_id
    LEFT JOIN devis d ON d.id = (
      SELECT id FROM devis WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1
    )
    LEFT JOIN factures fa ON fa.type_facture = 'acompte' AND (fa.ticket_id = t.id OR fa.devis_id = d.id)
    WHERE  t.tracking_token = ? AND t.actif = 1
  `, [token])
}

// ─── Boutique publique ────────────────────────────────────────────────────────

/**
 * Retourne les informations publiques d'une boutique à partir de son slug.
 * Seules les boutiques actives (`actif = 1`) sont retournées.
 *
 * @param db   - Port Database
 * @param slug - Slug URL de la boutique (ex. `"izigsm-paris-11"`)
 * @returns    `BoutiquePublic` si trouvée et active, `null` sinon
 */
export async function getBoutiquePublicBySlug(
  db:   Database,
  slug: string
): Promise<BoutiquePublic | null> {
  return db.get<BoutiquePublic>(`
    SELECT id, nom, siret, adresse, code_postal, ville, telephone, email,
           site_web, logo_url, description, horaires, slug,
           facebook_url, instagram_url, google_maps_url
    FROM boutiques
    WHERE slug = ? AND actif = 1
  `, [slug])
}

/**
 * Retourne les compteurs publics d'activité d'une boutique.
 * Utilisé sur la vitrine pour afficher « N réparations effectuées ».
 *
 * @param db         - Port Database
 * @param boutiqueId - ID interne de la boutique
 * @returns          `StatsBoutiquePublic` (never null — fallback 0 si aucune donnée)
 */
export async function getStatsBoutiquePublic(
  db:         Database,
  boutiqueId: number
): Promise<StatsBoutiquePublic> {
  const row = await db.get<StatsBoutiquePublic>(`
    SELECT
      COUNT(*) AS total_tickets,
      SUM(CASE WHEN statut = 'DELIVERED' THEN 1 ELSE 0 END) AS tickets_done
    FROM tickets WHERE boutique_id = ? AND actif = 1
  `, [boutiqueId])

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
 * @param db   - Port Database
 * @param slug - Slug URL de la boutique
 * @returns    `{ id, nom }` si active, `null` sinon
 */
export async function getBoutiqueIdBySlug(
  db:   Database,
  slug: string
): Promise<BoutiqueSlugRef | null> {
  return db.get<BoutiqueSlugRef>(
    'SELECT id, nom FROM boutiques WHERE slug = ? AND actif = 1', [slug]
  )
}

/**
 * Retourne les catégories de services racines (sans parent) actives d'une boutique.
 * Triées par ordre d'affichage puis par nom.
 *
 * @param db         - Port Database
 * @param boutiqueId - ID de la boutique
 * @returns          Liste de `CategoriePublique` (peut être vide)
 */
export async function getCategoriesPubliques(
  db:         Database,
  boutiqueId: number
): Promise<CategoriePublique[]> {
  return db.all<CategoriePublique>(`
    SELECT id, nom, description, couleur, ordre
    FROM categories_services
    WHERE boutique_id = ? AND actif = 1 AND parent_id IS NULL
    ORDER BY ordre ASC, nom ASC
  `, [boutiqueId])
}

/**
 * Retourne les services actifs d'une boutique avec leurs données tarifaires brutes.
 * Le prix TTC est calculé côté appelant (`prix_ht × (1 + tva_taux/100)`).
 * Triés par catégorie puis par nom.
 *
 * @param db         - Port Database
 * @param boutiqueId - ID de la boutique
 * @returns          Liste de `ServicePublic` (peut être vide)
 */
export async function getServicesPublics(
  db:         Database,
  boutiqueId: number
): Promise<ServicePublic[]> {
  return db.all<ServicePublic>(`
    SELECT s.id, s.nom, s.description, s.prix_ht, s.tva_taux,
           s.duree_minutes, s.categorie_id
    FROM   services s
    WHERE  s.boutique_id = ? AND s.actif = 1
    ORDER  BY s.categorie_id ASC, s.nom ASC
  `, [boutiqueId])
}

// ─── Prise de RDV public (MOD-14) ────────────────────────────────────────────

/** Créneau horaire disponible retourné au client. */
export interface CreneauDisponible {
  debut:         string   // "YYYY-MM-DD HH:MM"
  fin:           string   // "YYYY-MM-DD HH:MM"
  duree_minutes: number
}

/** Résultat d'une création de RDV public. */
export interface RdvPublicResult {
  id:           number
  ical_token:   string
  debut:        string
  fin:          string
  titre:        string
}

/**
 * Retourne les créneaux disponibles pour une boutique sur une date donnée.
 *
 * Algorithme :
 *  1. Charger les plages horaires configurées pour ce jour de semaine
 *  2. Générer tous les slots (durée = duree_slot de la plage)
 *  3. Charger les RDV existants non-annulés sur cette date
 *  4. Éliminer les slots déjà occupés (chevauchement)
 *  5. Éliminer les slots dans le passé
 *
 * @param db         - Port Database
 * @param boutiqueId - ID de la boutique
 * @param date       - Date cible au format "YYYY-MM-DD"
 * @returns          Liste de créneaux disponibles (peut être vide)
 */
export async function getDisponibilites(
  db:         Database,
  boutiqueId: number,
  date:       string
): Promise<CreneauDisponible[]> {
  // Jour de semaine ISO (1=Lundi, 7=Dimanche) depuis la date fournie
  const dateObj    = new Date(date + 'T12:00:00Z') // midi UTC évite les pb de timezone
  const dayOfWeek  = dateObj.getDay() || 7          // 0 (dimanche) → 7

  // 1. Plages horaires configurées pour ce jour
  const plages = await db.all<{ heure_debut: string; heure_fin: string; duree_slot: number }>(`
    SELECT heure_debut, heure_fin, duree_slot
    FROM boutique_creneaux
    WHERE boutique_id = ? AND jour_semaine = ? AND actif = 1
    ORDER BY heure_debut ASC
  `, [boutiqueId, dayOfWeek])

  if (plages.length === 0) return []

  // 2. Générer tous les slots possibles
  const slots: { debut: string; fin: string; duree: number }[] = []
  for (const plage of plages) {
    const [hd, md] = plage.heure_debut.split(':').map(Number)
    const [hf, mf] = plage.heure_fin.split(':').map(Number)
    const debutMin = hd * 60 + md
    const finMin   = hf * 60 + mf
    const duree    = plage.duree_slot

    for (let t = debutMin; t + duree <= finMin; t += duree) {
      const dH  = String(Math.floor(t / 60)).padStart(2, '0')
      const dM  = String(t % 60).padStart(2, '0')
      const fH  = String(Math.floor((t + duree) / 60)).padStart(2, '0')
      const fM  = String((t + duree) % 60).padStart(2, '0')
      slots.push({
        debut: `${date} ${dH}:${dM}`,
        fin:   `${date} ${fH}:${fM}`,
        duree,
      })
    }
  }

  // 3. RDV existants non-annulés sur cette date
  const rdvExistants = await db.all<{ debut: string; fin: string }>(`
    SELECT debut, fin
    FROM rendez_vous
    WHERE boutique_id = ? AND actif = 1
      AND DATE(debut) = ?
      AND statut NOT IN ('CANCELLED')
    ORDER BY debut ASC
  `, [boutiqueId, date])

  // 4 & 5. Filtrer : slot non occupé ET dans le futur
  const now = Date.now()
  const disponibles: CreneauDisponible[] = []

  for (const slot of slots) {
    // Passé ?
    const slotTs = new Date(slot.debut.replace(' ', 'T') + ':00Z').getTime()
    if (slotTs <= now) continue

    // Chevauchement avec un RDV existant ?
    const occupe = rdvExistants.some(rdv => {
      const rdvDebut = rdv.debut.slice(0, 16)  // "YYYY-MM-DD HH:MM"
      const rdvFin   = rdv.fin.slice(0, 16)
      return slot.debut < rdvFin && slot.fin > rdvDebut
    })
    if (occupe) continue

    disponibles.push({
      debut:         slot.debut,
      fin:           slot.fin,
      duree_minutes: slot.duree,
    })
  }

  return disponibles
}

/**
 * Crée un rendez-vous public (sans authentification).
 *
 * Le RDV est créé avec :
 *  - `statut = 'PENDING'`  → attend confirmation de la boutique
 *  - `type_rdv = 'reparation'` par défaut (ou body.type_rdv)
 *  - `client_id = null` (client non enregistré)
 *  - `nom_client`, `telephone_client` renseignés depuis le formulaire
 *  - `ical_token` généré pour identification
 *
 * Validations :
 *  - `debut` obligatoire et dans le futur
 *  - `nom_client` ou `telephone_client` requis
 *  - `service_nom` utilisé comme titre si `titre` absent
 *
 * @param db         - Port Database
 * @param boutiqueId - ID de la boutique
 * @param body       - Données du formulaire public
 * @returns          `RdvPublicResult` avec id + ical_token
 * @throws           Error si validation échoue ou insertion échoue
 */
export async function createRdvPublic(
  db:         Database,
  boutiqueId: number,
  body:       any
): Promise<RdvPublicResult> {
  const { debut, duree_minutes, nom_client, telephone_client, email_client,
          service_nom, notes, type_rdv } = body

  // Validations
  if (!debut) throw new Error('La date/heure du rendez-vous est requise.')
  if (!nom_client && !telephone_client)
    throw new Error('Nom ou téléphone du client requis.')

  const debutTs = new Date(debut.replace(' ', 'T') + ':00Z').getTime()
  if (isNaN(debutTs) || debutTs <= Date.now())
    throw new Error('La date du rendez-vous doit être dans le futur.')

  const duree = Number(duree_minutes) || 30
  // Calcul de fin
  const debutDate = new Date(debut.replace(' ', 'T') + ':00Z')
  debutDate.setMinutes(debutDate.getMinutes() + duree)
  const fin = debutDate.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '').slice(0, 16)

  // Titre = service_nom ou "RDV en ligne"
  const titre = (service_nom || 'RDV en ligne').slice(0, 120)

  // Token unique (Web Crypto)
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')

  const result = await db.get<RdvPublicResult>(`
    INSERT INTO rendez_vous
      (boutique_id, client_id, ticket_id, user_id,
       titre, description, debut, fin, duree_minutes,
       statut, type_rdv,
       nom_client, telephone_client,
       rappel_minutes, ical_token, couleur, notes)
    VALUES (?,NULL,NULL,NULL,?,?,?,?,?,'PENDING',?,?,?,60,?,'#F59E0B',?)
    RETURNING id, ical_token, debut, fin, titre
  `, [
    boutiqueId,
    titre,
    email_client ? `Email : ${email_client}` : null,
    debut,
    `${debut.slice(0, 10)} ${fin.slice(11)}`,
    duree,
    type_rdv || 'reparation',
    (nom_client || '').slice(0, 100),
    (telephone_client || '').slice(0, 30),
    token,
    (notes || '').slice(0, 500) || null
  ])

  if (!result?.id) throw new Error('Erreur lors de la création du rendez-vous.')
  return result
}
