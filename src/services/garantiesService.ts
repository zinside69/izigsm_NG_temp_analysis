/**
 * @module garantiesService
 * @description Model P1 : Garanties après-vente + Dossiers SAV.
 *
 * Rôle architectural (P1 MVC) : Model exclusif — tout le SQL ici.
 * Les routes `src/routes/sav.ts` délèguent sans aucun `.prepare()`.
 *
 * Règles métier :
 *  - Une garantie est créée AUTOMATIQUEMENT quand un ticket passe en "termine"
 *    (via `createGarantieFromTicket()`). Idempotent : pas de doublon si appelé 2×.
 *  - Durée de garantie configurable dans `boutique_settings.garantie_defaut_jours` (défaut 90j).
 *  - Un dossier SAV peut être ouvert sur n'importe quelle garantie encore `active`.
 *  - L'ouverture d'un SAV consomme la garantie (statut → `consommee`)
 *    et crée automatiquement un nouveau ticket SAV (priorité haute).
 *
 * Machine à états SAV :
 *   ouvert → en_traitement → resolu → clos
 *          ↘                refus  → clos
 *                                    clos (direct)
 *
 * Alias SQL dans les requêtes SAV :
 *   `t_orig` = alias pour `tickets` (ticket d'origine de la garantie)
 *   `ts`     = alias pour `tickets` (ticket SAV créé pour le dossier)
 *
 * Sprint 2.10 — MOD-09 SAV & Garanties
 */

import { nextNumero, parsePagination } from '../lib/db'
import type { Database } from '../ports/database'

// ─── Types internes ────────────────────────────────────────────────────────────

export interface GarantieRow {
  id:                      number
  boutique_id:             number
  ticket_id:               number
  client_id:               number | null
  appareil_marque:         string | null
  appareil_modele:         string | null
  description_reparation:  string | null
  date_debut:              string
  date_fin:                string
  garantie_jours:          number
  statut:                  'active' | 'expiree' | 'consommee'
  actif:                   number
  created_at:              string
  updated_at:              string
}

export interface SavRow {
  id:                number
  boutique_id:       number
  garantie_id:       number | null
  ticket_origine_id: number | null
  ticket_sav_id:     number | null
  client_id:         number | null
  numero:            string
  motif:             string
  description:       string | null
  statut:            'ouvert' | 'en_traitement' | 'resolu' | 'refuse' | 'clos'
  resolution:        string | null
  date_ouverture:    string
  date_cloture:      string | null
  actif:             number
  created_at:        string
  updated_at:        string
}

// Matrice des transitions SAV — seules ces transitions sont autorisées
// Tout autre changement de statut lève une Error dans updateSavStatut()
const TRANSITIONS_SAV: Record<string, string[]> = {
  ouvert:        ['en_traitement', 'refuse', 'clos'],
  en_traitement: ['resolu', 'refuse', 'clos'],
  resolu:        ['clos'],
  refuse:        ['clos'],
  clos:          [],
}

// ─── Garanties ────────────────────────────────────────────────────────────────

/**
 * Crée une garantie automatiquement lors du passage d'un ticket en "termine".
 * Lecture de la durée depuis `boutique_settings.garantie_defaut_jours` (défaut : 90j).
 *
 * Idempotent : si une garantie `actif=1` existe déjà pour ce ticket, elle est
 * retournée sans créer de doublon (safe à appeler plusieurs fois).
 *
 * La date de fin est calculée côté JavaScript (pas SQLite) pour contourner
 * le bug de binding D1 avec `datetime('now', '+N days')` et paramètre dynamique.
 *
 * @param db          Binding D1 Cloudflare
 * @param ticketId    Identifiant du ticket terminé
 * @param boutiqueId  Identifiant de la boutique
 * @returns           La garantie créée ou existante (`GarantieRow`)
 * @throws            Error si l'insertion échoue
 */
