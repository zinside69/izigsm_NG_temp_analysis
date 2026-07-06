/**
 * ticketService.ts — Model layer pour la gestion des tickets de réparation
 * Sprint 2.17 — Extraction depuis routes/tickets.ts (violation P1 résolue)
 *
 * Périmètre : tickets, historique statuts, photos, Kanban.
 * Aucun SQL ne doit subsister dans routes/tickets.ts après ce sprint.
 *
 * Machine à états :
 *   recu → en_diagnostic → attente_accord → a_commander → commande
 *        → pieces_recues → en_reparation → termine → livre
 *   Depuis tout état non terminal → annule
 *
 * Fonctions exportées :
 *   listTickets(db, boutiqueId, opts)              — Liste paginée avec filtres (dont archived)
 *   getKanban(db, boutiqueId)                      — Vue Kanban groupée par statut
 *   getTicketById(db, id)                          — Fiche complète (+ historique + photos)
 *   createTicket(db, boutiqueId, userId, data)     — Création + historique initial
 *   updateTicket(db, id, userId, data)             — Mise à jour champs éditables
 *   updateStatut(db, id, userId, statut, comment)  — Machine à états + champs date
 *   deleteTicket(db, id, userId)                   — Soft delete (actif = 0)
 *   archiveTicket(db, id, userId)                  — Sprint 2.37 : archivage manuel ticket terminal
 *   checkAndArchiveTickets(db, boutiqueId, days)   — Sprint 2.37 : batch auto-archivage 90j
 *   getTicketBoutiqueId(db, id)                    — Résout ticket → boutique_id (hook termine)
 *   getTicketAvecClient(db, id)                    — Données ticket + email client (hook email)
 */

import { parsePagination, nextNumero, auditLog } from '../lib/db'

// ─── Types ────────────────────────────────────────────────────────────────────

export type StatutTicket =
  | 'recu' | 'en_diagnostic' | 'attente_accord'
  | 'a_commander' | 'commande' | 'pieces_recues'
  | 'en_reparation' | 'termine' | 'livre' | 'annule'

export type PrioriteTicket = 'basse' | 'normale' | 'haute' | 'urgente'

export interface TicketRow {
  id:                  number
  boutique_id:         number
  numero:              string
  statut:              StatutTicket
  priorite:            PrioriteTicket
  client_id:           number
  appareil_id:         number | null
  appareil_marque:     string
  appareil_modele:     string
  description_panne:   string
  diagnostic:          string | null
  technicien_id:       number | null
  prix_estime:         number | null
  prix_final:          number | null
  date_reception:      string
  date_promesse:       string | null
  date_commande_pieces: string | null
  date_reception_pieces: string | null
  date_cloture:        string | null
  date_livraison:      string | null
  notes_internes:      string | null
  tracking_token:      string
  actif:               number
  created_at:          string
  updated_at:          string
}

export interface ListTicketsOpts {
  statut?:       string
  technicien?:   number
  client_id?:    number
  search?:       string
  archived?:     boolean   // Sprint 2.37 — true = tickets archivés seulement
  limit?:        number
  offset?:       number
  page?:         number
}

export interface CreateTicketData {
  client_id:          number
  appareil_id?:       number | null
  appareil_marque:    string
  appareil_modele:    string
  description_panne:  string
  technicien_id?:     number | null
  prix_estime?:       number | null
  date_promesse?:     string | null
  notes_internes?:    string | null
}

export interface UpdateTicketData {
  description_panne?: string | null
  diagnostic?:        string | null
  technicien_id?:     number | null
  prix_estime?:       number | null
  prix_final?:        number | null
  date_promesse?:     string | null
  notes_internes?:    string | null
  priorite?:          PrioriteTicket | null
}

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Transitions autorisées : statut_actuel → [statuts_cibles_possibles] */
export const TRANSITIONS_TICKET: Record<StatutTicket, StatutTicket[]> = {
  recu:           ['en_diagnostic', 'attente_accord', 'en_reparation', 'annule'],
  en_diagnostic:  ['attente_accord', 'a_commander', 'en_reparation', 'annule'],
  attente_accord: ['a_commander', 'en_reparation', 'annule'],
  a_commander:    ['commande', 'en_reparation', 'annule'],
  commande:       ['pieces_recues', 'annule'],
  pieces_recues:  ['en_reparation', 'annule'],
  en_reparation:  ['termine', 'annule'],
  termine:        ['livre'],
  livre:          [],
  annule:         [],
}

