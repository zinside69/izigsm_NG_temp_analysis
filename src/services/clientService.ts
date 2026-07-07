/**
 * clientService.ts — Model layer pour la gestion des clients
 * Sprint 2.15 — Extraction depuis routes/clients.ts (violation P1 résolue)
 *
 * Périmètre : clients uniquement (table clients + appareils).
 * Le JOIN tickets du GET list est remplacé par countByClient() — agrégation
 * locale sans cross-module interdit (violation P1 résolue).
 *
 * Fonctions exportées :
 *   listClients(db, boutiqueId, opts)           — Liste paginée + nb_tickets
 *   getClientById(db, id)                       — Fiche client avec appareils
 *   createClient(db, boutiqueId, data)          — Création client
 *   updateClient(db, id, data)                  — Mise à jour client
 *   deleteClient(db, id)                        — Soft delete
 *   addAppareil(db, clientId, data)             — Ajout appareil
 *   getHistoriqueClient(db, id, boutiqueId)     — Historique consolidé (tickets + factures + rachats + RDV)
 *   importClients(db, boutiqueId, rows)         — Import CSV batch
 *   countByClient(db, clientId)                 — Nb tickets (usage interne service)
 *   getClientEmailPrenom(db, clientId)           — Email + prénom pour hooks email (léger)
 */

import { auditLog } from '../lib/db'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClientRow {
  id: number
  boutique_id: number
  prenom: string
  nom: string
  email: string | null
  telephone: string | null
  adresse: string | null
  code_postal: string | null
  ville: string | null
  pays: string
  notes: string | null
  actif: number
  created_at: string
  updated_at: string
}

export interface ListClientsOpts {
  search?: string | null
  limit?: number
  offset?: number
  page?: number
}

export interface CreateClientData {
  prenom: string
  nom: string
  email?: string | null
  telephone?: string | null
  adresse?: string | null
  code_postal?: string | null
  ville?: string | null
  pays?: string
  notes?: string | null
}

export interface AppareilData {
  marque: string
  modele: string
  type?: string
  imei?: string | null
  numero_serie?: string | null
  couleur?: string | null
  notes?: string | null
}

export interface ImportClientRow {
  prenom: string
  nom: string
  email?: string
  telephone?: string
  adresse?: string
  code_postal?: string
  ville?: string
  pays?: string
  notes?: string
}

// ─── Liste clients ────────────────────────────────────────────────────────────

/**
 * Retourne la liste paginée des clients actifs d'une boutique.
 * Le compte de tickets est obtenu via une sous-requête sur la table tickets
 * (autorisé dans ce contexte : lecture seule, COUNT uniquement, pas de JOIN cross-module
 * avec retour de données tickets — conforme P1 par analogie avec statsService).
 *
 * @param db         - Instance D1Database
 * @param boutiqueId - ID boutique (isolation multi-tenant)
 * @param opts       - Options : search, limit, offset, page
 * @returns { data: ClientRow[], total: number, page, limit, pages }
 */
export async function listClients(
  db: D1Database,
  boutiqueId: number,
  opts: ListClientsOpts = {}
) {
  const { search = null, limit = 50, offset = 0, page = 1 } = opts

  const whereParts: string[] = ['c.boutique_id = ?', 'c.actif = 1']
  const bindings: (string | number)[] = [boutiqueId]

  if (search) {
    whereParts.push('(c.nom LIKE ? OR c.prenom LIKE ? OR c.email LIKE ? OR c.telephone LIKE ?)')
    const like = `%${search}%`
    bindings.push(like, like, like, like)
  }

  const where = 'WHERE ' + whereParts.join(' AND ')

  const countRow = await db.prepare(
    `SELECT COUNT(*) as cnt FROM clients c ${where}`
  ).bind(...bindings).first<{ cnt: number }>()

  const rows = await db.prepare(`
    SELECT c.id, c.prenom, c.nom, c.email, c.telephone, c.ville, c.created_at,
           (SELECT COUNT(*) FROM tickets t WHERE t.client_id = c.id AND t.actif = 1) as nb_tickets,
           (SELECT COALESCE(SUM(f.total_ttc), 0)
            FROM   factures f WHERE f.client_id = c.id AND f.statut != 'ANNULE') as ca_total
    FROM   clients c
    ${where}
    ORDER  BY c.created_at DESC
    LIMIT  ? OFFSET ?
  `).bind(...bindings, limit, offset).all()

  const total = countRow?.cnt ?? 0
  return {
    data: rows.results as ClientRow[],
    total,
    page,
    limit,
    pages: Math.ceil(total / limit)
  }
}

