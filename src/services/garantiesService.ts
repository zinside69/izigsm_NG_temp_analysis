/**
 * garantiesService.ts — Model SAV & Garanties (Sprint 2.10)
 *
 * Règles métier :
 *  - Une garantie est créée automatiquement quand un ticket passe en "termine"
 *  - Un dossier SAV peut être ouvert sur n'importe quelle garantie encore active
 *  - Un dossier SAV crée un nouveau ticket (type réparation sous garantie)
 *  - Machine à états SAV : ouvert → en_traitement → resolu | refuse → clos
 */

import { nextNumero, parsePagination } from '../lib/db'

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

// Transitions SAV (machine à états)
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
 * La durée est lue depuis boutique_settings.garantie_defaut_jours (défaut : 90j).
 * Idempotent : si une garantie active existe déjà pour ce ticket, elle est retournée.
 */
export async function createGarantieFromTicket(
  db:        D1Database,
  ticketId:  number,
  boutiqueId: number
): Promise<GarantieRow> {
  // Vérifie si une garantie active existe déjà
  const existing = await db.prepare(`
    SELECT * FROM garanties WHERE ticket_id = ? AND actif = 1 LIMIT 1
  `).bind(ticketId).first<GarantieRow>()
  if (existing) return existing

  // Lire durée depuis settings
  const settings = await db.prepare(`
    SELECT garantie_defaut_jours FROM boutique_settings WHERE boutique_id = ?
  `).bind(boutiqueId).first<{ garantie_defaut_jours: number }>()
  const garantieJours = settings?.garantie_defaut_jours ?? 90

  // Lire infos du ticket (client, appareil, diagnostic)
  const ticket = await db.prepare(`
    SELECT client_id, appareil_marque, appareil_modele, diagnostic
    FROM tickets WHERE id = ? LIMIT 1
  `).bind(ticketId).first<{
    client_id: number | null
    appareil_marque: string | null
    appareil_modele: string | null
    diagnostic: string | null
  }>()

  const result = await db.prepare(`
    INSERT INTO garanties
      (boutique_id, ticket_id, client_id, appareil_marque, appareil_modele,
       description_reparation, date_debut, date_fin, garantie_jours, statut)
    VALUES (?, ?, ?, ?, ?, ?,
            CURRENT_TIMESTAMP,
            datetime('now', ? || ' days'),
            ?, 'active')
    RETURNING *
  `).bind(
    boutiqueId,
    ticketId,
    ticket?.client_id    ?? null,
    ticket?.appareil_marque ?? null,
    ticket?.appareil_modele ?? null,
    ticket?.diagnostic   ?? null,
    `+${garantieJours}`,
    garantieJours
  ).first<GarantieRow>()

  if (!result) throw new Error('Échec création garantie.')
  return result
}

/**
 * Création manuelle d'une garantie (sans ticket associé obligatoire).
 */
export async function createGarantie(
  db:         D1Database,
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

  // ticket_id est NOT NULL en base — utiliser 0 comme sentinelle pour les garanties manuelles
  // (créées sans ticket associé)
  const ticketId = data.ticket_id ?? 0

  const result = await db.prepare(`
    INSERT INTO garanties
      (boutique_id, ticket_id, client_id, appareil_marque, appareil_modele,
       description_reparation, date_debut, date_fin, garantie_jours, statut)
    VALUES (?, ?, ?, ?, ?, ?,
            CURRENT_TIMESTAMP,
            datetime('now', ? || ' days'),
            ?, 'active')
    RETURNING *
  `).bind(
    boutiqueId,
    ticketId,
    data.client_id              ?? null,
    data.appareil_marque        ?? null,
    data.appareil_modele        ?? null,
    data.description_reparation ?? null,
    `+${garantieJours}`,
    garantieJours
  ).first<GarantieRow>()

  if (!result) throw new Error('Échec création garantie.')
  return result
}

/**
 * Récupère une garantie par son id (avec vérification boutique).
 */