/** Métadonnées visuelles pour le Kanban */
export const STATUT_LABELS: Record<StatutTicket, { label: string; emoji: string; color: string }> = {
  recu:           { label: 'Reçu',            emoji: '📋', color: 'blue' },
  en_diagnostic:  { label: 'En diagnostic',   emoji: '🔍', color: 'purple' },
  attente_accord: { label: 'Attente accord',  emoji: '⏳', color: 'yellow' },
  a_commander:    { label: 'À commander',     emoji: '🛒', color: 'orange' },
  commande:       { label: 'Commandé',        emoji: '📦', color: 'indigo' },
  pieces_recues:  { label: 'Pièces reçues',   emoji: '✅', color: 'teal' },
  en_reparation:  { label: 'En réparation',   emoji: '🔧', color: 'cyan' },
  termine:        { label: 'Terminé',         emoji: '🎉', color: 'green' },
  livre:          { label: 'Livré',           emoji: '🚀', color: 'gray' },
  annule:         { label: 'Annulé',          emoji: '❌', color: 'red' },
}

const PRIORITES_VALIDES: PrioriteTicket[] = ['basse', 'normale', 'haute', 'urgente']

/** Ordre des colonnes Kanban */
const COLONNES_KANBAN: StatutTicket[] = [
  'recu', 'en_diagnostic', 'attente_accord',
  'a_commander', 'commande', 'pieces_recues',
  'en_reparation', 'termine', 'livre', 'annule',
]

// ─── Helpers privés ───────────────────────────────────────────────────────────

/**
 * Génère un tracking_token de 32 caractères hexadécimaux (Web Crypto API).
 * @returns Token hexadécimal aléatoire sécurisé
 */
function genererTrackingToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Calcule la couleur d'ancienneté d'un ticket selon son âge en jours.
 * @param joursAnciennete — Nombre de jours depuis la réception
 * @returns 'green' | 'orange' | 'red' | 'black'
 */
function couleurAnciennete(joursAnciennete: number): 'green' | 'orange' | 'red' | 'black' {
  if (joursAnciennete <= 2)  return 'green'
  if (joursAnciennete <= 6)  return 'orange'
  if (joursAnciennete <= 13) return 'red'
  return 'black'
}

// ─── Fonctions exportées ──────────────────────────────────────────────────────

/**
 * Liste les tickets d'une boutique avec filtres et pagination.
 *
 * @param db          — Instance D1Database
 * @param boutiqueId  — ID boutique obligatoire
 * @param opts        — Filtres optionnels : statut, technicien, client_id, search + pagination
 * @returns           — { data, pagination }
 */
