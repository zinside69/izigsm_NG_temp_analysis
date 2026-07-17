/**
 * services/devisService.ts — Model layer Devis (MOD-03)
 * Sprint 2.19 — Architecture P1 : 0 SQL dans les routes, tout ici.
 *
 * Machine à états devis :
 *   draft → envoye → accepte → (converti en facture)
 *                 → refuse
 *   draft → expire  (automatique si date_validite dépassée)
 *   Tout état non terminal → annule
 *
 * @module devisService
 */

import { nextNumero, auditLog, parsePagination } from '../lib/db'
import type { Database } from '../ports/database'

// ─── Types ────────────────────────────────────────────────────────────────────

export type StatutDevis = 'draft' | 'envoye' | 'accepte' | 'refuse' | 'expire' | 'annule'

export interface LigneDevisInput {
  description:      string
  quantite:         number
  prix_unitaire_ht: number
  tva_taux:         number
  produit_id?:      number | null
}

export interface CreateDevisInput {
  boutique_id:    number
  client_id:      number
  ticket_id?:     number | null
  lignes:         LigneDevisInput[]
  notes?:         string
  conditions?:    string
  date_validite?: string | null
}

export interface UpdateDevisInput {
  client_id?:     number
  lignes?:        LigneDevisInput[]
  notes?:         string
  conditions?:    string
  date_validite?: string | null
}

export interface StatsDevis {
  total:          number
  draft:          number
  envoyes:        number
  acceptes:       number
  refuses:        number
  expires:        number
  montant_envoye: number
  montant_signe:  number
  taux_conversion: number | null
}

// ─── Helpers privés ───────────────────────────────────────────────────────────

/**
 * Génère un token public aléatoire (32 hex) via Web Crypto.
 */
