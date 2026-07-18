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
import { parseUtcTimestamp } from '../lib/timezone'
import type { Database } from '../ports/database'

/**
 * Vérifie que le technicien assigné appartient bien à la boutique du ticket —
 * empêche qu'un admin/manager assigne (via l'API) un technicien d'une autre
 * boutique, ce qui exposerait son nom via la jointure `users` (isolation
 * multi-tenant, voir project-docs/bugs.md).
 * @param db           — Instance D1Database
 * @param technicienId — ID utilisateur à valider (ignoré si null/undefined)
 * @param boutiqueId   — ID boutique attendue
 * @throws             — Error si le technicien n'existe pas dans cette boutique
 */
async function validateTechnicienBoutique(
  db: D1Database,
  technicienId: number | null | undefined,
  boutiqueId: number
): Promise<void> {
  if (technicienId == null) return

  const user = await db
    .prepare('SELECT id FROM users WHERE id = ? AND boutique_id = ?')
    .bind(technicienId, boutiqueId)
    .first()

  if (!user) throw new Error('Technicien introuvable dans cette boutique.')
}

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
  etat_appareil:       string | null   // JSON, ex: '{"items":["rayures","ecran_fissure"],"autre":"..."}'
  code_deverrouillage: string | null
  code_sim:            string | null
  signature_client:    string | null   // data URL PNG
  signature_date:      string | null
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
  client_id:            number
  appareil_id?:         number | null
  appareil_marque:      string
  appareil_modele:      string
  description_panne:    string
  technicien_id?:       number | null
  prix_estime?:         number | null
  date_promesse?:       string | null
  notes_internes?:      string | null
  // ── Prise en charge (checklist état + sécurité + signature) ──
  etat_appareil?:       string | null   // JSON `{ items: string[], autre?: string }`
  code_deverrouillage?: string | null   // PIN / schéma — jamais imprimé sur le bon de dépôt
  code_sim?:            string | null
  signature_client?:    string | null   // data URL PNG (canvas.toDataURL côté client)
  signature_date?:      string | null   // ISO — posée uniquement si signature_client est fourni
}

export interface UpdateTicketData {
  description_panne?:   string | null
  diagnostic?:          string | null
  technicien_id?:       number | null
  prix_estime?:         number | null
  prix_final?:          number | null
  date_promesse?:       string | null
  notes_internes?:      string | null
  priorite?:            PrioriteTicket | null
  // ── Prise en charge — mêmes champs que CreateTicketData, éditables après coup ──
  etat_appareil?:       string | null
  code_deverrouillage?: string | null
  code_sim?:            string | null
  signature_client?:    string | null
  signature_date?:      string | null
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
  db: Database,
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
    // Recherche unifiée : texte libre (numero/marque/modele, comportement existant,
    // TOUJOURS actif) OR token de suivi scanné (QR — 32 hex, ou URL contenant
    // /suivi/<token>) OR ID numérique (EAN-13 scanné — 13 chiffres, le 13e est le
    // chiffre de contrôle à ignorer, pas signifiant pour l'ID — ou ID tapé à la
    // main). Un seul champ de recherche gère les 3 cas. Impression ticket, voir
    // docs/superpowers/specs/2026-07-17-impression-ticket-design.md.
    const orParts: string[] = ['t.numero LIKE ?', 't.appareil_marque LIKE ?', 't.appareil_modele LIKE ?']
    const s = `%${opts.search}%`
    const orBindings: any[] = [s, s, s]

    const tokenInUrl = opts.search.match(/\/suivi\/([0-9a-f]{32})/i)
    const tokenSeul  = opts.search.match(/^[0-9a-f]{32}$/i)
    if (tokenInUrl || tokenSeul) {
      const token = (tokenInUrl ? tokenInUrl[1] : opts.search).toLowerCase()
      orParts.push('t.tracking_token = ?')
      orBindings.push(token)
    } else if (/^\d{13}$/.test(opts.search)) {
      // Scan EAN-13 complet : 12 chiffres d'ID zéro-paddé + 1 chiffre de contrôle
      // (non stocké, non signifiant côté recherche — seul l'ID compte).
      orParts.push('t.id = ?')
      orBindings.push(parseInt(opts.search.slice(0, 12), 10))
    } else if (/^\d+$/.test(opts.search)) {
      // ID tapé à la main (numérique, mais pas 13 chiffres donc pas un scan EAN-13).
      orParts.push('t.id = ?')
      orBindings.push(parseInt(opts.search, 10))
    }

