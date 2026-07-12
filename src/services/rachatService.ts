/**
 * services/rachatService.ts — Model layer Rachats d'occasion & Livre de police
 * Sprint 2.21 — Architecture P1 : 0 SQL dans les routes, tout ici.
 *
 * Périmètre :
 *   - Livre de police : liste paginée, détail, création (art. 321-7), statut, export CSV
 *
 * Conformité légale :
 *   - Code pénal art. 321-7 : identification vendeur obligatoire + registre séquentiel
 *   - Numérotation LP-AAAA-XXXXX inaltérable via nextNumero()
 *   - Conservation 10 ans minimum
 *
 * @module rachatService
 */

import { parsePagination, nextNumero, auditLog } from '../lib/db'
import type { Database } from '../ports/database'

// ─── Types ────────────────────────────────────────────────────────────────────

export type StatutRachat = 'en_stock' | 'vendu' | 'retourne' | 'litige'
export type EtatAppareil = 'neuf' | 'bon' | 'correct' | 'mauvais' | 'hs'
export type TypePiece    = 'CNI' | 'PASSEPORT' | 'SEJOUR' | 'PERMIS'
export type ModePaiementRachat = 'especes' | 'virement' | 'cheque'

export interface CreateRachatInput {
  // Vendeur — obligatoire (art. 321-7)
  vendeur_nom:       string
  vendeur_prenom:    string
  vendeur_piece:     TypePiece
  vendeur_piece_num: string
  // Vendeur — recommandé
  vendeur_naissance?: string
  vendeur_adresse?:   string
  vendeur_cp?:        string
  vendeur_ville?:     string
  vendeur_telephone?: string
  // Appareil — obligatoire
  marque:  string
  modele:  string
  etat?:   EtatAppareil
  // Appareil — optionnel
  imei?:                 string
  imei2?:                string
  couleur?:              string
  capacite?:             string
  accessoires?:          string
  observations?:         string
  // Prix
  prix_rachat:           number
  mode_paiement?:        ModePaiementRachat
  reference_paiement?:   string
  // Boutique
  boutique_id?:          number
}

export interface ListRachatsOpts extends Record<string, string | undefined> {
  page?:       string
  limit?:      string
  statut?:     string
  search?:     string
  date_debut?: string
  date_fin?:   string
  boutique_id?: string
}

// ─── Constantes de validation ─────────────────────────────────────────────────

export const PIECES_VALIDES:       TypePiece[]           = ['CNI', 'PASSEPORT', 'SEJOUR', 'PERMIS']
export const ETATS_VALIDES:        EtatAppareil[]         = ['neuf', 'bon', 'correct', 'mauvais', 'hs']
export const MODES_PAIEMENT_VALIDES: ModePaiementRachat[] = ['especes', 'virement', 'cheque']
export const STATUTS_VALIDES:      StatutRachat[]         = ['en_stock', 'vendu', 'retourne', 'litige']

// ─── Rachat — Liste ───────────────────────────────────────────────────────────

/**
 * Liste paginée des rachats du livre de police.
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12) —
 * fonction de lecture pure, pas d'appel `auditLog` à découpler.
 * @param db         - Port Database
 * @param boutiqueId - ID de la boutique
 * @param opts       - Filtres : statut, search (nom/IMEI/numéro/marque), date_debut, date_fin
 */