async function genererPublicToken(): Promise<string> {
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Calcule les totaux HT / TVA / TTC depuis un tableau de lignes.
 */
function calculerTotaux(lignes: LigneDevisInput[]): { total_ht: number; total_tva: number; total_ttc: number } {
  let total_ht = 0, total_tva = 0
  for (const l of lignes) {
    const ht  = Math.round(l.quantite * l.prix_unitaire_ht * 100) / 100
    const tva = Math.round(ht * (l.tva_taux / 100) * 100) / 100
    total_ht  += ht
    total_tva += tva
  }
  return {
    total_ht:  Math.round(total_ht  * 100) / 100,
    total_tva: Math.round(total_tva * 100) / 100,
    total_ttc: Math.round((total_ht + total_tva) * 100) / 100,
  }
}

/**
 * Insère les lignes d'un devis dans lignes_document.
 * Supprime les lignes existantes avant réinsertion (lors d'un update).
 */
async function upsertLignes(db: D1Database, devisId: number, lignes: LigneDevisInput[]): Promise<void> {
  await db.prepare('DELETE FROM lignes_document WHERE document_type = ? AND document_id = ?')
    .bind('devis', devisId).run()

  const stmts = lignes.map((l, i) =>
    db.prepare(`
      INSERT INTO lignes_document
        (document_type, document_id, ordre, description, quantite, prix_unitaire_ht,
         tva_taux, total_ht, total_tva, total_ttc, produit_id)
      VALUES ('devis', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      devisId,
      i + 1,
      l.description,
      l.quantite,
      l.prix_unitaire_ht,
      l.tva_taux,
      Math.round(l.quantite * l.prix_unitaire_ht * 100) / 100,
      Math.round(l.quantite * l.prix_unitaire_ht * (l.tva_taux / 100) * 100) / 100,
      Math.round(l.quantite * l.prix_unitaire_ht * (1 + l.tva_taux / 100) * 100) / 100,
      l.produit_id ?? null,
    )
  )

  if (stmts.length > 0) await db.batch(stmts)
}

// ─── Fonctions exportées ──────────────────────────────────────────────────────

/**
 * Liste des devis d'une boutique avec filtres et pagination.
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-13) —
 * fonction de lecture pure, pas d'appel `auditLog`/`nextNumero` à découpler.
 * @param db        - Port Database
 * @param boutiqueId - ID de la boutique
 * @param opts      - Query params : page, limit, statut, client_id, search
 */
export async function listDevis(
  db:          Database,
  boutiqueId:  number,
  opts:        Record<string, string | undefined> = {}
): Promise<{ data: any[]; pagination: any }> {
  const { page, limit, offset } = parsePagination(opts)
  const statut    = opts.statut    ?? null
  const clientId  = opts.client_id ? parseInt(opts.client_id, 10) : null
  const search    = opts.search    ?? null

  const conditions = ['d.boutique_id = ?', 'd.statut != \'annule\'']
  const params: any[] = [boutiqueId]

  if (statut)   { conditions.push('d.statut = ?');          params.push(statut) }
  if (clientId) { conditions.push('d.client_id = ?');       params.push(clientId) }
  if (search)   {
    conditions.push('(d.numero LIKE ? OR c.nom LIKE ? OR c.prenom LIKE ?)')
    const q = `%${search}%`
    params.push(q, q, q)
  }

  const where = conditions.join(' AND ')

  const [total, rows] = await Promise.all([
    db.get<{ cnt: number }>(`
      SELECT COUNT(*) as cnt
      FROM   devis d
      LEFT   JOIN clients c ON c.id = d.client_id
      WHERE  ${where}
    `, params),

    db.all<any>(`
      SELECT d.*,
             c.nom      AS client_nom,
             c.prenom   AS client_prenom,
             c.email    AS client_email,
             c.telephone AS client_telephone
      FROM   devis d
      LEFT   JOIN clients c ON c.id = d.client_id
      WHERE  ${where}
      ORDER  BY d.created_at DESC
      LIMIT  ? OFFSET ?
    `, [...params, limit, offset]),
  ])

  return {
    data: rows ?? [],
    pagination: {
      page, limit,
      total: total?.cnt ?? 0,
      pages: Math.ceil((total?.cnt ?? 0) / limit),
    },
  }
}

/**
 * Détail complet d'un devis (+ lignes).
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-13) —
 * fonction de lecture pure, pas d'appel `auditLog`/`nextNumero` à découpler.
 * @param db  - Port Database
 * @param id  - ID du devis
 */
export async function getDevis(db: Database, id: number): Promise<any | null> {
  const [devis, lignes] = await Promise.all([
    // facture_acompte_* : facture type_facture='acompte' liée directement à ce devis
    // OU à son ticket parent (d.ticket_id, colonne existante, nullable) — un acompte
    // peut avoir été demandé depuis le ticket avant que le devis ne soit créé, voir
    // docs/superpowers/specs/2026-07-16-acompte-structure-design.md.
    db.get<any>(`
      SELECT d.*,
             c.nom       AS client_nom,
             c.prenom    AS client_prenom,
             c.email     AS client_email,
             c.telephone AS client_telephone,
             c.adresse   AS client_adresse,
             b.nom       AS boutique_nom,
             b.siret     AS boutique_siret,
             b.adresse   AS boutique_adresse,
             b.telephone AS boutique_telephone,
             b.email     AS boutique_email,
             b.tva_numero AS boutique_tva,
             fa.id        AS facture_acompte_id,
             fa.numero    AS facture_acompte_numero,
             fa.total_ttc AS facture_acompte_montant
      FROM   devis d
      LEFT   JOIN clients   c ON c.id = d.client_id
      LEFT   JOIN boutiques b ON b.id = d.boutique_id
      LEFT   JOIN factures  fa ON fa.type_facture = 'acompte' AND (fa.devis_id = d.id OR fa.ticket_id = d.ticket_id)
      WHERE  d.id = ?
    `, [id]),

    db.all<any>(`
      SELECT * FROM lignes_document
      WHERE  document_type = 'devis' AND document_id = ?
      ORDER  BY ordre ASC
    `, [id]),
  ])

  if (!devis) return null
  return { ...devis, lignes: lignes ?? [] }
}

/**
 * Crée un devis avec ses lignes. Génère numéro + public_token.
 * Non migré vers le port `Database` (chantier Ports & Adapters, 2026-07-13) :
 * dépend de `nextNumero()`, `upsertLignes()` (db.batch) et `auditLog()`, tous
 * encore sur `D1Database` brut.
 * @param db         - Instance D1Database
 * @param boutiqueId - ID de la boutique
 * @param userId     - ID de l'utilisateur créateur
 * @param input      - Données du devis
 */
export async function createDevis(
  db:          D1Database,
  boutiqueId:  number,
  userId:      number,
  input:       CreateDevisInput
): Promise<{ id: number; numero: string; public_token: string }> {
  if (!input.lignes || input.lignes.length === 0)
    throw new Error('Le devis doit contenir au moins une ligne.')

  const numero       = await nextNumero(db, boutiqueId, 'devis')
  const totaux       = calculerTotaux(input.lignes)
  const public_token = await genererPublicToken()

  const result = await db.prepare(`
    INSERT INTO devis
      (boutique_id, numero, client_id, ticket_id,
       total_ht, total_tva, total_ttc,
       notes, conditions, date_validite, public_token, statut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    RETURNING id
  `).bind(
    boutiqueId,
    numero,
    input.client_id,
    input.ticket_id   ?? null,
    totaux.total_ht,
    totaux.total_tva,
    totaux.total_ttc,
    input.notes       ?? null,
    input.conditions  ?? null,
    input.date_validite ?? null,
    public_token,
  ).first<{ id: number }>()

  if (!result?.id) throw new Error('Erreur lors de la création du devis.')

  await upsertLignes(db, result.id, input.lignes)
  await auditLog(db, { boutique_id: boutiqueId, user_id: userId, action: 'CREATE_DEVIS', entite_type: 'devis', entite_id: result.id })

  return { id: result.id, numero, public_token }
}

/**
 * Met à jour un devis (draft uniquement — les devis envoyés sont verrouillés).
 * Non migré vers le port `Database` (chantier Ports & Adapters, 2026-07-13) :
 * dépend de `upsertLignes()` (db.batch) et `auditLog()`, tous deux encore sur
 * `D1Database` brut.
 * @param db     - Instance D1Database
 * @param id     - ID du devis
 * @param userId - ID de l'utilisateur
 * @param input  - Champs à mettre à jour
 */
export async function updateDevis(
  db:     D1Database,
  id:     number,
  userId: number,
  input:  UpdateDevisInput
): Promise<void> {
  const existing = await db.prepare('SELECT * FROM devis WHERE id = ?').bind(id).first<any>()
  if (!existing) throw new Error('Devis introuvable.')
  if (existing.statut !== 'draft') throw new Error('Seuls les devis en brouillon peuvent être modifiés.')

  const totaux = input.lignes ? calculerTotaux(input.lignes) : null

  await db.prepare(`
    UPDATE devis SET
      client_id     = COALESCE(?, client_id),
      total_ht      = COALESCE(?, total_ht),
      total_tva     = COALESCE(?, total_tva),
      total_ttc     = COALESCE(?, total_ttc),
      notes         = COALESCE(?, notes),
      conditions    = COALESCE(?, conditions),
      date_validite = COALESCE(?, date_validite),
      updated_at    = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    input.client_id    ?? null,
    totaux?.total_ht   ?? null,
    totaux?.total_tva  ?? null,
    totaux?.total_ttc  ?? null,
    input.notes        ?? null,
    input.conditions   ?? null,
    input.date_validite ?? null,
    id,
  ).run()

  if (input.lignes) await upsertLignes(db, id, input.lignes)

  await auditLog(db, { boutique_id: existing.boutique_id, user_id: userId, action: 'UPDATE_DEVIS', entite_type: 'devis', entite_id: id })
}

/**
 * Change le statut d'un devis (machine à états enforced).
 * Transitions autorisées :
 *   draft    → envoye | annule
 *   envoye   → accepte | refuse | expire | annule
 *   accepte  → (géré par convertirDevis)
 *   refuse   → (terminal)
 *   expire   → (terminal)
 *   annule   → (terminal)
 *
 * Non migré vers le port `Database` (chantier Ports & Adapters, 2026-07-13) :
 * dépend d'`auditLog()`, qui prend encore un `D1Database` brut.
 * @param db       - Instance D1Database
 * @param id       - ID du devis
 * @param userId   - ID de l'utilisateur
 * @param statut   - Nouveau statut
 * @param fromPublic - true si changement initié par le client (page publique)
 */
export async function updateStatutDevis(
  db:         D1Database,
  id:         number,
  userId:     number,
  statut:     StatutDevis,
  fromPublic: boolean = false
): Promise<{ statut_avant: string; statut_apres: string }> {
  const TRANSITIONS: Record<StatutDevis, StatutDevis[]> = {
    draft:   ['envoye', 'annule'],
    envoye:  ['accepte', 'refuse', 'expire', 'annule'],
    accepte: [],
    refuse:  [],
    expire:  [],
    annule:  [],
  }

  const devis = await db.prepare('SELECT * FROM devis WHERE id = ?').bind(id).first<any>()
  if (!devis) throw new Error('Devis introuvable.')

  const current = devis.statut as StatutDevis
  if (!TRANSITIONS[current]?.includes(statut))
    throw new Error(`Transition invalide : ${current} → ${statut}.`)

  const extras: Record<string, string> = {}
  if (statut === 'envoye')  extras['envoye_le']  = 'CURRENT_TIMESTAMP'
  if (statut === 'accepte') extras['repondu_le'] = 'CURRENT_TIMESTAMP'
  if (statut === 'refuse')  extras['repondu_le'] = 'CURRENT_TIMESTAMP'

  const setClause = ['statut = ?', 'updated_at = CURRENT_TIMESTAMP',
    ...Object.keys(extras).map(k => `${k} = ${extras[k]}`)
  ].join(', ')

  await db.prepare(`UPDATE devis SET ${setClause} WHERE id = ?`)
    .bind(statut, id).run()

  const action = fromPublic ? 'PUBLIC_STATUT_DEVIS' : 'UPDATE_STATUT_DEVIS'
  await auditLog(db, { boutique_id: devis.boutique_id, user_id: userId, action, entite_type: 'devis', entite_id: id })

  return { statut_avant: current, statut_apres: statut }
}

/**
 * Convertit un devis accepté en facture (avec copie des lignes).
 * Non migré vers le port `Database` (chantier Ports & Adapters, 2026-07-13) :
 * dépend de `nextNumero()` et `auditLog()`, tous deux encore sur `D1Database`
 * brut.
 * @param db     - Instance D1Database
 * @param id     - ID du devis
 * @param userId - ID de l'utilisateur
 */
export async function convertirDevis(
  db:     D1Database,
  id:     number,
  userId: number
): Promise<{ facture_id: number; facture_numero: string }> {
  const devis = await db.prepare('SELECT * FROM devis WHERE id = ?').bind(id).first<any>()
  if (!devis)                       throw new Error('Devis introuvable.')
  if (devis.statut === 'refuse')    throw new Error('Impossible de convertir un devis refusé.')
  if (devis.statut === 'annule')    throw new Error('Impossible de convertir un devis annulé.')
  if (devis.facture_id)             throw new Error('Ce devis a déjà été converti en facture.')

  const numero = await nextNumero(db, devis.boutique_id, 'facture')

  const facture = await db.prepare(`
    INSERT INTO factures
      (boutique_id, numero, client_id, ticket_id, devis_id, total_ht, total_tva, total_ttc, statut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'brouillon')
    RETURNING id
  `).bind(
    devis.boutique_id, numero,
    devis.client_id, devis.ticket_id ?? null, id,
    devis.total_ht, devis.total_tva, devis.total_ttc,
  ).first<{ id: number }>()

  if (!facture?.id) throw new Error('Erreur lors de la création de la facture.')

  // Copier les lignes devis → facture
  await db.prepare(`
    INSERT INTO lignes_document
      (document_type, document_id, ordre, description, quantite,
       prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc, produit_id)
    SELECT 'facture', ?, ordre, description, quantite,
           prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc, produit_id
    FROM   lignes_document
    WHERE  document_type = 'devis' AND document_id = ?
  `).bind(facture.id, id).run()

  // Déduction acompte structuré (2026-07-16) : si une facture d'acompte a été
  // émise pour ce devis ou son ticket, ajouter une ligne négative et réduire les
  // totaux de la facture finale d'autant — la facture finale ne demande alors que
  // le solde restant, voir docs/superpowers/specs/2026-07-16-acompte-structure-design.md.
  const acompte = await db.prepare(`
    SELECT id, numero, total_ht, total_tva, total_ttc FROM factures
    WHERE type_facture = 'acompte' AND (devis_id = ? OR ticket_id = ?)
  `).bind(id, devis.ticket_id ?? 0).first<{
    id: number; numero: string; total_ht: number; total_tva: number; total_ttc: number
  }>()

  if (acompte) {
    const maxOrdre = await db.prepare(`
      SELECT COALESCE(MAX(ordre), 0) as maxOrdre FROM lignes_document WHERE document_type = 'facture' AND document_id = ?
    `).bind(facture.id).first<{ maxOrdre: number }>()

    // Taux de TVA affiché sur la ligne négative : lu directement sur la ligne
    // "Acompte" de la facture d'acompte (créée par createFactureAcompte()), pas
    // recalculé depuis total_tva/total_ht — un recalcul (ex. 8.33/41.67=19.99%)
    // aurait pollué la ventilation par taux de getRapportComptable() (destinée à
    // l'expert-comptable, groupe par tva_taux arrondi) avec un taux fantôme
    // distinct du 20% réel, au lieu de s'annuler dans le même panier.
    const acompteLigne = await db.prepare(`
      SELECT tva_taux FROM lignes_document WHERE document_type = 'facture' AND document_id = ? LIMIT 1
    `).bind(acompte.id).first<{ tva_taux: number }>()
    const tvaTauxAffiche = acompteLigne?.tva_taux ?? 20

    await db.prepare(`
      INSERT INTO lignes_document
        (document_type, document_id, ordre, description, quantite,
         prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc, produit_id)
      VALUES ('facture', ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL)
    `).bind(
      facture.id, (maxOrdre?.maxOrdre ?? 0) + 1,
      `Acompte déjà facturé (${acompte.numero})`,
      -acompte.total_ht, tvaTauxAffiche,
      -acompte.total_ht, -acompte.total_tva, -acompte.total_ttc,
    ).run()

    const totalHt  = Math.round((devis.total_ht  - acompte.total_ht)  * 100) / 100
    const totalTva = Math.round((devis.total_tva - acompte.total_tva) * 100) / 100
    const totalTtc = Math.round((devis.total_ttc - acompte.total_ttc) * 100) / 100

    await db.prepare(`
      UPDATE factures SET total_ht = ?, total_tva = ?, total_ttc = ? WHERE id = ?
    `).bind(totalHt, totalTva, totalTtc, facture.id).run()
  }

  // Marquer le devis accepté + lié à la facture
  await db.prepare(`
    UPDATE devis SET statut = 'accepte', facture_id = ?, repondu_le = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(facture.id, id).run()

  await auditLog(db, {
    boutique_id: devis.boutique_id, user_id: userId,
    action: 'CONVERT_DEVIS_FACTURE',
    entite_type: 'facture', entite_id: facture.id,
  })

  return { facture_id: facture.id, facture_numero: numero }
}

/**
 * Récupère un devis par son token public (sans authentification).
 * Retourne uniquement les données nécessaires pour la page d'acceptation client.
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-13) —
 * fonction de lecture pure, pas d'appel `auditLog`/`nextNumero` à découpler.
 * @param db    - Port Database
 * @param token - Token public du devis
 */
export async function getDevisByToken(db: Database, token: string): Promise<any | null> {
  const [devis, lignes] = await Promise.all([
    db.get<any>(`
      SELECT d.id, d.numero, d.statut, d.total_ht, d.total_tva, d.total_ttc,
             d.date_validite, d.envoye_le, d.repondu_le, d.notes, d.conditions,
             c.nom       AS client_nom,
             c.prenom    AS client_prenom,
             b.nom       AS boutique_nom,
             b.telephone AS boutique_telephone,
             b.email     AS boutique_email,
             b.adresse   AS boutique_adresse,
             b.ville     AS boutique_ville,
             b.logo_url  AS boutique_logo
      FROM   devis d
      LEFT   JOIN clients   c ON c.id = d.client_id
      LEFT   JOIN boutiques b ON b.id = d.boutique_id
      WHERE  d.public_token = ?
    `, [token]),

    db.all<any>(`
      SELECT ordre, description, quantite, prix_unitaire_ht, tva_taux, total_ht, total_ttc
      FROM   lignes_document
      WHERE  document_type = 'devis' AND document_id = (
        SELECT id FROM devis WHERE public_token = ?
      )
      ORDER  BY ordre ASC
    `, [token]),
  ])

  if (!devis) return null
  return { ...devis, lignes: lignes ?? [] }
}

/**
 * Statistiques des devis d'une boutique.
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-13) —
 * fonction de lecture pure, pas d'appel `auditLog`/`nextNumero` à découpler.
 * @param db         - Port Database
 * @param boutiqueId - ID de la boutique
 */
export async function getStatsDevis(db: Database, boutiqueId: number): Promise<StatsDevis> {
  const rows = await db.get<any>(`
    SELECT
      COUNT(*)                                              AS total,
      SUM(CASE WHEN statut = 'draft'   THEN 1 ELSE 0 END) AS draft,
      SUM(CASE WHEN statut = 'envoye'  THEN 1 ELSE 0 END) AS envoyes,
      SUM(CASE WHEN statut = 'accepte' THEN 1 ELSE 0 END) AS acceptes,
      SUM(CASE WHEN statut = 'refuse'  THEN 1 ELSE 0 END) AS refuses,
      SUM(CASE WHEN statut = 'expire'  THEN 1 ELSE 0 END) AS expires,
      SUM(CASE WHEN statut = 'envoye'  THEN total_ttc ELSE 0 END) AS montant_envoye,
      SUM(CASE WHEN statut = 'accepte' THEN total_ttc ELSE 0 END) AS montant_signe
    FROM devis
    WHERE boutique_id = ? AND statut != 'annule'
  `, [boutiqueId])

  const envoyes  = rows?.envoyes  ?? 0
  const acceptes = rows?.acceptes ?? 0
  const taux     = envoyes > 0 ? Math.round((acceptes / (envoyes + acceptes + (rows?.refuses ?? 0))) * 100) : null

  return {
    total:           rows?.total          ?? 0,
    draft:           rows?.draft          ?? 0,
    envoyes,
    acceptes,
    refuses:         rows?.refuses        ?? 0,
    expires:         rows?.expires        ?? 0,
    montant_envoye:  rows?.montant_envoye ?? 0,
    montant_signe:   rows?.montant_signe  ?? 0,
    taux_conversion: taux,
  }
}

/**
 * Expire automatiquement les devis dont la date_validite est dépassée.
 * À appeler en tâche de fond (Cron Trigger ou manuellement).
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-13) —
 * UPDATE simple sans RETURNING, pas d'appel `auditLog`/`nextNumero` à découpler.
 * @param db - Port Database
 */
export async function expireDevisPerimes(db: Database): Promise<number> {
  const result = await db.run(`
    UPDATE devis
    SET statut = 'expire', updated_at = CURRENT_TIMESTAMP
    WHERE statut = 'envoye'
      AND date_validite IS NOT NULL
      AND date_validite < date('now')
  `)

  return result.changes ?? 0
}

/**
 * Enregistre la signature client sur un devis (réponse publique).
 * Tronquée à 1000 caractères (protection contre abus).
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-13) —
 * UPDATE simple sans RETURNING, pas d'appel `auditLog`/`nextNumero` à découpler.
 *
 * @param db        - Port Database
 * @param devisId   - ID du devis
 * @param signature - Contenu de la signature (texte ou data URL SVG)
 */
export async function saveSignatureDevis(
  db:        Database,
  devisId:   number,
  signature: string
): Promise<void> {
  await db.run(
    'UPDATE devis SET signature_client = ? WHERE id = ?',
    [signature.slice(0, 1000), devisId]
  )
}
