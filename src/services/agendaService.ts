/**
 * @module agendaService
 * @description Model P1 : Logique métier Agenda / Rendez-vous + export iCal.
 *
 * Rôle architectural (P1 MVC) : Model exclusif — tout le SQL est ici.
 * Les routes `src/routes/agenda.ts` délèguent à ce service sans aucun `.prepare()`.
 *
 * Machine à états RDV :
 *   PENDING → SCHEDULED | CANCELLED
 *   SCHEDULED → DONE | NO_SHOW | CANCELLED | CONVERTED
 *   DONE, CANCELLED, CONVERTED → (terminal)
 *   NO_SHOW → SCHEDULED (re-planification possible)
 *
 * Export iCal : flux RFC 5545 compatible Google Calendar / Apple Calendar.
 * Le token iCal est par boutique, généré via Web Crypto (16 bytes hex).
 *
 * Sprint 2.6 — MOD-08 Agenda
 */

import { parsePagination } from '../lib/db'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Représentation complète d'un rendez-vous en base. */
export interface RendezVous {
  id:               number
  boutique_id:      number
  client_id:        number | null
  ticket_id:        number | null
  user_id:          number | null   // technicien assigné
  titre:            string
  description:      string | null
  debut:            string          // ISO datetime local : "2026-06-10 14:30:00"
  fin:              string
  duree_minutes:    number
  statut:           string          // voir STATUTS_RDV
  type_rdv:         string          // voir TYPES_RDV
  nom_client:       string | null   // client non enregistré
  telephone_client: string | null
  rappel_envoye:    number          // 0 | 1
  rappel_minutes:   number          // délai de rappel avant le RDV
  ical_token:       string | null   // identifiant unique pour le flux iCal
  couleur:          string | null   // couleur hex affichée dans le calendrier
  notes:            string | null
}

/** Statuts valides pour un RDV (voir machine à états dans updateStatutRdv). */
export const STATUTS_RDV = ['PENDING','SCHEDULED','DONE','NO_SHOW','CANCELLED','CONVERTED'] as const

/** Types de rendez-vous disponibles. */
export const TYPES_RDV   = ['reparation','restitution','devis','diagnostic','autre'] as const

// ─── Helpers privés ───────────────────────────────────────────────────────────

/**
 * Génère un token aléatoire unique de 16 octets en hexadécimal.
 * Utilise Web Crypto API (compatible Cloudflare Workers, pas Node.js).
 *
 * @returns Token hex de 32 caractères (ex: "a3f9b2c1d4e5f608...")
 */
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Calcule la date/heure de fin à partir du début et de la durée.
 * Utilisé quand le champ `fin` n'est pas fourni par le client.
 *
 * @param debut         Date/heure de début (ISO string ou "YYYY-MM-DD HH:MM:SS")
 * @param dureeMinutes  Durée en minutes à ajouter
 * @returns             Datetime de fin au format "YYYY-MM-DD HH:MM:SS"
 */
function computeFin(debut: string, dureeMinutes: number): string {
  const d = new Date(debut)
  d.setMinutes(d.getMinutes() + dureeMinutes)
  // Normalise vers le format SQLite sans millisecondes
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
}

// ─── CRUD Rendez-vous ─────────────────────────────────────────────────────────

/**
 * Liste les rendez-vous d'une boutique avec pagination et filtres.
 *
 * Filtres disponibles via `query` :
 *  - `date_debut`  : RDV dont le début est ≥ cette date
 *  - `date_fin`    : RDV dont le début est ≤ cette date
 *  - `statut`      : filtre par statut exact (PENDING, SCHEDULED, etc.)
 *  - `user_id`     : filtre par technicien assigné
 *  - `type_rdv`    : filtre par type (reparation, devis, etc.)
 *  - `client_id`   : filtre par client enregistré
 *  - `search`      : recherche plein-texte sur titre, nom_client, téléphone, nom/prénom client
 *  - `page`, `limit` : pagination (défaut : page=1, limit=20)
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique (isolation multi-tenant)
 * @param query       Paramètres de filtrage issus des query params HTTP
 * @returns           `{ data: RendezVous[], total, page, limit }`
 */