    conditions.push('(' + orParts.join(' OR ') + ')')
    bindings.push(...orBindings)
  }

  const where = 'WHERE ' + conditions.join(' AND ')

  const totRow = await db.get<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM tickets t ${where}`, bindings
  )

  const rows = await db.all<any>(`
    SELECT t.id, t.numero, t.statut, t.priorite, t.description_panne,
           t.appareil_marque, t.appareil_modele,
           t.prix_estime, t.prix_final, t.date_reception, t.date_promesse,
           t.technicien_id,
           c.prenom || ' ' || c.nom   AS client_nom,
           c.telephone                AS client_telephone,
           u.prenom || ' ' || u.nom   AS technicien_nom
    FROM   tickets t
    JOIN   clients c ON c.id = t.client_id
    LEFT JOIN users u ON u.id = t.technicien_id
    ${where}
    ORDER  BY t.created_at DESC
    LIMIT ? OFFSET ?
  `, [...bindings, limit, offset])

  return {
    data: rows,
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
  db: Database,
  boutiqueId: number
): Promise<{ colonnes: any[]; stats: { total_actifs: number; urgents: number; en_retard: number } }> {
  const rows = await db.all<any>(`
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
  `, [boutiqueId])

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
  for (const t of rows) {
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

  // date_promesse est un horodatage SQLite ("YYYY-MM-DD HH:MM:SS", sans suffixe
  // de fuseau) — parseUtcTimestamp() évite qu'il soit interprété en heure locale
  // du runtime (voir lib/timezone.ts, bug déjà corrigé sur personnelService.ts).
  const stats = {
    total_actifs: rows.filter((t: any) => !['livre', 'annule'].includes(t.statut)).length,
    urgents:      rows.filter((t: any) => t.priorite === 'urgente').length,
    en_retard:    rows.filter((t: any) =>
      t.date_promesse &&
      parseUtcTimestamp(t.date_promesse) < maintenant &&
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
  db: Database,
  id: number
): Promise<any | null> {
  // devis_id/devis_statut : devis le plus récent lié à ce ticket (feature "Accord",
  // suivi.html dérive l'état gris/orange/vert de l'étape attente_accord de ce champ,
  // pas seulement du statut ticket). Un ticket peut avoir plusieurs devis dans le
  // temps (ex. refusé puis revu) — on ne considère que le dernier.
  // facture_acompte_* : facture type_facture='acompte' liée directement au ticket
  // OU à son devis le plus récent (un acompte peut avoir été demandé à l'un ou
  // l'autre moment, voir docs/superpowers/specs/2026-07-16-acompte-structure-design.md).
  // facture_acompte_tva_taux : lu directement sur la ligne "Acompte" (pas recalculé
  // depuis ht/tva) — même raison que le fix convertirDevis() (commit e154e13) : un
  // recalcul (tva/ht) aurait produit un taux légèrement décalé (ex. 19.99% au lieu
  // de 20%) à cause de l'arrondi déjà appliqué sur les totaux stockés. Exposé pour
  // que tickets.js n'ait plus à approximer un taux fixe 20% lors de la génération
  // de l'avoir sur annulation (changeStatus()).
  // appareil_imei/appareil_numero_serie : LEFT JOIN (pas JOIN) — t.appareil_id est
  // NULL quand le ticket a été créé avec marque/modèle en texte libre, sans
  // appareil enregistré en base ; dans ce cas ces 2 champs restent null, ce qui
  // est un comportement normal (pas une erreur). Task 4bis, voir
  // .superpowers/sdd/task-4bis-brief.md — champs consommés par la fiche imprimable
  // (Task 4b/5) pour afficher IMEI/N° série/adresse comme le modèle de référence.
  const ticket = await db.get<any>(`
    SELECT t.*,
           c.prenom || ' ' || c.nom   AS client_nom,
           c.email                    AS client_email,
           c.telephone                AS client_telephone,
           c.adresse                  AS client_adresse,
           u.prenom || ' ' || u.nom   AS technicien_nom,
           d.id                       AS devis_id,
           d.statut                   AS devis_statut,
           fa.id                      AS facture_acompte_id,
           fa.numero                  AS facture_acompte_numero,
           fa.total_ttc               AS facture_acompte_montant,
           fa.total_ht                AS facture_acompte_ht,
           (SELECT tva_taux FROM lignes_document
              WHERE document_type = 'facture' AND document_id = fa.id LIMIT 1) AS facture_acompte_tva_taux,
           ap.imei                    AS appareil_imei,
           ap.numero_serie            AS appareil_numero_serie
    FROM   tickets t
    JOIN   clients c ON c.id = t.client_id
    LEFT JOIN users u ON u.id = t.technicien_id
    LEFT JOIN devis d ON d.id = (
      SELECT id FROM devis WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1
    )
    LEFT JOIN factures fa ON fa.type_facture = 'acompte' AND (fa.ticket_id = t.id OR fa.devis_id = d.id)
    LEFT JOIN appareils ap ON ap.id = t.appareil_id
    WHERE  t.id = ? AND t.actif = 1
  `, [id])

  if (!ticket) return null

  const [historique, photos] = await Promise.all([
    db.all<any>(`
      SELECT h.*, u.prenom || ' ' || u.nom AS user_nom
      FROM   tickets_statuts_historique h
      JOIN   users u ON u.id = h.user_id
      WHERE  h.ticket_id = ?
      ORDER  BY h.created_at ASC
    `, [id]),
    db.all<any>(`
      SELECT * FROM tickets_photos WHERE ticket_id = ? ORDER BY created_at
    `, [id]),
  ])

  return {
    ...ticket,
    historique,
    photos,
  }
}

/**
 * Crée un nouveau ticket, génère le numéro séquentiel et le tracking_token.
 * Enregistre l'entrée initiale dans tickets_statuts_historique.
 *
 * Champs prise en charge (Sprint 2026-07-11, voir docs/ANALYSE_COMPARATIVE_MONATELIER.md §1) :
 * `etat_appareil`/`code_deverrouillage`/`code_sim`/`signature_client`/`signature_date` sont
 * tous optionnels et null par défaut — un ticket créé sans ces infos reste valide.
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
  await validateTechnicienBoutique(db, data.technicien_id, boutiqueId)

  const numero        = await nextNumero(db, boutiqueId, 'ticket')
  const trackingToken = genererTrackingToken()

  const result = await db.prepare(`
    INSERT INTO tickets
      (boutique_id, numero, client_id, appareil_id, appareil_marque, appareil_modele,
       description_panne, technicien_id, prix_estime, date_promesse, notes_internes, tracking_token,
       etat_appareil, code_deverrouillage, code_sim, signature_client, signature_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    data.etat_appareil       ?? null,
    data.code_deverrouillage ?? null,
    data.code_sim             ?? null,
    data.signature_client     ?? null,
    data.signature_date       ?? null,
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
 * Utilise COALESCE pour ne modifier que les champs fournis — inclut les champs
 * prise en charge (état, codes de sécurité, signature), éditables après création
 * (ex : signature recueillie après coup, code communiqué plus tard par le client).
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
    .prepare('SELECT id, boutique_id FROM tickets WHERE id = ? AND actif = 1')
    .bind(id)
    .first<{ id: number; boutique_id: number }>()
  if (!existing) throw new Error('Ticket introuvable.')

  await validateTechnicienBoutique(db, data.technicien_id, existing.boutique_id)

  await db.prepare(`
    UPDATE tickets SET
      description_panne   = COALESCE(?, description_panne),
      diagnostic          = COALESCE(?, diagnostic),
      technicien_id       = COALESCE(?, technicien_id),
      prix_estime         = COALESCE(?, prix_estime),
      prix_final          = COALESCE(?, prix_final),
      date_promesse       = COALESCE(?, date_promesse),
      notes_internes      = COALESCE(?, notes_internes),
      priorite            = COALESCE(?, priorite),
      etat_appareil       = COALESCE(?, etat_appareil),
      code_deverrouillage = COALESCE(?, code_deverrouillage),
      code_sim            = COALESCE(?, code_sim),
      signature_client    = COALESCE(?, signature_client),
      signature_date      = COALESCE(?, signature_date),
      updated_at          = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    data.description_panne   ?? null,
    data.diagnostic          ?? null,
    data.technicien_id       ?? null,
    data.prix_estime         ?? null,
    data.prix_final          ?? null,
    data.date_promesse       ?? null,
    data.notes_internes      ?? null,
    data.priorite            ?? null,
    data.etat_appareil       ?? null,
    data.code_deverrouillage ?? null,
    data.code_sim            ?? null,
    data.signature_client    ?? null,
    data.signature_date      ?? null,
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
  db: Database,
  id: number
): Promise<{ boutique_id: number } | null> {
  return db.get<{ boutique_id: number }>('SELECT boutique_id FROM tickets WHERE id = ?', [id])
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
  db:         Database,
  boutiqueId: number,
  days:       number = 90
): Promise<number> {
  const conditions = boutiqueId > 0 ? 'boutique_id = ? AND' : ''
  const bindings   = boutiqueId > 0 ? [boutiqueId, days] : [days]

  const result = await db.run(`
    UPDATE tickets
    SET    archived_at = CURRENT_TIMESTAMP,
           updated_at  = CURRENT_TIMESTAMP
    WHERE  ${conditions}
           actif       = 1
      AND  archived_at IS NULL
      AND  statut      IN ('livre', 'annule')
      AND  updated_at <= datetime('now', '-' || ? || ' days')
  `, bindings)

  return result.changes ?? 0
}

export async function getTicketAvecClient(
  db: Database,
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
  return db.get(`
    SELECT t.numero, t.tracking_token, t.prix_final, t.diagnostic,
           t.appareil_marque, t.appareil_modele,
           c.email AS client_email, c.prenom AS client_prenom
    FROM tickets t JOIN clients c ON c.id = t.client_id
    WHERE t.id = ? LIMIT 1
  `, [id])
}