export async function listTickets(
  db: D1Database,
  boutiqueId: number,
  opts: ListTicketsOpts = {}
): Promise<{ data: any[]; pagination: { page: number; limit: number; total: number; pages: number } }> {
  const { limit, offset, page } = parsePagination({
    page:  String(opts.page  ?? 1),
    limit: String(opts.limit ?? 20),
  })

  // Sprint 2.37 : archived = true → tickets archivés ; par défaut → tickets non archivés
  const conditions: string[] = ['t.boutique_id = ?', 't.actif = 1']
  const bindings:   any[]    = [boutiqueId]

  if (opts.archived) {
    conditions.push('t.archived_at IS NOT NULL')
  } else {
    conditions.push('t.archived_at IS NULL')
  }

  if (opts.statut) {
    conditions.push('t.statut = ?')
    bindings.push(opts.statut)
  }
  if (opts.technicien) {
    conditions.push('t.technicien_id = ?')
    bindings.push(opts.technicien)
  }
  if (opts.client_id) {
    conditions.push('t.client_id = ?')
    bindings.push(opts.client_id)
  }
  if (opts.search) {
    conditions.push('(t.numero LIKE ? OR t.appareil_marque LIKE ? OR t.appareil_modele LIKE ?)')
    const s = `%${opts.search}%`
    bindings.push(s, s, s)
  }

  const where = 'WHERE ' + conditions.join(' AND ')

  const totRow = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM tickets t ${where}`)
    .bind(...bindings)
    .first<{ cnt: number }>()

  const rows = await db.prepare(`
    SELECT t.id, t.numero, t.statut, t.priorite, t.description_panne,
           t.appareil_marque, t.appareil_modele,
           t.prix_estime, t.prix_final, t.date_reception, t.date_promesse,
           c.prenom || ' ' || c.nom   AS client_nom,
           c.telephone                AS client_telephone,
           u.prenom || ' ' || u.nom   AS technicien_nom
    FROM   tickets t
    JOIN   clients c ON c.id = t.client_id
    LEFT JOIN users u ON u.id = t.technicien_id
    ${where}
    ORDER  BY t.created_at DESC
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
 * Retourne les tickets groupés par statut pour l'affichage Kanban.
 * Inclut les tickets terminaux (livre/annule) des 7 derniers jours.
 * Ajoute ancienneté_couleur et transitions_possibles sur chaque ticket.
 *
 * @param db          — Instance D1Database
 * @param boutiqueId  — ID boutique
 * @returns           — { colonnes: ColonneKanban[], stats }
 */
export async function getKanban(
  db: D1Database,
  boutiqueId: number
): Promise<{ colonnes: any[]; stats: { total_actifs: number; urgents: number; en_retard: number } }> {
  const rows = await db.prepare(`
    SELECT t.id, t.numero, t.statut, t.priorite,
           t.appareil_marque, t.appareil_modele, t.description_panne,
           t.prix_estime, t.prix_final,
           t.date_reception, t.date_promesse, t.date_commande_pieces, t.date_reception_pieces,
           t.technicien_id,
           c.prenom || ' ' || c.nom   AS client_nom,
           c.telephone                AS client_telephone,
           u.prenom || ' ' || u.nom   AS technicien_nom,
           CAST((julianday('now') - julianday(t.date_reception)) AS INTEGER) AS jours_anciennete
    FROM   tickets t
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN users   u ON u.id = t.technicien_id
    WHERE  t.boutique_id = ? AND t.actif = 1
      AND (t.statut NOT IN ('livre','annule')
        OR (t.statut IN ('livre','annule')
            AND t.updated_at >= datetime('now', '-7 days')))
    ORDER  BY
      CASE t.priorite WHEN 'urgente' THEN 1 WHEN 'haute' THEN 2 WHEN 'normale' THEN 3 ELSE 4 END,
      t.date_reception ASC
  `).bind(boutiqueId).all<any>()

  // Initialiser toutes les colonnes dans l'ordre du Kanban
  const colonnesMap: Record<string, any> = {}
  for (const statut of COLONNES_KANBAN) {
    colonnesMap[statut] = {
      statut,
      ...STATUT_LABELS[statut],
      tickets: [] as any[],
    }
  }

  // Répartir les tickets dans leur colonne + enrichir
  const maintenant = new Date()
  for (const t of rows.results ?? []) {
    const statut = t.statut as StatutTicket
    const enrichi = {
      ...t,
      anciennete_couleur:    couleurAnciennete(t.jours_anciennete ?? 0),
      transitions_possibles: TRANSITIONS_TICKET[statut] ?? [],
    }
    if (colonnesMap[statut]) {
      colonnesMap[statut].tickets.push(enrichi)
    }
  }

  const tous = rows.results ?? []
  const stats = {
    total_actifs: tous.filter((t: any) => !['livre', 'annule'].includes(t.statut)).length,
    urgents:      tous.filter((t: any) => t.priorite === 'urgente').length,
    en_retard:    tous.filter((t: any) =>
      t.date_promesse &&
      new Date(t.date_promesse) < maintenant &&
      !['livre', 'annule', 'termine'].includes(t.statut)
    ).length,
  }

  return { colonnes: Object.values(colonnesMap), stats }
}

/**
 * Retourne la fiche complète d'un ticket : données + historique statuts + photos.
 *
 * @param db  — Instance D1Database
 * @param id  — ID du ticket
 * @returns   — TicketRow enrichi, ou null si introuvable
 */
export async function getTicketById(
  db: D1Database,
  id: number
): Promise<any | null> {
  const ticket = await db.prepare(`
    SELECT t.*,
           c.prenom || ' ' || c.nom   AS client_nom,
           c.email                    AS client_email,
           c.telephone                AS client_telephone,
           u.prenom || ' ' || u.nom   AS technicien_nom
    FROM   tickets t
    JOIN   clients c ON c.id = t.client_id
    LEFT JOIN users u ON u.id = t.technicien_id
    WHERE  t.id = ? AND t.actif = 1
  `).bind(id).first()

  if (!ticket) return null

  const [historique, photos] = await Promise.all([
    db.prepare(`
      SELECT h.*, u.prenom || ' ' || u.nom AS user_nom
      FROM   tickets_statuts_historique h
      JOIN   users u ON u.id = h.user_id
      WHERE  h.ticket_id = ?
      ORDER  BY h.created_at ASC
    `).bind(id).all(),
    db.prepare(`
      SELECT * FROM tickets_photos WHERE ticket_id = ? ORDER BY created_at
    `).bind(id).all(),
  ])

  return {
    ...ticket,
    historique: historique.results ?? [],
    photos:     photos.results     ?? [],
  }
}

/**
 * Crée un nouveau ticket, génère le numéro séquentiel et le tracking_token.
 * Enregistre l'entrée initiale dans tickets_statuts_historique.
 *
 * @param db          — Instance D1Database
 * @param boutiqueId  — ID boutique
 * @param userId      — ID de l'utilisateur créateur (pour audit + historique)
 * @param data        — Données du ticket (voir CreateTicketData)
 * @returns           — { id, numero, tracking_token }
 */
export async function createTicket(
  db: D1Database,
  boutiqueId: number,
  userId: number,
  data: CreateTicketData
): Promise<{ id: number; numero: string; tracking_token: string }> {
  const numero        = await nextNumero(db, boutiqueId, 'ticket')
  const trackingToken = genererTrackingToken()

  const result = await db.prepare(`
    INSERT INTO tickets
      (boutique_id, numero, client_id, appareil_id, appareil_marque, appareil_modele,
       description_panne, technicien_id, prix_estime, date_promesse, notes_internes, tracking_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    boutiqueId,
    numero,
    data.client_id,
    data.appareil_id     ?? null,
    data.appareil_marque,
    data.appareil_modele,
    data.description_panne,
    data.technicien_id   ?? null,
    data.prix_estime     ?? null,
    data.date_promesse   ?? null,
    data.notes_internes  ?? null,
    trackingToken,
  ).first<{ id: number }>()

  const ticketId = result!.id

  // Historique : entrée initiale (création)
  await db.prepare(`
    INSERT INTO tickets_statuts_historique
      (ticket_id, statut_ancien, statut_nouveau, user_id, commentaire)
    VALUES (?, 'creation', 'recu', ?, 'Ticket créé')
  `).bind(ticketId, userId).run()

  await auditLog(db, {
    boutique_id: boutiqueId,
    user_id:     userId,
    action:      'CREATE_TICKET',
    entite_type: 'ticket',
    entite_id:   ticketId,
  })

  return { id: ticketId, numero, tracking_token: trackingToken }
}

/**
 * Met à jour les champs éditables d'un ticket (hors statut).
 * Utilise COALESCE pour ne modifier que les champs fournis.
 *
 * @param db      — Instance D1Database
 * @param id      — ID du ticket
 * @param userId  — ID utilisateur (pour audit)
 * @param data    — Champs à modifier (voir UpdateTicketData)
 * @throws        — Error si priorité invalide
 */
export async function updateTicket(
  db: D1Database,
  id: number,
  userId: number,
  data: UpdateTicketData
): Promise<void> {
  if (data.priorite && !PRIORITES_VALIDES.includes(data.priorite)) {
    throw new Error(`Priorité invalide. Valeurs acceptées : ${PRIORITES_VALIDES.join(', ')}.`)
  }

  const existing = await db
    .prepare('SELECT id FROM tickets WHERE id = ? AND actif = 1')
    .bind(id)
    .first()
  if (!existing) throw new Error('Ticket introuvable.')

  await db.prepare(`
    UPDATE tickets SET
      description_panne = COALESCE(?, description_panne),
      diagnostic        = COALESCE(?, diagnostic),
      technicien_id     = COALESCE(?, technicien_id),
      prix_estime       = COALESCE(?, prix_estime),
      prix_final        = COALESCE(?, prix_final),
      date_promesse     = COALESCE(?, date_promesse),
      notes_internes    = COALESCE(?, notes_internes),
      priorite          = COALESCE(?, priorite),
      updated_at        = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    data.description_panne ?? null,
    data.diagnostic        ?? null,
    data.technicien_id     ?? null,
    data.prix_estime       ?? null,
    data.prix_final        ?? null,
    data.date_promesse     ?? null,
    data.notes_internes    ?? null,
    data.priorite          ?? null,
    id,
  ).run()

  await auditLog(db, {
    user_id:     userId,
    action:      'UPDATE_TICKET',
    entite_type: 'ticket',
    entite_id:   id,
  })
}

/**
 * Applique une transition de statut sur un ticket (machine à états).
 * Met à jour les colonnes de date associées au nouveau statut.
 * Enregistre la transition dans tickets_statuts_historique.
 *
 * @param db          — Instance D1Database
 * @param id          — ID du ticket
 * @param userId      — ID utilisateur
 * @param statut      — Nouveau statut cible
 * @param commentaire — Commentaire optionnel pour l'historique
 * @returns           — { statut_avant, statut_apres }
 * @throws            — Error si transition invalide ou ticket introuvable
 */
export async function updateStatutTicket(
  db: D1Database,
  id: number,
  userId: number,
  statut: StatutTicket,
  commentaire?: string | null
): Promise<{ statut_avant: StatutTicket; statut_apres: StatutTicket }> {
  const ticket = await db
    .prepare('SELECT id, statut, boutique_id FROM tickets WHERE id = ? AND actif = 1')
    .bind(id)
    .first<{ id: number; statut: StatutTicket; boutique_id: number }>()

  if (!ticket) throw new Error('Ticket introuvable.')

  const transitions = TRANSITIONS_TICKET[ticket.statut] ?? []
  if (!transitions.includes(statut)) {
    throw new Error(
      `Transition invalide : ${ticket.statut} → ${statut}. ` +
      `Transitions autorisées : ${transitions.join(', ') || 'aucune'}.`
    )
  }

  // Champs de date associés à certains statuts
  const extraFields: string[] = []
  if (statut === 'a_commander')   extraFields.push('date_commande_pieces = CURRENT_TIMESTAMP')
  if (statut === 'commande')      extraFields.push('date_commande_pieces = COALESCE(date_commande_pieces, CURRENT_TIMESTAMP)')
  if (statut === 'pieces_recues') extraFields.push('date_reception_pieces = CURRENT_TIMESTAMP')
  if (statut === 'termine')       extraFields.push('date_cloture = CURRENT_TIMESTAMP')
  if (statut === 'livre')         extraFields.push('date_livraison = CURRENT_TIMESTAMP')

  const extraSql = extraFields.map(f => `, ${f}`).join('')

  await db.prepare(`
    UPDATE tickets
    SET    statut = ?, updated_at = CURRENT_TIMESTAMP ${extraSql}
    WHERE  id = ?
  `).bind(statut, id).run()

  await db.prepare(`
    INSERT INTO tickets_statuts_historique
      (ticket_id, statut_ancien, statut_nouveau, user_id, commentaire)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, ticket.statut, statut, userId, commentaire ?? null).run()

  await auditLog(db, {
    user_id:     userId,
    action:      'CHANGE_STATUT_TICKET',
    entite_type: 'ticket',
    entite_id:   id,
    avant:        { statut: ticket.statut },
    apres:        { statut },
  })

  return { statut_avant: ticket.statut, statut_apres: statut }
}

/**
 * Soft-delete un ticket (actif = 0).
 *
 * @param db      — Instance D1Database
 * @param id      — ID du ticket
 * @param userId  — ID utilisateur (pour audit)
 */
export async function deleteTicket(
  db: D1Database,
  id: number,
  userId: number
): Promise<void> {
  await db
    .prepare('UPDATE tickets SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(id)
    .run()

  await auditLog(db, {
    user_id:     userId,
    action:      'DELETE_TICKET',
    entite_type: 'ticket',
    entite_id:   id,
  })
}

// ─── Helpers pour hooks cross-service ─────────────────────────────────────────

/**
 * Retourne uniquement le `boutique_id` d'un ticket.
 * Utilisé par le hook garantie + email dans `routes/tickets.ts` au passage statut `termine`.
 *
 * @param db - Instance D1Database
 * @param id - ID du ticket
 * @returns  `{ boutique_id }` ou `null` si ticket introuvable
 */
export async function getTicketBoutiqueId(
  db: D1Database,
  id: number
): Promise<{ boutique_id: number } | null> {
  return db
    .prepare('SELECT boutique_id FROM tickets WHERE id = ?')
    .bind(id)
    .first<{ boutique_id: number }>()
}

/**
 * Retourne les données d'un ticket enrichies de l'email et prénom du client.
 * Utilisé exclusivement par le hook email `sendTicketTermine` dans `routes/tickets.ts`.
 * N'expose pas les notes internes ni les données sensibles.
 *
 * @param db - Instance D1Database
 * @param id - ID du ticket
 * @returns  Données ticket + client_email + client_prenom, ou `null`
 */
// ─── Archivage (Sprint 2.37) ─────────────────────────────────────────────────

/**
 * Archive manuellement un ticket.
 * Conditions : ticket actif, non encore archivé, statut terminal (livre ou annule).
 *
 * @param db     — Instance D1Database
 * @param id     — ID du ticket
 * @param userId — ID utilisateur qui archive
 * @throws si ticket introuvable, déjà archivé, ou statut non terminal
 */
export async function archiveTicket(
  db:     D1Database,
  id:     number,
  userId: number
): Promise<void> {
  const ticket = await db.prepare(
    `SELECT id, statut, archived_at, actif FROM tickets WHERE id = ? AND actif = 1`
  ).bind(id).first<{ id: number; statut: string; archived_at: string | null; actif: number }>()

  if (!ticket)            throw new Error(`Ticket #${id} introuvable.`)
  if (ticket.archived_at) throw new Error(`Ticket #${id} déjà archivé.`)
  if (!['livre', 'annule'].includes(ticket.statut))
    throw new Error(`Seuls les tickets livrés ou annulés peuvent être archivés (statut actuel : ${ticket.statut}).`)

  await db.prepare(
    `UPDATE tickets SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(id).run()

  await auditLog(db, {
    user_id:     userId,
    action:      'ARCHIVE_TICKET',
    entite_type: 'ticket',
    entite_id:   id,
    avant:       { statut: ticket.statut, archived_at: null },
    apres:       { archived_at: 'NOW' },
  })
}

/**
 * Batch auto-archivage : archive tous les tickets livrés ou annulés
 * dont la dernière mise à jour remonte à plus de `days` jours (défaut : 90j).
 * Appelé périodiquement via le hook probabiliste du middleware global.
 *
 * @param db         — Instance D1Database
 * @param boutiqueId — ID boutique ciblée (ou 0 pour toutes les boutiques)
 * @param days       — Seuil en jours (défaut 90)
 * @returns          — Nombre de tickets archivés
 */
export async function checkAndArchiveTickets(
  db:         D1Database,
  boutiqueId: number,
  days:       number = 90
): Promise<number> {
  const conditions = boutiqueId > 0
    ? `boutique_id = ${boutiqueId} AND`
    : ''

  const result = await db.prepare(`
    UPDATE tickets
    SET    archived_at = CURRENT_TIMESTAMP,
           updated_at  = CURRENT_TIMESTAMP
    WHERE  ${conditions}
           actif       = 1
      AND  archived_at IS NULL
      AND  statut      IN ('livre', 'annule')
      AND  updated_at <= datetime('now', '-' || ? || ' days')
  `).bind(days).run()

  return (result.meta.changes as number) ?? 0
}

export async function getTicketAvecClient(
  db: D1Database,
  id: number
): Promise<{
  numero:         string
  tracking_token: string | null
  prix_final:     number | null
  diagnostic:     string | null
  appareil_marque: string
  appareil_modele: string
  client_email:   string | null
  client_prenom:  string
} | null> {
  return db.prepare(`
    SELECT t.numero, t.tracking_token, t.prix_final, t.diagnostic,
           t.appareil_marque, t.appareil_modele,
           c.email AS client_email, c.prenom AS client_prenom
    FROM tickets t JOIN clients c ON c.id = t.client_id
    WHERE t.id = ? LIMIT 1
  `).bind(id).first()
}