export async function createGarantieFromTicket(
  db:        Database,
  ticketId:  number,
  boutiqueId: number
): Promise<GarantieRow> {
  // Vérifie si une garantie active existe déjà
  const existing = await db.get<GarantieRow>(`
    SELECT * FROM garanties WHERE ticket_id = ? AND actif = 1 LIMIT 1
  `, [ticketId])
  if (existing) return existing

  // Lire durée depuis settings
  const settings = await db.get<{ garantie_defaut_jours: number }>(`
    SELECT garantie_defaut_jours FROM boutique_settings WHERE boutique_id = ?
  `, [boutiqueId])
  const garantieJours = settings?.garantie_defaut_jours ?? 90

  // Lire infos du ticket (client, appareil, diagnostic)
  const ticket = await db.get<{
    client_id: number | null
    appareil_marque: string | null
    appareil_modele: string | null
    diagnostic: string | null
  }>(`
    SELECT client_id, appareil_marque, appareil_modele, diagnostic
    FROM tickets WHERE id = ? LIMIT 1
  `, [ticketId])

  // Calcul date_fin côté JS (évite le bug datetime binding D1 avec paramètre dynamique)
  const dateFin = new Date(Date.now() + garantieJours * 24 * 60 * 60 * 1000).toISOString()

  const result = await db.get<GarantieRow>(`
    INSERT INTO garanties
      (boutique_id, ticket_id, client_id, appareil_marque, appareil_modele,
       description_reparation, date_debut, date_fin, garantie_jours, statut)
    VALUES (?, ?, ?, ?, ?, ?,
            CURRENT_TIMESTAMP, ?, ?, 'active')
    RETURNING *
  `, [
    boutiqueId,
    ticketId,
    ticket?.client_id    ?? null,
    ticket?.appareil_marque ?? null,
    ticket?.appareil_modele ?? null,
    ticket?.diagnostic   ?? null,
    dateFin,
    garantieJours
  ])

  if (!result) throw new Error('Échec création garantie.')
  return result
}

/**
 * Création manuelle d'une garantie (hors ticket ou pour ticket optionnel).
 *
 * Cas d'usage : garantie sur pièce vendue sans réparation, ou création
 * manuelle depuis le backoffice sans ticket associé (`ticket_id` nullable depuis migration 0019).
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param data        Données de la garantie (ticket_id optionnel, durée, client, appareil)
 * @returns           La garantie créée (`GarantieRow`)
 * @throws            Error si l'insertion échoue
 */
export async function createGarantie(
  db:         Database,
  boutiqueId: number,
  data: {
    ticket_id?:             number
    client_id?:             number
    appareil_marque?:       string
    appareil_modele?:       string
    description_reparation?: string
    garantie_jours?:        number
  }
): Promise<GarantieRow> {
  const garantieJours = data.garantie_jours ?? 90

  // ticket_id est nullable depuis migration 0019 — NULL pour les garanties manuelles sans ticket
  const ticketId = data.ticket_id ?? null

  // Calcul date_fin côté JS (corrige le bug FK — datetime binding D1 avec paramètre dynamique)
  const dateFin = new Date(Date.now() + garantieJours * 24 * 60 * 60 * 1000).toISOString()

  const result = await db.get<GarantieRow>(`
    INSERT INTO garanties
      (boutique_id, ticket_id, client_id, appareil_marque, appareil_modele,
       description_reparation, date_debut, date_fin, garantie_jours, statut)
    VALUES (?, ?, ?, ?, ?, ?,
            CURRENT_TIMESTAMP, ?, ?, 'active')
    RETURNING *
  `, [
    boutiqueId,
    ticketId,
    data.client_id              ?? null,
    data.appareil_marque        ?? null,
    data.appareil_modele        ?? null,
    data.description_reparation ?? null,
    dateFin,
    garantieJours
  ])

  if (!result) throw new Error('Échec création garantie.')
  return result
}