export async function listRendezVous(
  db: D1Database,
  boutiqueId: number,
  query: Record<string, string> = {}
) {
  const conditions: string[] = ['r.boutique_id = ?', 'r.actif = 1']
  const bindings: any[]      = [boutiqueId]

  if (query.date_debut) {
    conditions.push("r.debut >= ?")
    bindings.push(query.date_debut)
  }
  if (query.date_fin) {
    conditions.push("r.debut <= ?")
    bindings.push(query.date_fin)
  }
  if (query.statut) {
    conditions.push("r.statut = ?")
    bindings.push(query.statut)
  }
  if (query.user_id) {
    conditions.push("r.user_id = ?")
    bindings.push(Number(query.user_id))
  }
  if (query.type_rdv) {
    conditions.push("r.type_rdv = ?")
    bindings.push(query.type_rdv)
  }
  if (query.search) {
    // Recherche multi-champs : titre, client libre ou enregistré, téléphone
    conditions.push("(r.titre LIKE ? OR r.nom_client LIKE ? OR r.telephone_client LIKE ? OR c.nom LIKE ? OR c.prenom LIKE ?)")
    const s = `%${query.search}%`
    bindings.push(s, s, s, s, s)
  }
  if (query.client_id) {
    conditions.push("r.client_id = ?")
    bindings.push(Number(query.client_id))
  }

  const where = 'WHERE ' + conditions.join(' AND ')

  const { limit, offset, page } = parsePagination(query)

  // Deux requêtes parallèles : count total + page courante
  const total = await db.prepare(
    `SELECT COUNT(*) as cnt
     FROM rendez_vous r
     LEFT JOIN clients c ON c.id = r.client_id
     ${where}`
  ).bind(...bindings).first<{ cnt: number }>()

  const rows = await db.prepare(`
    SELECT
      r.*,
      c.nom        AS client_nom,
      c.prenom     AS client_prenom,
      c.telephone  AS client_tel,
      c.email      AS client_email,
      u.prenom     AS tech_prenom,
      u.nom        AS tech_nom
    FROM rendez_vous r
    LEFT JOIN clients c ON c.id = r.client_id
    LEFT JOIN users   u ON u.id = r.user_id
    ${where}
    ORDER BY r.debut ASC
    LIMIT ? OFFSET ?
  `).bind(...bindings, limit, offset).all<any>()

  return {
    data:  rows.results ?? [],
    total: total?.cnt ?? 0,
    page,
    limit,
  }
}

/**
 * Récupère un rendez-vous par son identifiant.
 * Joint les infos client, technicien et ticket associé.
 *
 * @param db          Binding D1 Cloudflare
 * @param id          Identifiant du RDV
 * @param boutiqueId  Identifiant de la boutique (isolation multi-tenant)
 * @returns           RDV enrichi (client, tech, ticket) ou `null` si introuvable / soft-deleted
 */
export async function getRendezVous(db: D1Database, id: number, boutiqueId: number) {
  return db.prepare(`
    SELECT
      r.*,
      c.nom        AS client_nom,
      c.prenom     AS client_prenom,
      c.telephone  AS client_tel,
      c.email      AS client_email,
      u.prenom     AS tech_prenom,
      u.nom        AS tech_nom,
      t.numero     AS ticket_numero,
      t.statut     AS ticket_statut
    FROM rendez_vous r
    LEFT JOIN clients c ON c.id = r.client_id
    LEFT JOIN users   u ON u.id = r.user_id
    LEFT JOIN tickets t ON t.id = r.ticket_id
    WHERE r.id = ? AND r.boutique_id = ? AND r.actif = 1
  `).bind(id, boutiqueId).first<any>()
}

/**
 * Crée un nouveau rendez-vous.
 *
 * Comportement :
 *  - Si `body.fin` absent, calcule automatiquement via `computeFin(debut, duree_minutes)`
 *  - Génère un `ical_token` unique (Web Crypto, 16 bytes hex) pour l'export iCal individuel
 *  - Si `body.user_id` absent, assigne le créateur du RDV (`userId`)
 *  - Statut par défaut : `PENDING`
 *  - Type par défaut : `reparation`
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param body        Données du formulaire (titre, debut, duree_minutes, client_id, etc.)
 * @param userId      Identifiant de l'utilisateur créant le RDV
 * @returns           `{ id }` du RDV créé
 * @throws            Error si l'insertion échoue
 */
