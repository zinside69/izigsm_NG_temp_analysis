/**
 * services/agendaService.ts — Logique métier : Agenda / Rendez-vous + iCal
 * Rôle architectural (P3 BFF Hono) : Model — tout le SQL ici.
 * Sprint 2.6 — MOD-08 Agenda
 */

import { parsePagination } from '../lib/db'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RendezVous {
  id:               number
  boutique_id:      number
  client_id:        number | null
  ticket_id:        number | null
  user_id:          number | null
  titre:            string
  description:      string | null
  debut:            string
  fin:              string
  duree_minutes:    number
  statut:           string
  type_rdv:         string
  nom_client:       string | null
  telephone_client: string | null
  rappel_envoye:    number
  rappel_minutes:   number
  ical_token:       string | null
  couleur:          string | null
  notes:            string | null
}

// Statuts valides
export const STATUTS_RDV = ['PENDING','SCHEDULED','DONE','NO_SHOW','CANCELLED','CONVERTED'] as const
export const TYPES_RDV   = ['reparation','restitution','devis','diagnostic','autre'] as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Génère un token unique (16 bytes hex) — Web Crypto API (pas Node.js) */
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Calcule la fin à partir du début + durée si fin non fournie.
 */
function computeFin(debut: string, dureeMinutes: number): string {
  const d = new Date(debut)
  d.setMinutes(d.getMinutes() + dureeMinutes)
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
}

// ─── CRUD Rendez-vous ─────────────────────────────────────────────────────────

/**
 * Liste les RDV d'une boutique.
 * Filtres : date_debut, date_fin, statut, user_id, type_rdv, search
 * Inclut infos client et technicien.
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
 * Récupère un RDV par son id, avec toutes les infos liées.
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
 * Génère un ical_token unique.
 */
export async function createRendezVous(
  db: D1Database,
  boutiqueId: number,
  body: any,
  userId: number
): Promise<{ id: number }> {
  const duree  = Number(body.duree_minutes) || 30
  const debut  = body.debut
  const fin    = body.fin || computeFin(debut, duree)
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
    body.user_id      ? Number(body.user_id)      : userId,
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
 * Met à jour un rendez-vous (tous champs modifiables).
 */
export async function updateRendezVous(
  db: D1Database,
  id: number,
  boutiqueId: number,
  body: any
): Promise<void> {
  const rdv = await db.prepare(
    'SELECT * FROM rendez_vous WHERE id = ? AND boutique_id = ? AND actif = 1'
  ).bind(id, boutiqueId).first<RendezVous>()

  if (!rdv) throw new Error('RDV introuvable.')

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
 * Change uniquement le statut d'un RDV.
 * Transitions valides uniquement.
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

  // Transitions autorisées
  const transitions: Record<string, string[]> = {
    PENDING:   ['SCHEDULED', 'CANCELLED'],
    SCHEDULED: ['DONE', 'NO_SHOW', 'CANCELLED', 'CONVERTED'],
    DONE:      [],
    NO_SHOW:   ['SCHEDULED'],
    CANCELLED: [],
    CONVERTED: [],
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
 * Suppression logique d'un RDV.
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
 * Vue calendrier : RDV groupés par date (pour affichage agenda).
 * Retourne un objet { "2026-06-10": [rdv1, rdv2], ... }
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
    "r.statut != 'CANCELLED'"
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

  // Grouper par date YYYY-MM-DD
  const grouped: Record<string, any[]> = {}
  for (const rdv of rows.results ?? []) {
    const dateKey = rdv.debut.slice(0, 10)
    if (!grouped[dateKey]) grouped[dateKey] = []
    grouped[dateKey].push(rdv)
  }

  return grouped
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

export async function getKpisAgenda(db: D1Database, boutiqueId: number) {
  const today     = new Date().toISOString().slice(0, 10)
  const weekStart = getWeekStart(new Date())
  const weekEnd   = getWeekEnd(new Date())

  const [total, aujourdhui, semaine, en_attente, taux_done] = await Promise.all([
    db.prepare("SELECT COUNT(*) as cnt FROM rendez_vous WHERE boutique_id=? AND actif=1 AND statut!='CANCELLED'")
      .bind(boutiqueId).first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM rendez_vous WHERE boutique_id=? AND actif=1 AND DATE(debut)=? AND statut!='CANCELLED'")
      .bind(boutiqueId, today).first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM rendez_vous WHERE boutique_id=? AND actif=1 AND debut>=? AND debut<=? AND statut!='CANCELLED'")
      .bind(boutiqueId, weekStart, weekEnd).first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM rendez_vous WHERE boutique_id=? AND actif=1 AND statut IN ('PENDING','SCHEDULED')")
      .bind(boutiqueId).first<{ cnt: number }>(),
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
    taux_honore:  totalDone > 0 ? Math.round((nbDone / totalDone) * 100) : 0,
  }
}

// ─── Export iCal ─────────────────────────────────────────────────────────────

/**
 * Récupère ou crée le token iCal d'une boutique.
 */
export async function getOrCreateIcalToken(db: D1Database, boutiqueId: number): Promise<string> {
  const existing = await db.prepare(
    'SELECT token FROM boutique_ical_tokens WHERE boutique_id = ?'
  ).bind(boutiqueId).first<{ token: string }>()

  if (existing?.token) return existing.token

  const token = generateToken()
  await db.prepare(
    'INSERT INTO boutique_ical_tokens (boutique_id, token) VALUES (?, ?)'
  ).bind(boutiqueId, token).run()
  return token
}

/**
 * Génère le flux iCal (.ics) pour une boutique.
 * Retourne une chaîne au format RFC 5545.
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

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//iziGSM//Agenda//FR',
    `X-WR-CALNAME:${escIcal(boutique?.nom ?? 'iziGSM')}`,
    'X-WR-TIMEZONE:Europe/Paris',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  for (const rdv of rows.results ?? []) {
    const dtStart = toIcalDate(rdv.debut)
    const dtEnd   = toIcalDate(rdv.fin)
    const summary = escIcal(rdv.titre)
    const clientLabel = rdv.client_nom
      ? `${rdv.client_prenom ?? ''} ${rdv.client_nom}`.trim()
      : rdv.nom_client ?? ''
    const desc = escIcal([
      clientLabel ? `Client : ${clientLabel}` : '',
      rdv.telephone_client ? `Tél : ${rdv.telephone_client}` : '',
      rdv.description ?? '',
    ].filter(Boolean).join('\\n'))

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
  return lines.join('\r\n') + '\r\n'
}

// ─── Utilitaires iCal ─────────────────────────────────────────────────────────

/** Convertit "2026-06-10 14:30:00" → "20260610T143000Z" */
function toIcalDate(str: string): string {
  return str.replace(/[-:]/g, '').replace(' ', 'T').replace(/\.\d{3}$/, '').slice(0, 15) + 'Z'
}

/** Échappe les caractères spéciaux iCal */
function escIcal(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/** Lundi de la semaine courante au format ISO */
function getWeekStart(d: Date): string {
  const day = d.getDay() || 7
  const monday = new Date(d)
  monday.setDate(d.getDate() - day + 1)
  monday.setHours(0, 0, 0, 0)
  return monday.toISOString().replace('T', ' ').slice(0, 19)
}

/** Dimanche de la semaine courante au format ISO */
function getWeekEnd(d: Date): string {
  const day = d.getDay() || 7
  const sunday = new Date(d)
  sunday.setDate(d.getDate() - day + 7)
  sunday.setHours(23, 59, 59, 0)
  return sunday.toISOString().replace('T', ' ').slice(0, 19)
}