export async function getGarantie(
  db:         D1Database,
  id:         number,
  boutiqueId: number
): Promise<(GarantieRow & {
  client_nom?: string; client_prenom?: string; client_telephone?: string
  ticket_numero?: string
}) | null> {
  return db.prepare(`
    SELECT g.*,
           c.nom    AS client_nom,
           c.prenom AS client_prenom,
           c.telephone AS client_telephone,
           t.numero AS ticket_numero
    FROM   garanties g
    LEFT   JOIN clients c ON c.id = g.client_id
    LEFT   JOIN tickets t ON t.id = g.ticket_id
    WHERE  g.id = ? AND g.boutique_id = ? AND g.actif = 1
  `).bind(id, boutiqueId).first<GarantieRow & {
    client_nom?: string; client_prenom?: string; client_telephone?: string; ticket_numero?: string
  }>()
}

/**
 * Liste des garanties avec pagination + filtres.
 */
export async function listGaranties(
  db:         D1Database,
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
    db.prepare(`
      SELECT COUNT(*) as cnt
      FROM   garanties g
      LEFT   JOIN clients c ON c.id = g.client_id
      WHERE  ${where}
    `).bind(...params).first<{ cnt: number }>(),

    db.prepare(`
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
    `).bind(...params, limit, offset).all<any>(),
  ])

  return {
    data: rows.results ?? [],
    pagination: {
      page,
      limit,
      total: total?.cnt ?? 0,
      pages: Math.ceil((total?.cnt ?? 0) / limit),
    },
  }
}

/**
 * Expire automatiquement les garanties dont date_fin < now.
 * Retourne le nombre de garanties expirées.
 */
export async function checkAndExpireGaranties(
  db:         D1Database,
  boutiqueId: number
): Promise<number> {
  const result = await db.prepare(`
    UPDATE garanties
    SET    statut = 'expiree', updated_at = CURRENT_TIMESTAMP
    WHERE  boutique_id = ?
      AND  statut = 'active'
      AND  date_fin < datetime('now')
      AND  actif = 1
  `).bind(boutiqueId).run()

  return result.meta.changes ?? 0
}

// ─── Dossiers SAV ─────────────────────────────────────────────────────────────

/**
 * Ouvre un dossier SAV.
 * Vérifie que la garantie existe et est active (si garantie_id fourni).
 * Crée un nouveau ticket SAV automatiquement.
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
 * Liste des dossiers SAV avec pagination + filtres.
 */
export async function listSav(
  db:         D1Database,
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
    db.prepare(`
      SELECT COUNT(*) as cnt
      FROM   sav_dossiers s
      LEFT   JOIN clients c ON c.id = s.client_id
      WHERE  ${where}
    `).bind(...params).first<{ cnt: number }>(),

    db.prepare(`
      SELECT s.*,
             c.nom         AS client_nom,
             c.prenom      AS client_prenom,
             c.telephone   AS client_telephone,
             to.numero     AS ticket_origine_numero,
             ts.numero     AS ticket_sav_numero,
             g.date_fin    AS garantie_date_fin,
             g.statut      AS garantie_statut
      FROM   sav_dossiers s
      LEFT   JOIN clients  c  ON c.id  = s.client_id
      LEFT   JOIN tickets  to ON to.id = s.ticket_origine_id
      LEFT   JOIN tickets  ts ON ts.id = s.ticket_sav_id
      LEFT   JOIN garanties g ON g.id  = s.garantie_id
      WHERE  ${where}
      ORDER  BY s.date_ouverture DESC
      LIMIT  ? OFFSET ?
    `).bind(...params, limit, offset).all<any>(),
  ])

  return {
    data: rows.results ?? [],
    pagination: {
      page,
      limit,
      total: total?.cnt ?? 0,
      pages: Math.ceil((total?.cnt ?? 0) / limit),
    },
  }
}

/**
 * Détail d'un dossier SAV.
 */
export async function getSav(
  db:         D1Database,
  id:         number,
  boutiqueId: number
): Promise<any | null> {
  return db.prepare(`
    SELECT s.*,
           c.nom         AS client_nom,
           c.prenom      AS client_prenom,
           c.telephone   AS client_telephone,
           c.email       AS client_email,
           to.numero     AS ticket_origine_numero,
           to.appareil_marque AS ticket_origine_marque,
           to.appareil_modele AS ticket_origine_modele,
           ts.numero     AS ticket_sav_numero,
           ts.statut     AS ticket_sav_statut,
           g.date_debut  AS garantie_date_debut,
           g.date_fin    AS garantie_date_fin,
           g.garantie_jours,
           g.statut      AS garantie_statut,
           CAST(julianday(g.date_fin) - julianday('now') AS INTEGER) AS garantie_jours_restants
    FROM   sav_dossiers s
    LEFT   JOIN clients   c  ON c.id  = s.client_id
    LEFT   JOIN tickets   to ON to.id = s.ticket_origine_id
    LEFT   JOIN tickets   ts ON ts.id = s.ticket_sav_id
    LEFT   JOIN garanties g  ON g.id  = s.garantie_id
    WHERE  s.id = ? AND s.boutique_id = ? AND s.actif = 1
  `).bind(id, boutiqueId).first<any>()
}