/**
 * Récupère une garantie par son identifiant avec les infos liées.
 * Vérifie l'appartenance à la boutique et que la garantie n'est pas supprimée.
 *
 * @param db          Binding D1 Cloudflare
 * @param id          Identifiant de la garantie
 * @param boutiqueId  Identifiant de la boutique (isolation multi-tenant)
 * @returns           Garantie enrichie (client + ticket) ou `null` si absente
 */
export async function getGarantie(
  db:         Database,
  id:         number,
  boutiqueId: number
): Promise<(GarantieRow & {
  client_nom?: string; client_prenom?: string; client_telephone?: string
  ticket_numero?: string
}) | null> {
  return db.get<GarantieRow & {
    client_nom?: string; client_prenom?: string; client_telephone?: string; ticket_numero?: string
  }>(`
    SELECT g.*,
           c.nom    AS client_nom,
           c.prenom AS client_prenom,
           c.telephone AS client_telephone,
           t.numero AS ticket_numero
    FROM   garanties g
    LEFT   JOIN clients c ON c.id = g.client_id
    LEFT   JOIN tickets t ON t.id = g.ticket_id
    WHERE  g.id = ? AND g.boutique_id = ? AND g.actif = 1
  `, [id, boutiqueId])
}

/**
 * Liste paginée des garanties avec filtres dynamiques.
 *
 * Filtres via `query` :
 *  - `statut`      : active | expiree | consommee
 *  - `client_id`   : filtre par client
 *  - `search`      : plein-texte sur marque, modèle, nom/prénom client
 *  - `expires_soon`: "1" pour les garanties expirant dans les 7 prochains jours
 *  - `page`, `limit`: pagination
 *
 * Exécute 2 requêtes en parallèle (count + data) via `Promise.all`.
 * Ajoute `jours_restants` (entier, négatif si expirée) calculé via `julianday`.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param query       Paramètres de filtrage (query params HTTP)
 * @returns           `{ data: GarantieRow[], pagination }`
 */
export async function listGaranties(
  db:         Database,
  boutiqueId: number,
  query:      Record<string, string>
): Promise<{ data: any[]; pagination: any }> {
  const { page, limit, offset } = parsePagination(query)
  const statut      = query.statut     ?? null     // active | expiree | consommee
  const search      = query.search     ?? null
  const clientId    = query.client_id  ? Number(query.client_id)  : null
  const expiresSoon = query.expires_soon === '1'   // expire dans les 7 prochains jours

  const conditions: string[] = ['g.boutique_id = ?', 'g.actif = 1']
  const params: any[] = [boutiqueId]

  if (statut) {
    conditions.push('g.statut = ?')
    params.push(statut)
  }
  if (clientId) {
    conditions.push('g.client_id = ?')
    params.push(clientId)
  }
  if (search) {
    conditions.push(`(g.appareil_marque LIKE ? OR g.appareil_modele LIKE ?
                      OR c.nom LIKE ? OR c.prenom LIKE ?)`)
    const like = `%${search}%`
    params.push(like, like, like, like)
  }
  if (expiresSoon) {
    conditions.push("g.date_fin BETWEEN datetime('now') AND datetime('now', '+7 days')")
  }

  const where = conditions.join(' AND ')

  const [total, rows] = await Promise.all([
    db.get<{ cnt: number }>(`
      SELECT COUNT(*) as cnt
      FROM   garanties g
      LEFT   JOIN clients c ON c.id = g.client_id
      WHERE  ${where}
    `, params),

    db.all<any>(`
      SELECT g.*,
             c.nom    AS client_nom,
             c.prenom AS client_prenom,
             c.telephone AS client_telephone,
             t.numero AS ticket_numero,
             CAST(julianday(g.date_fin) - julianday('now') AS INTEGER) AS jours_restants
      FROM   garanties g
      LEFT   JOIN clients c ON c.id = g.client_id
      LEFT   JOIN tickets t ON t.id = g.ticket_id
      WHERE  ${where}
      ORDER  BY g.date_fin ASC
      LIMIT  ? OFFSET ?
    `, [...params, limit, offset]),
  ])

  return {
    data: rows,
    pagination: {
      page,
      limit,
      total: total?.cnt ?? 0,
      pages: Math.ceil((total?.cnt ?? 0) / limit),
    },
  }
}