export async function createRendezVous(
  db: D1Database,
  boutiqueId: number,
  body: any,
  userId: number
): Promise<{ id: number }> {
  const duree  = Number(body.duree_minutes) || 30
  const debut  = body.debut
  // Calcul automatique de fin si non fournie
  const fin    = body.fin || computeFin(debut, duree)
  // Token unique pour l'intégration iCal / rappel email
  const token  = generateToken()

  const result = await db.prepare(`
    INSERT INTO rendez_vous
      (boutique_id, client_id, ticket_id, user_id,
       titre, description, debut, fin, duree_minutes,
       statut, type_rdv,
       nom_client, telephone_client,
       rappel_minutes, ical_token, couleur, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    RETURNING id
  `).bind(
    boutiqueId,
    body.client_id    ? Number(body.client_id)    : null,
    body.ticket_id    ? Number(body.ticket_id)    : null,
    body.user_id      ? Number(body.user_id)      : userId,  // fallback : créateur
    body.titre.trim(),
    body.description  || null,
    debut,
    fin,
    duree,
    body.statut       || 'PENDING',
    body.type_rdv     || 'reparation',
    body.nom_client   || null,
    body.telephone_client || null,
    Number(body.rappel_minutes) || 60,
    token,
    body.couleur      || '#3B82F6',
    body.notes        || null
  ).first<{ id: number }>()

  if (!result?.id) throw new Error('Erreur création RDV.')
  return { id: result.id }
}

/**
 * Met à jour tous les champs modifiables d'un rendez-vous.
 * Les champs non fournis dans `body` conservent leurs valeurs existantes.
 *
 * @param db          Binding D1 Cloudflare
 * @param id          Identifiant du RDV à modifier
 * @param boutiqueId  Identifiant de la boutique (isolation multi-tenant)
 * @param body        Champs à mettre à jour (tous optionnels)
 * @throws            Error si le RDV est introuvable ou soft-deleted
 */
export async function updateRendezVous(
  db: D1Database,
  id: number,
  boutiqueId: number,
  body: any
): Promise<void> {
  // Lire l'état actuel pour les fallbacks (champs non modifiés)
  const rdv = await db.prepare(
    'SELECT * FROM rendez_vous WHERE id = ? AND boutique_id = ? AND actif = 1'
  ).bind(id, boutiqueId).first<RendezVous>()

  if (!rdv) throw new Error('RDV introuvable.')

  // Recalcul de fin si debut ou duree changent
  const duree = Number(body.duree_minutes) || rdv.duree_minutes
  const debut = body.debut || rdv.debut
  const fin   = body.fin   || computeFin(debut, duree)

  await db.prepare(`
    UPDATE rendez_vous
    SET
      client_id        = ?,
      ticket_id        = ?,
      user_id          = ?,
      titre            = ?,
      description      = ?,
      debut            = ?,
      fin              = ?,
      duree_minutes    = ?,
      statut           = ?,
      type_rdv         = ?,
      nom_client       = ?,
      telephone_client = ?,
      rappel_minutes   = ?,
      couleur          = ?,
      notes            = ?,
      updated_at       = CURRENT_TIMESTAMP
    WHERE id = ? AND boutique_id = ?
  `).bind(
    body.client_id    != null ? Number(body.client_id)    : rdv.client_id,
    body.ticket_id    != null ? Number(body.ticket_id)    : rdv.ticket_id,
    body.user_id      != null ? Number(body.user_id)      : rdv.user_id,
    body.titre?.trim()        ?? rdv.titre,
    body.description          ?? rdv.description,
    debut,
    fin,
    duree,
    body.statut               ?? rdv.statut,
    body.type_rdv             ?? rdv.type_rdv,
    body.nom_client           ?? rdv.nom_client,
    body.telephone_client     ?? rdv.telephone_client,
    body.rappel_minutes != null ? Number(body.rappel_minutes) : rdv.rappel_minutes,
    body.couleur              ?? rdv.couleur,
    body.notes                ?? rdv.notes,
    id,
    boutiqueId
  ).run()
}

/**
 * Change uniquement le statut d'un RDV en validant la machine à états.
 *
 * Transitions autorisées :
 *  - PENDING   → SCHEDULED | CANCELLED
 *  - SCHEDULED → DONE | NO_SHOW | CANCELLED | CONVERTED
 *  - NO_SHOW   → SCHEDULED (re-planification)
 *  - DONE, CANCELLED, CONVERTED → aucune transition (états terminaux)
 *
 * @param db            Binding D1 Cloudflare
 * @param id            Identifiant du RDV
 * @param boutiqueId    Identifiant de la boutique
 * @param nouveauStatut Statut cible (doit figurer dans STATUTS_RDV)
 * @throws              Error si transition interdite ou RDV introuvable
 */