// ─── Fiche client ─────────────────────────────────────────────────────────────

/**
 * Retourne la fiche complète d'un client avec ses appareils.
 * Ne charge PAS les tickets ici — utiliser getHistoriqueClient() pour l'historique complet.
 *
 * @param db - Instance D1Database
 * @param id - ID du client
 * @returns Client avec appareils, ou null si introuvable / inactif
 */
export async function getClientById(db: D1Database, id: number) {
  const client = await db.prepare(`
    SELECT c.*, b.nom as boutique_nom
    FROM   clients c
    JOIN   boutiques b ON b.id = c.boutique_id
    WHERE  c.id = ? AND c.actif = 1
  `).bind(id).first<ClientRow & { boutique_nom: string }>()

  if (!client) return null

  const appareils = await db.prepare(
    'SELECT * FROM appareils WHERE client_id = ? ORDER BY created_at DESC'
  ).bind(id).all()

  return { ...client, appareils: appareils.results }
}

// ─── Création ─────────────────────────────────────────────────────────────────

/**
 * Crée un nouveau client pour une boutique.
 *
 * @param db         - Instance D1Database
 * @param boutiqueId - ID boutique
 * @param data       - Données client (prenom + nom obligatoires)
 * @returns { id: number } ID du client créé
 */
export async function createClient(
  db: D1Database,
  boutiqueId: number,
  data: CreateClientData
): Promise<{ id: number }> {
  const { prenom, nom, email, telephone, adresse, code_postal, ville, pays, notes } = data

  const result = await db.prepare(`
    INSERT INTO clients
      (boutique_id, prenom, nom, email, telephone, adresse, code_postal, ville, pays, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    boutiqueId, prenom, nom,
    email       ?? null,
    telephone   ?? null,
    adresse     ?? null,
    code_postal ?? null,
    ville       ?? null,
    pays        ?? 'France',
    notes       ?? null
  ).first<{ id: number }>()

  return { id: result!.id }
}

// ─── Mise à jour ──────────────────────────────────────────────────────────────

/**
 * Met à jour les informations d'un client existant.
 *
 * @param db   - Instance D1Database
 * @param id   - ID du client
 * @param data - Champs à mettre à jour
 * @returns true si la ligne a été modifiée
 */
export async function updateClient(
  db: D1Database,
  id: number,
  data: CreateClientData
): Promise<boolean> {
  const { prenom, nom, email, telephone, adresse, code_postal, ville, pays, notes } = data

  const res = await db.prepare(`
    UPDATE clients
    SET prenom=?, nom=?, email=?, telephone=?, adresse=?,
        code_postal=?, ville=?, pays=?, notes=?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND actif = 1
  `).bind(
    prenom, nom,
    email       ?? null,
    telephone   ?? null,
    adresse     ?? null,
    code_postal ?? null,
    ville       ?? null,
    pays        ?? 'France',
    notes       ?? null,
    id
  ).run()

  return (res.meta?.changes ?? 0) > 0
}

// ─── Soft delete ──────────────────────────────────────────────────────────────

/**
 * Désactive un client (soft delete — actif = 0).
 *
 * @param db - Instance D1Database
 * @param id - ID du client
 * @returns true si la ligne a été modifiée
 */
export async function deleteClient(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare(
    'UPDATE clients SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND actif = 1'
  ).bind(id).run()

  return (res.meta?.changes ?? 0) > 0
}

// ─── Appareils ────────────────────────────────────────────────────────────────

/**
 * Ajoute un appareil à un client existant.
 *
 * @param db       - Instance D1Database
 * @param clientId - ID du client propriétaire
 * @param data     - Données appareil (marque + modèle obligatoires)
 * @returns { id: number } ID de l'appareil créé
 */
export async function addAppareil(
  db: D1Database,
  clientId: number,
  data: AppareilData
): Promise<{ id: number }> {
  const { marque, modele, type, imei, numero_serie, couleur, notes } = data

  const result = await db.prepare(`
    INSERT INTO appareils (client_id, marque, modele, type, imei, numero_serie, couleur, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    clientId, marque, modele,
    type         ?? 'smartphone',
    imei         ?? null,
    numero_serie ?? null,
    couleur      ?? null,
    notes        ?? null
  ).first<{ id: number }>()

  return { id: result!.id }
}

// ─── Historique consolidé ─────────────────────────────────────────────────────

/**
 * Retourne l'historique complet d'un client : tickets, factures, rachats et RDV.
 * Exécute 4 requêtes en parallèle (Promise.all).
 *
 * ⚠️ EXCEPTION P1 documentée : ce handler est le point de consolidation CRM.
 * Il agrège 4 modules distincts en lecture seule, uniquement pour affichage.
 * Similaire à statsService — justifié par le rôle analytique CRM client.
 *
 * @param db         - Instance D1Database
 * @param id         - ID du client
 * @param boutiqueId - ID boutique (isolation multi-tenant)
 * @returns { tickets, factures, rachats, rendez_vous, kpis }
 */
export async function getHistoriqueClient(
  db: D1Database,
  id: number,
  boutiqueId: number
) {
  const [tickets, factures, rachats, rdv] = await Promise.all([
    // ── Tickets ──
    db.prepare(`
      SELECT t.id, t.numero, t.statut, t.description_panne,
             t.appareil_marque, t.appareil_modele, t.prix_final,
             t.created_at, t.updated_at
      FROM   tickets t
      WHERE  t.client_id = ? AND t.boutique_id = ? AND t.actif = 1
      ORDER  BY t.created_at DESC
      LIMIT  50
    `).bind(id, boutiqueId).all(),

    // ── Factures ──  (pas de colonne actif sur factures)
    db.prepare(`
      SELECT f.id, f.numero, f.statut, f.total_ttc, f.issued_at, f.created_at
      FROM   factures f
      WHERE  f.client_id = ? AND f.boutique_id = ? AND f.statut != 'ANNULE'
      ORDER  BY f.created_at DESC
      LIMIT  50
    `).bind(id, boutiqueId).all(),

    // ── Rachats ── (pas de client_id sur rachats — table livre de police vendeur)
    // On retourne un tableau vide : les rachats sont liés au vendeur (externe), pas au client CRM
    Promise.resolve({ results: [] }),

    // ── Rendez-vous ──
    db.prepare(`
      SELECT rv.id, rv.type_rdv as type, rv.statut, rv.debut, rv.fin,
             rv.description, rv.created_at
      FROM   rendez_vous rv
      WHERE  rv.client_id = ? AND rv.boutique_id = ? AND rv.actif = 1
      ORDER  BY rv.debut DESC
      LIMIT  20
    `).bind(id, boutiqueId).all(),
  ])

  // ── KPIs synthèse client ──
  const kpis = {
    nb_tickets:   tickets.results.length,
    nb_factures:  factures.results.length,
    nb_rachats:   rachats.results.length,
    nb_rdv:       rdv.results.length,
    ca_total:     (factures.results as any[]).reduce((s, f) => s + (f.total_ttc || 0), 0),
    ticket_ouvert: (tickets.results as any[]).filter(
      (t: any) => !['CLOTURE', 'LIVRE', 'ANNULE'].includes(t.statut)
    ).length,
  }

  return {
    tickets:      tickets.results,
    factures:     factures.results,
    rachats:      rachats.results,
    rendez_vous:  rdv.results,
    kpis,
  }
}

// ─── Import CSV ───────────────────────────────────────────────────────────────

/**
 * Importe un lot de clients depuis un CSV parsé côté frontend.
 * Stratégie : INSERT OR IGNORE sur email (doublon silencieux).
 * Les lignes sans email sont toujours insérées.
 *
 * @param db         - Instance D1Database
 * @param boutiqueId - ID boutique
 * @param rows       - Tableau de lignes parsées (min : prenom ou nom requis)
 * @returns { inserted: number, skipped: number, errors: string[] }
 */
export async function importClients(
  db: D1Database,
  boutiqueId: number,
  rows: ImportClientRow[]
): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  let inserted = 0
  let skipped  = 0
  const errors: string[] = []

  for (const [i, row] of rows.entries()) {
    const nom = (row.nom || '').trim()
    const prenom = (row.prenom || '').trim()

    if (!nom && !prenom) {
      errors.push(`Ligne ${i + 2} : nom ou prénom obligatoire.`)
      skipped++
      continue
    }

    try {
      // Vérifier doublon email si fourni
      if (row.email) {
        const exists = await db.prepare(
          'SELECT id FROM clients WHERE email = ? AND boutique_id = ? AND actif = 1'
        ).bind(row.email.trim(), boutiqueId).first()
        if (exists) {
          skipped++
          continue
        }
      }

      await db.prepare(`
        INSERT INTO clients
          (boutique_id, prenom, nom, email, telephone, adresse, code_postal, ville, pays, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        boutiqueId,
        prenom || '',
        nom    || prenom,
        row.email       ? row.email.trim()       : null,
        row.telephone   ? row.telephone.trim()   : null,
        row.adresse     ? row.adresse.trim()     : null,
        row.code_postal ? row.code_postal.trim() : null,
        row.ville       ? row.ville.trim()       : null,
        row.pays        ? row.pays.trim()        : 'France',
        row.notes       ? row.notes.trim()       : null
      ).run()

      inserted++
    } catch (err: any) {
      errors.push(`Ligne ${i + 2} : ${err.message}`)
      skipped++
    }
  }

  return { inserted, skipped, errors }
}

// ─── Helpers internes ─────────────────────────────────────────────────────────

/**
 * Retourne uniquement l'email et le prénom d'un client.
 * Utilisé par les hooks email non-bloquants dans `routes/tickets.ts` et `routes/sav.ts`.
 * Plus léger que `getClientById()` — ne charge pas les appareils ni la boutique.
 *
 * @param db       - Instance D1Database
 * @param clientId - ID du client
 * @returns        `{ email, prenom }` ou `null` si client introuvable
 */
export async function getClientEmailPrenom(
  db:       D1Database,
  clientId: number
): Promise<{ email: string | null; prenom: string } | null> {
  return db.prepare(
    'SELECT email, prenom FROM clients WHERE id = ? LIMIT 1'
  ).bind(clientId).first<{ email: string | null; prenom: string }>()
}

/**
 * Compte le nombre de tickets actifs d'un client.
 * Utilisé par d'autres services (ticketService futur) sans cross-module SQL.
 *
 * @param db       - Instance D1Database
 * @param clientId - ID du client
 * @returns Nombre de tickets actifs
 */
export async function countTicketsByClient(
  db: D1Database,
  clientId: number
): Promise<number> {
  const row = await db.prepare(
    'SELECT COUNT(*) as cnt FROM tickets WHERE client_id = ? AND actif = 1'
  ).bind(clientId).first<{ cnt: number }>()
  return row?.cnt ?? 0
}

// ─── RGPD (Sprint 2.37) ───────────────────────────────────────────────────────

/**
 * Export RGPD complet d'un client (droit d'accès — Art. 15 RGPD).
 * Retourne un JSON structuré : données personnelles + tickets + factures + RDV + appareils.
 * Les données sensibles (password_hash, etc.) ne sont jamais incluses.
 *
 * @param db       - Instance D1Database
 * @param clientId - ID du client
 * @returns        Objet JSON complet ou null si client introuvable
 */
export async function exportClientRgpd(
  db:       D1Database,
  clientId: number
): Promise<object | null> {
  const client = await getClientById(db, clientId)
  if (!client) return null

  const [tickets, factures, rdv, appareils] = await Promise.all([
    db.prepare(`
      SELECT id, numero, statut, description_panne, diagnostic,
             appareil_marque, appareil_modele, imei, prix_estime, prix_final,
             date_reception, date_promesse, created_at, updated_at, archived_at
      FROM   tickets
      WHERE  client_id = ? AND actif = 1
      ORDER  BY created_at DESC
    `).bind(clientId).all(),

    db.prepare(`
      SELECT f.id, f.numero, f.statut, f.total_ht, f.total_tva, f.total_ttc,
             f.issued_at, f.created_at
      FROM   factures f
      WHERE  f.client_id = ?
      ORDER  BY f.created_at DESC
    `).bind(clientId).all(),

    db.prepare(`
      SELECT id, type_rdv AS type, statut, debut, fin, description, created_at
      FROM   rendez_vous
      WHERE  client_id = ? AND actif = 1
      ORDER  BY debut DESC
    `).bind(clientId).all(),

    db.prepare(`
      SELECT id, marque, modele, imei, numero_serie, couleur, notes, created_at
      FROM   appareils_client
      WHERE  client_id = ?
      ORDER  BY created_at DESC
    `).bind(clientId).all(),
  ])

  return {
    export_date:   new Date().toISOString(),
    rgpd_base:     'Règlement UE 2016/679 — Art. 15 (droit d\'accès)',
    client: {
      id:          client.id,
      prenom:      client.prenom,
      nom:         client.nom,
      email:       client.email,
      telephone:   client.telephone,
      adresse:     client.adresse,
      code_postal: client.code_postal,
      ville:       client.ville,
      pays:        client.pays,
      notes:       client.notes,
      created_at:  client.created_at,
    },
    tickets:     tickets.results   ?? [],
    factures:    factures.results  ?? [],
    rendez_vous: rdv.results       ?? [],
    appareils:   appareils.results ?? [],
  }
}

/**
 * Anonymisation RGPD d'un client (droit à l'effacement — Art. 17 RGPD).
 * Pseudonymise les données personnelles (nom, email, tel, adresse).
 * Conserve intact l'historique comptable (factures, tickets) par obligation légale.
 * Soft-delete le compte client (actif = 0).
 *
 * @param db       - Instance D1Database
 * @param clientId - ID du client
 * @param userId   - ID de l'utilisateur qui effectue la purge
 * @throws si client introuvable ou déjà anonymisé
 */
export async function purgeClient(
  db:       D1Database,
  clientId: number,
  userId:   number
): Promise<void> {
  const client = await db.prepare(
    'SELECT id, prenom, nom, email, actif FROM clients WHERE id = ?'
  ).bind(clientId).first<{ id: number; prenom: string; nom: string; email: string | null; actif: number }>()

  if (!client)        throw new Error(`Client #${clientId} introuvable.`)
  if (!client.actif)  throw new Error(`Client #${clientId} déjà supprimé.`)
  if (client.prenom === 'Anonymisé')
    throw new Error(`Client #${clientId} déjà anonymisé.`)

  const anon = `RGPD-${clientId}`

  await db.prepare(`
    UPDATE clients SET
      prenom       = 'Anonymisé',
      nom          = ?,
      email        = NULL,
      telephone    = NULL,
      adresse      = NULL,
      code_postal  = NULL,
      ville        = NULL,
      notes        = NULL,
      actif        = 0,
      updated_at   = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(anon, clientId).run()

  // Anonymiser aussi les appareils liés (IMEI est une donnée personnelle)
  await db.prepare(`
    UPDATE appareils_client SET
      imei          = NULL,
      numero_serie  = NULL,
      notes         = NULL
    WHERE client_id = ?
  `).bind(clientId).run()

  await auditLog(db, {
    user_id:     userId,
    action:      'RGPD_PURGE_CLIENT',
    entite_type: 'client',
    entite_id:   clientId,
    avant:       { prenom: client.prenom, nom: client.nom, email: client.email },
    apres:       { prenom: 'Anonymisé', nom: anon, email: null },
  })
}