/**
 * Expire automatiquement toutes les garanties dont `date_fin` < maintenant.
 * Opération périodique à appeler via cron ou à la lecture de la liste.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @returns           Nombre de garanties passées au statut `expiree`
 */
export async function checkAndExpireGaranties(
  db:         Database,
  boutiqueId: number
): Promise<number> {
  const result = await db.run(`
    UPDATE garanties
    SET    statut = 'expiree', updated_at = CURRENT_TIMESTAMP
    WHERE  boutique_id = ?
      AND  statut = 'active'
      AND  date_fin < datetime('now')
      AND  actif = 1
  `, [boutiqueId])

  return result.changes ?? 0
}

// ─── Dossiers SAV ─────────────────────────────────────────────────────────────

/**
 * Ouvre un dossier SAV et crée le ticket de réparation associé.
 *
 * Séquence :
 *  1. Vérifie la garantie (si `garantie_id` fourni) : doit être `active`
 *  2. Génère le numéro SAV via `nextNumero()`
 *  3. Crée un ticket SAV (priorité haute, statut `recu`) avec tracking_token
 *  4. Crée le dossier SAV lié à la garantie + ticket SAV
 *  5. Marque la garantie comme `consommee` (une seule utilisation)
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param userId      Identifiant de l'utilisateur créant le dossier
 * @param data        `{ garantie_id?, client_id?, motif, description? }`
 * @returns           Le dossier SAV créé (`SavRow`)
 * @throws            Error si garantie expirée, consommée ou introuvable
 */