export async function updateStatutRdv(
  db: D1Database,
  id: number,
  boutiqueId: number,
  nouveauStatut: string
): Promise<void> {
  const rdv = await db.prepare(
    'SELECT statut FROM rendez_vous WHERE id = ? AND boutique_id = ? AND actif = 1'
  ).bind(id, boutiqueId).first<{ statut: string }>()

  if (!rdv) throw new Error('RDV introuvable.')

  // Matrice des transitions valides par statut courant
  const transitions: Record<string, string[]> = {
    PENDING:   ['SCHEDULED', 'CANCELLED'],
    SCHEDULED: ['DONE', 'NO_SHOW', 'CANCELLED', 'CONVERTED'],
    DONE:      [],                    // terminal — aucune transition
    NO_SHOW:   ['SCHEDULED'],         // re-planification possible après absence
    CANCELLED: [],                    // terminal
    CONVERTED: [],                    // terminal (ticket créé depuis RDV)
  }

  const allowed = transitions[rdv.statut] ?? []
  if (!allowed.includes(nouveauStatut)) {
    throw new Error(`Transition interdite : ${rdv.statut} → ${nouveauStatut}. Autorisées : ${allowed.join(', ') || 'aucune'}`)
  }

  await db.prepare(`
    UPDATE rendez_vous
    SET statut = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND boutique_id = ?
  `).bind(nouveauStatut, id, boutiqueId).run()
}

/**
 * Suppression logique (soft delete) d'un rendez-vous.
 * Positionne `actif = 0` — le RDV n'apparaît plus dans aucune liste.
 *
 * @param db          Binding D1 Cloudflare
 * @param id          Identifiant du RDV à supprimer
 * @param boutiqueId  Identifiant de la boutique
 * @throws            Error si le RDV est introuvable ou déjà supprimé
 */