/**
 * Met à jour le statut d'un dossier SAV (machine à états).
 * Ferme le ticket SAV associé si résolu/refusé/clos.
 */
export async function updateSavStatut(
  db:         D1Database,
  id:         number,
  boutiqueId: number,
  statut:     string,
  resolution?: string
): Promise<SavRow> {
  const sav = await db.prepare(`
    SELECT * FROM sav_dossiers WHERE id = ? AND boutique_id = ? AND actif = 1
  `).bind(id, boutiqueId).first<SavRow>()

  if (!sav) throw new Error('Dossier SAV introuvable.')

  const transitions = TRANSITIONS_SAV[sav.statut] ?? []
  if (!transitions.includes(statut))
    throw new Error(`Transition invalide : ${sav.statut} → ${statut}. Autorisées : ${transitions.join(', ') || 'aucune'}`)

  const estFermant = ['resolu', 'refuse', 'clos'].includes(statut)

  const updated = await db.prepare(`
    UPDATE sav_dossiers
    SET    statut      = ?,
           resolution  = COALESCE(?, resolution),
           date_cloture = CASE WHEN ? IN ('resolu','refuse','clos') THEN CURRENT_TIMESTAMP ELSE date_cloture END,
           updated_at  = CURRENT_TIMESTAMP
    WHERE  id = ? AND boutique_id = ?
    RETURNING *
  `).bind(statut, resolution ?? null, statut, id, boutiqueId).first<SavRow>()

  if (!updated) throw new Error('Mise à jour SAV échouée.')

  // Clore automatiquement le ticket SAV si le dossier se ferme
  if (estFermant && sav.ticket_sav_id) {
    const ticketStatut = statut === 'resolu' ? 'termine' : 'annule'
    await db.prepare(`
      UPDATE tickets
      SET statut = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND statut NOT IN ('livre','annule')
    `).bind(ticketStatut, sav.ticket_sav_id).run()
  }

  return updated
}

/**
 * KPIs SAV & Garanties pour le dashboard.
 */
export async function getKpisSav(
  db:         D1Database,
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
    totalTermines,
  ] = await Promise.all([
    db.prepare(`
      SELECT
        SUM(CASE WHEN statut='active'    THEN 1 ELSE 0 END) AS actives,
        SUM(CASE WHEN statut='expiree'   THEN 1 ELSE 0 END) AS expirees,
        SUM(CASE WHEN statut='consommee' THEN 1 ELSE 0 END) AS consommees
      FROM garanties WHERE boutique_id = ? AND actif = 1
    `).bind(boutiqueId).first<{ actives: number; expirees: number; consommees: number }>(),

    db.prepare(`
      SELECT COUNT(*) as cnt FROM garanties
      WHERE boutique_id = ? AND statut = 'active' AND actif = 1
        AND date_fin BETWEEN datetime('now') AND datetime('now', '+7 days')
    `).bind(boutiqueId).first<{ cnt: number }>(),

    db.prepare(`
      SELECT
        SUM(CASE WHEN statut='ouvert'        THEN 1 ELSE 0 END) AS ouverts,
        SUM(CASE WHEN statut='en_traitement' THEN 1 ELSE 0 END) AS en_traitement
      FROM sav_dossiers WHERE boutique_id = ? AND actif = 1
    `).bind(boutiqueId).first<{ ouverts: number; en_traitement: number }>(),

    db.prepare(`
      SELECT COUNT(*) as cnt FROM sav_dossiers
      WHERE boutique_id = ? AND statut IN ('resolu','clos') AND actif = 1
        AND strftime('%Y-%m', date_cloture) = strftime('%Y-%m', 'now')
    `).bind(boutiqueId).first<{ cnt: number }>(),

    db.prepare(`
      SELECT COUNT(*) as cnt FROM tickets
      WHERE boutique_id = ? AND statut IN ('termine','livre') AND actif = 1
    `).bind(boutiqueId).first<{ cnt: number }>(),
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