export async function createSav(
  db:         D1Database,
  boutiqueId: number,
  userId:     number,
  data: {
    garantie_id?:       number
    client_id?:         number
    motif:              string
    description?:       string
  }
): Promise<SavRow> {
  let garantie: GarantieRow | null = null
  let ticketOrigineId: number | null = null
  let clientId = data.client_id ?? null

  // Vérification garantie
  if (data.garantie_id) {
    garantie = await db.prepare(`
      SELECT * FROM garanties
      WHERE id = ? AND boutique_id = ? AND actif = 1
    `).bind(data.garantie_id, boutiqueId).first<GarantieRow>()

    if (!garantie)
      throw new Error('Garantie introuvable ou inactive.')
    if (garantie.statut === 'expiree')
      throw new Error('Garantie expirée — SAV non éligible.')
    if (garantie.statut === 'consommee')
      throw new Error('Garantie déjà consommée.')

    ticketOrigineId = garantie.ticket_id
    clientId        = clientId ?? garantie.client_id
  }

  // Numéro SAV
  const numero = await nextNumero(db, boutiqueId, 'sav')

  // Créer un ticket SAV rattaché
  const trackingBytes = crypto.getRandomValues(new Uint8Array(16))
  const trackingToken = Array.from(trackingBytes).map(b => b.toString(16).padStart(2, '0')).join('')

  const ticketSavNumero = await nextNumero(db, boutiqueId, 'ticket')

  const ticketResult = await db.prepare(`
    INSERT INTO tickets
      (boutique_id, client_id, numero, appareil_marque, appareil_modele,
       description_panne, statut, priorite, tracking_token)
    VALUES (?, ?, ?, ?, ?, ?, 'recu', 'haute', ?)
    RETURNING id
  `).bind(
    boutiqueId,
    clientId,
    ticketSavNumero,
    garantie?.appareil_marque ?? 'SAV',
    garantie?.appareil_modele ?? '',
    `[SAV] ${data.motif}${data.description ? ' — ' + data.description : ''}`,
    trackingToken
  ).first<{ id: number }>()

  const ticketSavId = ticketResult?.id ?? null

  // Créer le dossier SAV
  const sav = await db.prepare(`
    INSERT INTO sav_dossiers
      (boutique_id, garantie_id, ticket_origine_id, ticket_sav_id,
       client_id, numero, motif, description, statut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ouvert')
    RETURNING *
  `).bind(
    boutiqueId,
    data.garantie_id    ?? null,
    ticketOrigineId,
    ticketSavId,
    clientId,
    numero,
    data.motif,
    data.description    ?? null
  ).first<SavRow>()

  if (!sav) throw new Error('Échec création dossier SAV.')

  // Marquer la garantie comme consommée
  if (garantie) {
    await db.prepare(`
      UPDATE garanties
      SET statut = 'consommee', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(garantie.id).run()
  }

  return sav
}

/**
 * Liste paginée des dossiers SAV avec filtres et enrichissement.
 *
 * Alias SQL utilisés dans la requête principale :
 *   `t_orig` → `tickets` : ticket d'origine (réparation initiale)
 *   `ts`     → `tickets` : ticket SAV créé pour ce dossier
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param query       Filtres : `statut`, `client_id`, `search`, `page`, `limit`
 * @returns           `{ data: SavRow[], pagination }`
 */
export async function listSav(
  db:         Database,
  boutiqueId: number,
  query:      Record<string, string>
): Promise<{ data: any[]; pagination: any }> {
  const { page, limit, offset } = parsePagination(query)
  const statut   = query.statut   ?? null
  const clientId = query.client_id ? Number(query.client_id) : null
  const search   = query.search   ?? null

  const conditions: string[] = ['s.boutique_id = ?', 's.actif = 1']
  const params: any[] = [boutiqueId]

  if (statut) {
    conditions.push('s.statut = ?')
    params.push(statut)
  }
  if (clientId) {
    conditions.push('s.client_id = ?')
    params.push(clientId)
  }
  if (search) {
    conditions.push('(s.numero LIKE ? OR s.motif LIKE ? OR c.nom LIKE ? OR c.prenom LIKE ?)')
    const like = `%${search}%`
    params.push(like, like, like, like)
  }

  const where = conditions.join(' AND ')

  const [total, rows] = await Promise.all([
    db.get<{ cnt: number }>(`
      SELECT COUNT(*) as cnt
      FROM   sav_dossiers s
      LEFT   JOIN clients c ON c.id = s.client_id
      WHERE  ${where}
    `, params),

    db.all<any>(`
      SELECT s.*,
             c.nom         AS client_nom,
             c.prenom      AS client_prenom,
             c.telephone   AS client_telephone,
             t_orig.numero AS ticket_origine_numero,
             ts.numero     AS ticket_sav_numero,
             g.date_fin    AS garantie_date_fin,
             g.statut      AS garantie_statut
      FROM   sav_dossiers s
      LEFT   JOIN clients  c      ON c.id      = s.client_id
      LEFT   JOIN tickets  t_orig ON t_orig.id = s.ticket_origine_id
      LEFT   JOIN tickets  ts     ON ts.id     = s.ticket_sav_id
      LEFT   JOIN garanties g     ON g.id      = s.garantie_id
      WHERE  ${where}
      ORDER  BY s.date_ouverture DESC
      LIMIT  ? OFFSET ?
    `, [...params, limit, offset]),
  ])

  return {
    data: rows,
    pagination: {
      page,
      limit,
      total: total?.cnt ?? 0,
      pages: Math.ceil((total?.cnt ?? 0) / limit),
    },
  }
}

/**
 * Récupère le détail complet d'un dossier SAV.
 *
 * Enrichit avec :
 *  - Client (nom, prénom, téléphone, email)
 *  - Ticket d'origine (`t_orig` alias) : marque, modèle, numéro
 *  - Ticket SAV (`ts` alias) : numéro, statut
 *  - Garantie : dates, durée, jours restants
 *
 * @param db          Binding D1 Cloudflare
 * @param id          Identifiant du dossier SAV
 * @param boutiqueId  Identifiant de la boutique
 * @returns           Dossier SAV enrichi ou `null` si introuvable
 */
export async function getSav(
  db:         Database,
  id:         number,
  boutiqueId: number
): Promise<any | null> {
  return db.get(`
    SELECT s.*,
           c.nom         AS client_nom,
           c.prenom      AS client_prenom,
           c.telephone   AS client_telephone,
           c.email       AS client_email,
           t_orig.numero         AS ticket_origine_numero,
           t_orig.appareil_marque AS ticket_origine_marque,
           t_orig.appareil_modele AS ticket_origine_modele,
           ts.numero     AS ticket_sav_numero,
           ts.statut     AS ticket_sav_statut,
           g.date_debut  AS garantie_date_debut,
           g.date_fin    AS garantie_date_fin,
           g.garantie_jours,
           g.statut      AS garantie_statut,
           CAST(julianday(g.date_fin) - julianday('now') AS INTEGER) AS garantie_jours_restants
    FROM   sav_dossiers s
    LEFT   JOIN clients   c      ON c.id      = s.client_id
    LEFT   JOIN tickets   t_orig ON t_orig.id = s.ticket_origine_id
    LEFT   JOIN tickets   ts     ON ts.id     = s.ticket_sav_id
    LEFT   JOIN garanties g      ON g.id      = s.garantie_id
    WHERE  s.id = ? AND s.boutique_id = ? AND s.actif = 1
  `, [id, boutiqueId])
}

/**
 * Change le statut d'un dossier SAV en respectant la machine à états.
 *
 * Transitions autorisées (`TRANSITIONS_SAV`) :
 *   ouvert → en_traitement | refuse | clos
 *   en_traitement → resolu | refuse | clos
 *   resolu → clos
 *   refuse → clos
 *   clos   → (terminal)
 *
 * Effets de bord quand statut fermant (resolu | refuse | clos) :
 *   - `date_cloture` renseignée automatiquement
 *   - Le ticket SAV associé passe en `termine` (si resolu) ou `annule`
 *
 * @param db          Binding D1 Cloudflare
 * @param id          Identifiant du dossier SAV
 * @param boutiqueId  Identifiant de la boutique
 * @param statut      Nouveau statut (doit être une transition valide)
 * @param resolution  (optionnel) Texte de résolution/refus
 * @returns           Dossier SAV mis à jour (`SavRow`)
 * @throws            Error si transition interdite ou dossier introuvable
 */
export async function updateSavStatut(
  db:         Database,
  id:         number,
  boutiqueId: number,
  statut:     string,
  resolution?: string
): Promise<SavRow> {
  const sav = await db.get<SavRow>(`
    SELECT * FROM sav_dossiers WHERE id = ? AND boutique_id = ? AND actif = 1
  `, [id, boutiqueId])

  if (!sav) throw new Error('Dossier SAV introuvable.')

  const transitions = TRANSITIONS_SAV[sav.statut] ?? []
  if (!transitions.includes(statut))
    throw new Error(`Transition invalide : ${sav.statut} → ${statut}. Autorisées : ${transitions.join(', ') || 'aucune'}`)

  const estFermant = ['resolu', 'refuse', 'clos'].includes(statut)

  const updated = await db.get<SavRow>(`
    UPDATE sav_dossiers
    SET    statut      = ?,
           resolution  = COALESCE(?, resolution),
           date_cloture = CASE WHEN ? IN ('resolu','refuse','clos') THEN CURRENT_TIMESTAMP ELSE date_cloture END,
           updated_at  = CURRENT_TIMESTAMP
    WHERE  id = ? AND boutique_id = ?
    RETURNING *
  `, [statut, resolution ?? null, statut, id, boutiqueId])

  if (!updated) throw new Error('Mise à jour SAV échouée.')

  // Clore automatiquement le ticket SAV si le dossier se ferme
  if (estFermant && sav.ticket_sav_id) {
    const ticketStatut = statut === 'resolu' ? 'termine' : 'annule'
    await db.run(`
      UPDATE tickets
      SET statut = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND statut NOT IN ('livre','annule')
    `, [ticketStatut, sav.ticket_sav_id])
  }

  return updated
}

/**
 * Calcule les KPIs SAV & Garanties pour le tableau de bord.
 * Exécute 5 requêtes en parallèle via `Promise.all`.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @returns           `{ garanties_actives, garanties_expirees, garanties_consommees,
 *                    garanties_expirant_7j, sav_ouverts, sav_en_traitement,
 *                    sav_resolus_mois, taux_retour_pct }`
 *                    — `taux_retour_pct` : % garanties consommées / total garanties
 */
export async function getKpisSav(
  db:         Database,
  boutiqueId: number
): Promise<{
  garanties_actives:   number
  garanties_expirees:  number
  garanties_consommees: number
  garanties_expirant_7j: number
  sav_ouverts:         number
  sav_en_traitement:   number
  sav_resolus_mois:    number
  taux_retour_pct:     number
}> {
  const [
    statsGaranties,
    expiresSoon,
    statsSav,
    resolusM,
  ] = await Promise.all([
    db.get<{ actives: number; expirees: number; consommees: number }>(`
      SELECT
        SUM(CASE WHEN statut='active'    THEN 1 ELSE 0 END) AS actives,
        SUM(CASE WHEN statut='expiree'   THEN 1 ELSE 0 END) AS expirees,
        SUM(CASE WHEN statut='consommee' THEN 1 ELSE 0 END) AS consommees
      FROM garanties WHERE boutique_id = ? AND actif = 1
    `, [boutiqueId]),

    db.get<{ cnt: number }>(`
      SELECT COUNT(*) as cnt FROM garanties
      WHERE boutique_id = ? AND statut = 'active' AND actif = 1
        AND date_fin BETWEEN datetime('now') AND datetime('now', '+7 days')
    `, [boutiqueId]),

    db.get<{ ouverts: number; en_traitement: number }>(`
      SELECT
        SUM(CASE WHEN statut='ouvert'        THEN 1 ELSE 0 END) AS ouverts,
        SUM(CASE WHEN statut='en_traitement' THEN 1 ELSE 0 END) AS en_traitement
      FROM sav_dossiers WHERE boutique_id = ? AND actif = 1
    `, [boutiqueId]),

    db.get<{ cnt: number }>(`
      SELECT COUNT(*) as cnt FROM sav_dossiers
      WHERE boutique_id = ? AND statut IN ('resolu','clos') AND actif = 1
        AND strftime('%Y-%m', date_cloture) = strftime('%Y-%m', 'now')
    `, [boutiqueId]),
  ])

  const totalG  = (statsGaranties?.actives ?? 0) + (statsGaranties?.expirees ?? 0) + (statsGaranties?.consommees ?? 0)
  const nbRetour = statsGaranties?.consommees ?? 0
  const taux     = totalG > 0 ? Math.round((nbRetour / totalG) * 100 * 10) / 10 : 0

  return {
    garanties_actives:    statsGaranties?.actives    ?? 0,
    garanties_expirees:   statsGaranties?.expirees   ?? 0,
    garanties_consommees: statsGaranties?.consommees ?? 0,
    garanties_expirant_7j: expiresSoon?.cnt          ?? 0,
    sav_ouverts:          statsSav?.ouverts          ?? 0,
    sav_en_traitement:    statsSav?.en_traitement     ?? 0,
    sav_resolus_mois:     resolusM?.cnt              ?? 0,
    taux_retour_pct:      taux,
  }
}