export async function deleteRendezVous(db: D1Database, id: number, boutiqueId: number): Promise<void> {
  const rdv = await db.prepare(
    'SELECT id FROM rendez_vous WHERE id = ? AND boutique_id = ? AND actif = 1'
  ).bind(id, boutiqueId).first()
  if (!rdv) throw new Error('RDV introuvable.')

  await db.prepare(
    'UPDATE rendez_vous SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(id).run()
}

// ─── Vue agenda (plage de dates) ─────────────────────────────────────────────

/**
 * Retourne les rendez-vous d'une plage de dates groupés par jour.
 * Exclut les RDV annulés. Utile pour l'affichage en vue calendrier.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param dateDebut   Date de début incluse (ISO : "2026-06-01" ou "2026-06-01 00:00:00")
 * @param dateFin     Date de fin incluse
 * @param userId      (optionnel) Filtre sur un technicien spécifique
 * @returns           Dictionnaire `{ "YYYY-MM-DD": RendezVous[] }` trié par heure
 */
export async function getAgendaView(
  db: D1Database,
  boutiqueId: number,
  dateDebut: string,
  dateFin: string,
  userId?: number
) {
  const conditions: string[] = [
    'r.boutique_id = ?',
    'r.actif = 1',
    "r.debut >= ?",
    "r.debut <= ?",
    "r.statut != 'CANCELLED'"  // les annulés n'apparaissent pas dans la vue calendrier
  ]
  const bindings: any[] = [boutiqueId, dateDebut, dateFin]

  if (userId) {
    conditions.push('r.user_id = ?')
    bindings.push(userId)
  }

  const where = 'WHERE ' + conditions.join(' AND ')

  const rows = await db.prepare(`
    SELECT
      r.*,
      c.nom       AS client_nom,
      c.prenom    AS client_prenom,
      c.telephone AS client_tel,
      u.prenom    AS tech_prenom,
      u.nom       AS tech_nom
    FROM rendez_vous r
    LEFT JOIN clients c ON c.id = r.client_id
    LEFT JOIN users   u ON u.id = r.user_id
    ${where}
    ORDER BY r.debut ASC
  `).bind(...bindings).all<any>()

  // Regroupement par date YYYY-MM-DD (première partie du datetime)
  const grouped: Record<string, any[]> = {}
  for (const rdv of rows.results ?? []) {
    const dateKey = rdv.debut.slice(0, 10)
    if (!grouped[dateKey]) grouped[dateKey] = []
    grouped[dateKey].push(rdv)
  }

  return grouped
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

/**
 * Calcule les KPIs de l'agenda pour le tableau de bord.
 * Exécute 5 requêtes en parallèle via `Promise.all`.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @returns           `{ total_rdv, rdv_auj, rdv_semaine, en_attente, taux_honore }`
 *                    - `taux_honore` : % de RDV passés au statut DONE sur le total non-annulé
 */
export async function getKpisAgenda(db: D1Database, boutiqueId: number) {
  const today     = new Date().toISOString().slice(0, 10)
  const weekStart = getWeekStart(new Date())
  const weekEnd   = getWeekEnd(new Date())

  // 5 requêtes parallèles pour performance maximale
  const [total, aujourdhui, semaine, en_attente, taux_done] = await Promise.all([
    // Total RDV non-annulés (dénominateur du taux honoré)
    db.prepare("SELECT COUNT(*) as cnt FROM rendez_vous WHERE boutique_id=? AND actif=1 AND statut!='CANCELLED'")
      .bind(boutiqueId).first<{ cnt: number }>(),
    // RDV du jour calendaire
    db.prepare("SELECT COUNT(*) as cnt FROM rendez_vous WHERE boutique_id=? AND actif=1 AND DATE(debut)=? AND statut!='CANCELLED'")
      .bind(boutiqueId, today).first<{ cnt: number }>(),
    // RDV de la semaine courante (lundi–dimanche)
    db.prepare("SELECT COUNT(*) as cnt FROM rendez_vous WHERE boutique_id=? AND actif=1 AND debut>=? AND debut<=? AND statut!='CANCELLED'")
      .bind(boutiqueId, weekStart, weekEnd).first<{ cnt: number }>(),
    // RDV en attente de confirmation ou planifiés
    db.prepare("SELECT COUNT(*) as cnt FROM rendez_vous WHERE boutique_id=? AND actif=1 AND statut IN ('PENDING','SCHEDULED')")
      .bind(boutiqueId).first<{ cnt: number }>(),
    // RDV effectivement honorés (DONE) — numérateur du taux
    db.prepare("SELECT COUNT(*) as cnt FROM rendez_vous WHERE boutique_id=? AND actif=1 AND statut='DONE'")
      .bind(boutiqueId).first<{ cnt: number }>(),
  ])

  const totalDone = total?.cnt ?? 0
  const nbDone    = taux_done?.cnt ?? 0

  return {
    total_rdv:    totalDone,
    rdv_auj:      aujourdhui?.cnt ?? 0,
    rdv_semaine:  semaine?.cnt    ?? 0,
    en_attente:   en_attente?.cnt ?? 0,
    // Taux d'honoré en % — 0 si aucun RDV
    taux_honore:  totalDone > 0 ? Math.round((nbDone / totalDone) * 100) : 0,
  }
}

// ─── Export iCal ─────────────────────────────────────────────────────────────

/**
 * Récupère le token iCal d'une boutique, ou le crée s'il n'existe pas.
 * Le token est stocké dans `boutique_ical_tokens` et est permanent.
 * Il sert d'URL secrète pour le flux iCal public (pas d'authentification JWT).
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @returns           Token hex (32 caractères)
 */
export async function getOrCreateIcalToken(db: D1Database, boutiqueId: number): Promise<string> {
  const existing = await db.prepare(
    'SELECT token FROM boutique_ical_tokens WHERE boutique_id = ?'
  ).bind(boutiqueId).first<{ token: string }>()

  if (existing?.token) return existing.token

  // Créer un nouveau token permanent pour cette boutique
  const token = generateToken()
  await db.prepare(
    'INSERT INTO boutique_ical_tokens (boutique_id, token) VALUES (?, ?)'
  ).bind(boutiqueId, token).run()
  return token
}

/**
 * Génère le flux iCal (format RFC 5545) pour l'agenda d'une boutique.
 * Compatible Google Calendar, Apple Calendar, Outlook.
 *
 * Inclut les RDV SCHEDULED, PENDING et DONE des 30 derniers jours.
 * Limité à 500 événements. Le flux est stateless — recalculé à chaque appel.
 *
 * Format de sortie : texte iCal avec CRLF (`\r\n`) obligatoire selon RFC 5545.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @returns           Chaîne iCal complète (Content-Type: text/calendar)
 */
export async function generateIcal(db: D1Database, boutiqueId: number): Promise<string> {
  const boutique = await db.prepare(
    'SELECT nom FROM boutiques WHERE id = ?'
  ).bind(boutiqueId).first<{ nom: string }>()

  const rows = await db.prepare(`
    SELECT r.*, c.nom AS client_nom, c.prenom AS client_prenom
    FROM rendez_vous r
    LEFT JOIN clients c ON c.id = r.client_id
    WHERE r.boutique_id = ? AND r.actif = 1
      AND r.statut IN ('SCHEDULED','PENDING','DONE')
      AND r.debut >= datetime('now', '-30 days')
    ORDER BY r.debut ASC
    LIMIT 500
  `).bind(boutiqueId).all<any>()

  // En-tête du calendrier iCal (RFC 5545 §3.4)
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//iziGSM//Agenda//FR',
    `X-WR-CALNAME:${escIcal(boutique?.nom ?? 'iziGSM')}`,
    'X-WR-TIMEZONE:Europe/Paris',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  // Génération d'un VEVENT par rendez-vous
  for (const rdv of rows.results ?? []) {
    const dtStart = toIcalDate(rdv.debut)
    const dtEnd   = toIcalDate(rdv.fin)
    const summary = escIcal(rdv.titre)

    // Construction de la description : client + téléphone + notes
    const clientLabel = rdv.client_nom
      ? `${rdv.client_prenom ?? ''} ${rdv.client_nom}`.trim()
      : rdv.nom_client ?? ''
    const desc = escIcal([
      clientLabel ? `Client : ${clientLabel}` : '',
      rdv.telephone_client ? `Tél : ${rdv.telephone_client}` : '',
      rdv.description ?? '',
    ].filter(Boolean).join('\\n'))

    // UID stable : rdv-{id}-{ical_token} — permet la mise à jour dans les agendas clients
    const uid = `rdv-${rdv.id}-${rdv.ical_token ?? 'nk'}@izigsm`

    const vevent = [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${toIcalDate(rdv.created_at ?? new Date().toISOString())}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${summary}`,
      desc ? `DESCRIPTION:${desc}` : '',
      `STATUS:${rdv.statut === 'DONE' ? 'COMPLETED' : 'CONFIRMED'}`,
      `CATEGORIES:${rdv.type_rdv.toUpperCase()}`,
      'END:VEVENT',
    ].filter(l => l !== '')
    lines.push(...vevent)
  }

  lines.push('END:VCALENDAR')
  // RFC 5545 impose CRLF comme séparateur de lignes
  return lines.join('\r\n') + '\r\n'
}

// ─── Utilitaires iCal (helpers privés) ───────────────────────────────────────

/**
 * Convertit un datetime SQLite/ISO en format iCal UTC.
 * Ex: "2026-06-10 14:30:00" → "20260610T143000Z"
 *
 * @param str  Date au format "YYYY-MM-DD HH:MM:SS" ou ISO 8601
 * @returns    Date au format iCal UTC (15 caractères + "Z")
 */
function toIcalDate(str: string): string {
  return str.replace(/[-:]/g, '').replace(' ', 'T').replace(/\.\d{3}$/, '').slice(0, 15) + 'Z'
}

/**
 * Échappe les caractères réservés du format iCal (RFC 5545 §3.3.11).
 * Traite : `\`, `;`, `,`, `\n`
 *
 * @param s  Chaîne à échapper
 * @returns  Chaîne avec caractères spéciaux échappés
 */
function escIcal(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/**
 * Retourne la date/heure du lundi de la semaine courante (ISO local).
 * Utilisé par getKpisAgenda() pour délimiter la semaine calendaire.
 *
 * @param d  Date de référence
 * @returns  "YYYY-MM-DD 00:00:00" du lundi de la semaine
 */
function getWeekStart(d: Date): string {
  const day = d.getDay() || 7  // getDay() retourne 0 pour dimanche → normalise à 7
  const monday = new Date(d)
  monday.setDate(d.getDate() - day + 1)
  monday.setHours(0, 0, 0, 0)
  return monday.toISOString().replace('T', ' ').slice(0, 19)
}

/**
 * Retourne la date/heure du dimanche de la semaine courante (ISO local).
 *
 * @param d  Date de référence
 * @returns  "YYYY-MM-DD 23:59:59" du dimanche de la semaine
 */
function getWeekEnd(d: Date): string {
  const day = d.getDay() || 7
  const sunday = new Date(d)
  sunday.setDate(d.getDate() - day + 7)
  sunday.setHours(23, 59, 59, 0)
  return sunday.toISOString().replace('T', ' ').slice(0, 19)
}