export async function listRachats(
  db:          Database,
  boutiqueId:  number,
  opts:        ListRachatsOpts = {}
): Promise<{ data: any[]; pagination: any }> {
  const { page, limit, offset } = parsePagination(opts)

  const conditions: string[] = ['r.boutique_id = ?']
  const bindings:   any[]    = [boutiqueId]

  if (opts.statut) {
    conditions.push('r.statut = ?')
    bindings.push(opts.statut)
  }
  if (opts.search) {
    conditions.push(
      '(r.vendeur_nom LIKE ? OR r.vendeur_prenom LIKE ? OR r.imei LIKE ? OR r.numero LIKE ? OR r.marque LIKE ? OR r.modele LIKE ?)'
    )
    const s = `%${opts.search}%`
    bindings.push(s, s, s, s, s, s)
  }
  if (opts.date_debut) {
    conditions.push('r.date_rachat >= ?')
    bindings.push(opts.date_debut)
  }
  if (opts.date_fin) {
    conditions.push('r.date_rachat <= ?')
    bindings.push(opts.date_fin + ' 23:59:59')
  }

  const where = 'WHERE ' + conditions.join(' AND ')

  const [countRow, rows] = await Promise.all([
    db.get<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM rachats r ${where}`, bindings),

    db.all<any>(`
      SELECT r.id, r.numero, r.date_rachat, r.statut,
             r.vendeur_nom, r.vendeur_prenom,
             r.marque, r.modele, r.imei, r.etat,
             r.prix_rachat, r.mode_paiement,
             u.prenom || ' ' || u.nom as operateur_nom
      FROM   rachats r
      JOIN   users u ON u.id = r.user_id
      ${where}
      ORDER  BY r.date_rachat DESC
      LIMIT  ? OFFSET ?
    `, [...bindings, limit, offset]),
  ])

  return {
    data: rows ?? [],
    pagination: {
      page, limit,
      total: countRow?.cnt ?? 0,
      pages: Math.ceil((countRow?.cnt ?? 0) / limit),
    },
  }
}

// ─── Rachat — Détail ──────────────────────────────────────────────────────────

/**
 * Détail complet d'un rachat (+ infos opérateur + boutique).
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12).
 * @param db - Port Database
 * @param id - ID du rachat
 */
export async function getRachat(db: Database, id: number): Promise<any | null> {
  return db.get<any>(`
    SELECT r.*,
           u.prenom || ' ' || u.nom as operateur_nom,
           u.email                  as operateur_email,
           b.nom                    as boutique_nom,
           b.siret,
           b.adresse                as boutique_adresse,
           b.code_postal            as boutique_cp,
           b.ville                  as boutique_ville
    FROM   rachats   r
    JOIN   users     u ON u.id = r.user_id
    JOIN   boutiques b ON b.id = r.boutique_id
    WHERE  r.id = ?
  `, [id])
}

// ─── Rachat — Création ────────────────────────────────────────────────────────

/**
 * Crée une entrée dans le livre de police (art. 321-7).
 * Vérifie les doublons IMEI actifs avant insertion.
 * @param db         - Instance D1Database
 * @param boutiqueId - ID de la boutique
 * @param userId     - ID de l'opérateur
 * @param input      - Données du rachat
 */
export async function createRachat(
  db:          D1Database,
  boutiqueId:  number,
  userId:      number,
  input:       CreateRachatInput
): Promise<{ id: number; numero: string }> {
  const etat          = input.etat          ?? 'bon'
  const mode_paiement = input.mode_paiement ?? 'especes'

  // ── Vérification doublon IMEI dans le livre de police ────────────────────
  if (input.imei?.trim()) {
    const existant = await db.prepare(`
      SELECT id, numero FROM rachats
      WHERE imei = ? AND boutique_id = ? AND statut NOT IN ('retourne','litige')
    `).bind(input.imei.trim(), boutiqueId).first<{ id: number; numero: string }>()

    if (existant) {
      throw Object.assign(
        new Error(`Cet IMEI est déjà enregistré dans le livre de police (${existant.numero}). Vérifiez l'appareil.`),
        { code: 'DOUBLON_IMEI', doublon_id: existant.id }
      )
    }
  }

  // ── Numéro séquentiel LP-AAAA-XXXXX ──────────────────────────────────────
  const numero = await nextNumero(db, boutiqueId, 'rachat')

  // ── Insertion ─────────────────────────────────────────────────────────────
  const result = await db.prepare(`
    INSERT INTO rachats (
      boutique_id, numero,
      vendeur_nom, vendeur_prenom, vendeur_naissance,
      vendeur_adresse, vendeur_cp, vendeur_ville,
      vendeur_piece, vendeur_piece_num, vendeur_telephone,
      marque, modele, imei, imei2, couleur, capacite,
      etat, accessoires, observations,
      prix_rachat, mode_paiement, reference_paiement,
      user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    boutiqueId, numero,
    input.vendeur_nom.trim(), input.vendeur_prenom.trim(),
    input.vendeur_naissance  ?? null,
    input.vendeur_adresse    ?? null,
    input.vendeur_cp         ?? null,
    input.vendeur_ville      ?? null,
    input.vendeur_piece.toUpperCase(),
    input.vendeur_piece_num.trim(),
    input.vendeur_telephone  ?? null,
    input.marque.trim(), input.modele.trim(),
    input.imei?.trim()  ?? null,
    input.imei2?.trim() ?? null,
    input.couleur        ?? null,
    input.capacite       ?? null,
    etat,
    input.accessoires    ?? null,
    input.observations   ?? null,
    parseFloat(String(input.prix_rachat)),
    mode_paiement,
    input.reference_paiement ?? null,
    userId,
  ).first<{ id: number }>()

  if (!result?.id) throw new Error('Erreur lors de l\'insertion du rachat.')

  await auditLog(db, {
    boutique_id: boutiqueId, user_id: userId,
    action: 'CREATE_RACHAT', entite_type: 'rachat', entite_id: result.id,
    apres: {
      numero,
      marque:        input.marque,
      modele:        input.modele,
      imei:          input.imei ?? null,
      prix_rachat:   input.prix_rachat,
      vendeur_nom:   input.vendeur_nom,
      vendeur_prenom: input.vendeur_prenom,
    },
  })

  return { id: result.id, numero }
}

// ─── Rachat — Mise à jour statut ──────────────────────────────────────────────

/**
 * Met à jour le statut d'un rachat (en_stock → vendu/retourne/litige).
 * @param db       - Instance D1Database
 * @param id       - ID du rachat
 * @param userId   - ID de l'opérateur
 * @param statut   - Nouveau statut
 * @param produitId - ID produit si reconditionnement (optionnel)
 */
export async function updateStatutRachat(
  db:         D1Database,
  id:         number,
  userId:     number,
  statut:     StatutRachat,
  produitId?: number
): Promise<void> {
  const rachat = await db.prepare(
    'SELECT id, boutique_id, numero, statut FROM rachats WHERE id = ?'
  ).bind(id).first<any>()

  if (!rachat) throw new Error('Rachat introuvable.')

  await db.prepare(`
    UPDATE rachats
    SET    statut     = ?,
           produit_id = COALESCE(?, produit_id),
           updated_at = CURRENT_TIMESTAMP
    WHERE  id = ?
  `).bind(statut, produitId ?? null, id).run()

  await auditLog(db, {
    boutique_id: rachat.boutique_id, user_id: userId,
    action: 'UPDATE_RACHAT_STATUT', entite_type: 'rachat', entite_id: id,
    avant: { statut: rachat.statut },
    apres: { statut },
  })
}

// ─── Rachat — Export CSV Livre de police ──────────────────────────────────────

/**
 * Données brutes pour l'export CSV réglementaire du livre de police.
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12).
 * @param db         - Port Database
 * @param boutiqueId - ID de la boutique
 * @param opts       - Filtres date_debut / date_fin
 */
export async function exportLivrePolice(
  db:          Database,
  boutiqueId:  number,
  opts:        { date_debut?: string; date_fin?: string } = {}
): Promise<any[]> {
  const conditions: string[] = ['r.boutique_id = ?']
  const bindings:   any[]    = [boutiqueId]

  if (opts.date_debut) {
    conditions.push('r.date_rachat >= ?')
    bindings.push(opts.date_debut)
  }
  if (opts.date_fin) {
    conditions.push('r.date_rachat <= ?')
    bindings.push(opts.date_fin + ' 23:59:59')
  }

  const where = 'WHERE ' + conditions.join(' AND ')

  return db.all<any>(`
    SELECT r.numero, r.date_rachat,
           r.vendeur_nom, r.vendeur_prenom, r.vendeur_naissance,
           r.vendeur_adresse, r.vendeur_cp, r.vendeur_ville,
           r.vendeur_piece, r.vendeur_piece_num,
           r.marque, r.modele, r.imei, r.couleur, r.capacite, r.etat,
           r.prix_rachat, r.mode_paiement,
           r.statut,
           u.prenom || ' ' || u.nom as operateur
    FROM   rachats r
    JOIN   users   u ON u.id = r.user_id
    ${where}
    ORDER  BY r.date_rachat ASC
  `, bindings)
}
