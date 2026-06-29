/**
 * services/factureService.ts — Model layer Factures + Avoirs (MOD-02 NF525)
 * Sprint 2.20 — Architecture P1 : 0 SQL dans les routes, tout ici.
 *
 * Périmètre :
 *   - Factures : liste paginée, détail, paiement, émission (NF525 + lock)
 *   - Avoirs   : liste, détail, création (NF525)
 *
 * NF525 : chaque facture émise et chaque avoir est chaîné via SHA-256
 * dans la table `journal_nf525`. Le hash est inaltérable une fois émis.
 * Fonctions auxiliaires pour `routes/facturation.ts` :
 *   getDevisPourNf525(db, devisId)         — Charge un devis pour enregistrement NF525
 *   updateFactureHash(db, factureId, hash) — Écrit le hash NF525 sur une facture
 *
 * @module factureService
 */

import { nextNumero, auditLog, parsePagination, calculLignes } from '../lib/db'
import { enregistrerTransaction } from '../lib/nf525'

// ─── Types ────────────────────────────────────────────────────────────────────

export type StatutFacture = 'brouillon' | 'en_attente' | 'partiellement_payee' | 'payee' | 'annulee'
export type TypeAvoir     = 'remboursement' | 'bon_achat' | 'echange'

export interface LigneInput {
  description:      string
  quantite:         number
  prix_unitaire_ht: number
  tva_taux?:        number
}

export interface PaiementInput {
  montant:       number
  mode_paiement: string
  reference?:    string
  notes?:        string
}

export interface CreateAvoirInput {
  facture_id: number
  type?:      TypeAvoir
  motif:      string
  lignes:     LigneInput[]
  notes?:     string
}

// ─── Factures ─────────────────────────────────────────────────────────────────

/**
 * Liste des factures d'une boutique avec pagination.
 * @param db         - Instance D1Database
 * @param boutiqueId - ID de la boutique
 * @param opts       - Query params : page, limit, statut, client_id
 */
export async function listFactures(
  db:          D1Database,
  boutiqueId:  number,
  opts:        Record<string, string | undefined> = {}
): Promise<{ data: any[]; pagination: any }> {
  const { page, limit, offset } = parsePagination(opts)
  const statut   = opts.statut    ?? null
  const clientId = opts.client_id ? parseInt(opts.client_id, 10) : null

  const conditions = ['f.boutique_id = ?']
  const params: any[] = [boutiqueId]

  if (statut)   { conditions.push('f.statut = ?');    params.push(statut) }
  if (clientId) { conditions.push('f.client_id = ?'); params.push(clientId) }

  const where = conditions.join(' AND ')

  const [countRow, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as cnt FROM factures f WHERE ${where}`)
      .bind(...params).first<{ cnt: number }>(),

    db.prepare(`
      SELECT f.id, f.numero, f.statut, f.total_ttc, f.montant_paye,
             f.date_emission, f.issued_at, f.locked, f.hash_nf525,
             f.devis_id, f.ticket_id,
             c.prenom || ' ' || c.nom AS client_nom
      FROM   factures f
      JOIN   clients  c ON c.id = f.client_id
      WHERE  ${where}
      ORDER  BY f.created_at DESC
      LIMIT  ? OFFSET ?
    `).bind(...params, limit, offset).all<any>(),
  ])

  return {
    data: rows.results ?? [],
    pagination: {
      page, limit,
      total: countRow?.cnt ?? 0,
      pages: Math.ceil((countRow?.cnt ?? 0) / limit),
    },
  }
}

/**
 * Détail complet d'une facture (+ lignes + paiements).
 * @param db - Instance D1Database
 * @param id - ID de la facture
 */
export async function getFacture(db: D1Database, id: number): Promise<any | null> {
  const [facture, lignes, paiements] = await Promise.all([
    db.prepare(`
      SELECT f.*,
             c.prenom || ' ' || c.nom AS client_nom,
             c.email     AS client_email,
             c.telephone AS client_telephone,
             c.adresse,
             c.code_postal,
             c.ville,
             b.nom       AS boutique_nom,
             b.siret,
             b.tva_numero,
             b.adresse   AS boutique_adresse
      FROM   factures  f
      JOIN   clients   c ON c.id = f.client_id
      JOIN   boutiques b ON b.id = f.boutique_id
      WHERE  f.id = ?
    `).bind(id).first<any>(),

    db.prepare(
      "SELECT * FROM lignes_document WHERE document_type = 'facture' AND document_id = ? ORDER BY ordre"
    ).bind(id).all<any>(),

    db.prepare(
      'SELECT * FROM paiements WHERE facture_id = ? ORDER BY created_at'
    ).bind(id).all<any>(),
  ])

  if (!facture) return null
  return { ...facture, lignes: lignes.results ?? [], paiements: paiements.results ?? [] }
}

/**
 * Enregistre un paiement sur une facture et met à jour son statut.
 * Rejette si la facture est verrouillée après émission NF525.
 * @param db        - Instance D1Database
 * @param factureId - ID de la facture
 * @param userId    - ID de l'utilisateur
 * @param input     - Données du paiement
 */
export async function ajouterPaiement(
  db:        D1Database,
  factureId: number,
  userId:    number,
  input:     PaiementInput
): Promise<{ montant_paye: number; statut: StatutFacture }> {
  const facture = await db.prepare(
    'SELECT id, total_ttc, montant_paye, boutique_id, locked FROM factures WHERE id = ?'
  ).bind(factureId).first<any>()

  if (!facture) throw new Error('Facture introuvable.')
  if (facture.locked) throw new Error('Facture verrouillée — modification interdite (CGI art. 289).')

  await db.prepare(`
    INSERT INTO paiements
      (facture_id, boutique_id, montant, mode_paiement, reference, user_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    factureId,
    facture.boutique_id,
    input.montant,
    input.mode_paiement,
    input.reference ?? null,
    userId,
    input.notes ?? null,
  ).run()

  const nouveauMontantPaye = (facture.montant_paye ?? 0) + input.montant
  const statut: StatutFacture = nouveauMontantPaye >= facture.total_ttc ? 'payee' : 'partiellement_payee'

  await db.prepare(`
    UPDATE factures
    SET montant_paye = ?,
        statut       = ?,
        date_paiement = CASE WHEN ? >= total_ttc THEN CURRENT_TIMESTAMP ELSE date_paiement END
    WHERE id = ?
  `).bind(nouveauMontantPaye, statut, nouveauMontantPaye, factureId).run()

  await auditLog(db, {
    boutique_id: facture.boutique_id, user_id: userId,
    action: 'PAIEMENT_FACTURE', entite_type: 'facture', entite_id: factureId,
    apres: { montant_paye: nouveauMontantPaye, statut },
  })

  return { montant_paye: nouveauMontantPaye, statut }
}

/**
 * Émet une facture brouillon : verrouillage NF525 + hash SHA-256 + tracking_token.
 * Conforme CGI art. 289 — la facture devient inaltérable après émission.
 * @param db        - Instance D1Database
 * @param factureId - ID de la facture
 * @param userId    - ID de l'utilisateur
 */
export async function emettreFacture(
  db:        D1Database,
  factureId: number,
  userId:    number
): Promise<{ facture_numero: string; tracking_token: string; hash_nf525: string }> {
  const facture = await db.prepare('SELECT * FROM factures WHERE id = ?')
    .bind(factureId).first<any>()

  if (!facture) throw new Error('Facture introuvable.')
  if (facture.locked) throw new Error('Facture déjà émise et verrouillée.')

  // Token de tracking vitrine client
  const trackingToken = crypto.randomUUID()

  // Chaîne NF525 SHA-256 — enregistre dans journal_nf525
  const hashNf525 = await enregistrerTransaction(db, {
    boutique_id:      facture.boutique_id,
    type_transaction: 'facture',
    reference_id:     facture.id,
    reference_numero: facture.numero,
    client_id:        facture.client_id,
    montant_ht:       facture.total_ht,
    montant_tva:      facture.total_tva,
    montant_ttc:      facture.total_ttc,
    date_transaction: new Date().toISOString(),
    user_id:          userId,
  })

  // Verrouillage — CGI art. 289 (inaltérable après émission)
  await db.prepare(`
    UPDATE factures
    SET locked         = 1,
        issued_at      = CURRENT_TIMESTAMP,
        tracking_token = ?,
        hash_nf525     = ?,
        statut         = CASE WHEN statut = 'brouillon' THEN 'en_attente' ELSE statut END
    WHERE id = ?
  `).bind(trackingToken, hashNf525, factureId).run()

  await auditLog(db, {
    boutique_id: facture.boutique_id, user_id: userId,
    action: 'EMETTRE_FACTURE', entite_type: 'facture', entite_id: factureId,
    apres: { locked: true, issued_at: new Date().toISOString(), hash_nf525: hashNf525 },
  })

  return {
    facture_numero:  facture.numero,
    tracking_token:  trackingToken,
    hash_nf525:      hashNf525,
  }
}

// ─── Avoirs ───────────────────────────────────────────────────────────────────

/**
 * Liste des avoirs d'une boutique avec filtres et pagination.
 * @param db         - Instance D1Database
 * @param boutiqueId - ID de la boutique
 * @param opts       - Query params : page, limit, statut, facture_id, client_id
 */
export async function listAvoirs(
  db:          D1Database,
  boutiqueId:  number,
  opts:        Record<string, string | undefined> = {}
): Promise<{ data: any[]; pagination: any }> {
  const { page, limit, offset } = parsePagination(opts)

  const conditions = ['a.boutique_id = ?']
  const bindings:  any[] = [boutiqueId]

  if (opts.statut)     { conditions.push('a.statut = ?');     bindings.push(opts.statut) }
  if (opts.facture_id) { conditions.push('a.facture_id = ?'); bindings.push(parseInt(opts.facture_id, 10)) }
  if (opts.client_id)  { conditions.push('a.client_id = ?');  bindings.push(parseInt(opts.client_id, 10)) }

  const where = 'WHERE ' + conditions.join(' AND ')

  const [countRow, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as cnt FROM avoirs a ${where}`)
      .bind(...bindings).first<{ cnt: number }>(),

    db.prepare(`
      SELECT a.id, a.numero, a.type, a.motif, a.statut, a.total_ttc,
             a.date_emission, a.facture_id, a.hash_nf525,
             f.numero AS facture_numero,
             c.prenom || ' ' || c.nom AS client_nom
      FROM   avoirs    a
      JOIN   factures  f ON f.id = a.facture_id
      JOIN   clients   c ON c.id = a.client_id
      ${where}
      ORDER  BY a.created_at DESC
      LIMIT  ? OFFSET ?
    `).bind(...bindings, limit, offset).all<any>(),
  ])

  return {
    data: rows.results ?? [],
    pagination: {
      page, limit,
      total: countRow?.cnt ?? 0,
      pages: Math.ceil((countRow?.cnt ?? 0) / limit),
    },
  }
}

/**
 * Détail complet d'un avoir (+ lignes).
 * @param db - Instance D1Database
 * @param id - ID de l'avoir
 */
export async function getAvoir(db: D1Database, id: number): Promise<any | null> {
  const [avoir, lignes] = await Promise.all([
    db.prepare(`
      SELECT a.*,
             c.prenom || ' ' || c.nom AS client_nom,
             c.email     AS client_email,
             c.telephone AS client_telephone,
             c.adresse, c.code_postal, c.ville,
             b.nom       AS boutique_nom,
             b.siret,
             b.tva_numero,
             b.adresse   AS boutique_adresse,
             f.numero    AS facture_numero
      FROM   avoirs    a
      JOIN   clients   c ON c.id = a.client_id
      JOIN   boutiques b ON b.id = a.boutique_id
      JOIN   factures  f ON f.id = a.facture_id
      WHERE  a.id = ?
    `).bind(id).first<any>(),

    db.prepare(
      'SELECT * FROM lignes_avoir WHERE avoir_id = ? ORDER BY ordre'
    ).bind(id).all<any>(),
  ])

  if (!avoir) return null
  return { ...avoir, lignes: lignes.results ?? [] }
}

/**
 * Crée un avoir sur une facture émise (NF525 — chaîne SHA-256 obligatoire).
 * La facture source doit être locked (émise) pour émettre un avoir.
 * @param db     - Instance D1Database
 * @param userId - ID de l'utilisateur
 * @param input  - Données de l'avoir
 */
export async function createAvoir(
  db:     D1Database,
  userId: number,
  input:  CreateAvoirInput
): Promise<{ id: number; numero: string; hash_nf525: string }> {
  const TYPES_VALIDES: TypeAvoir[] = ['remboursement', 'bon_achat', 'echange']
  const type = input.type ?? 'remboursement'

  if (!TYPES_VALIDES.includes(type))
    throw new Error(`type doit être parmi : ${TYPES_VALIDES.join(', ')}.`)
  if (!input.motif?.trim())
    throw new Error('motif obligatoire.')
  if (!input.lignes?.length)
    throw new Error('Au moins une ligne obligatoire.')

  // Vérifier que la facture existe ET est verrouillée
  const facture = await db.prepare('SELECT * FROM factures WHERE id = ?')
    .bind(input.facture_id).first<any>()
  if (!facture) throw new Error('Facture introuvable.')
  if (!facture.locked)
    throw new Error('Impossible d\'émettre un avoir sur une facture non émise.')

  const boutiqueId                      = facture.boutique_id
  const { total_ht, total_tva, total_ttc } = calculLignes(input.lignes)
  const numero                          = await nextNumero(db, boutiqueId, 'avoir')

  // Insérer l'avoir
  const result = await db.prepare(`
    INSERT INTO avoirs
      (boutique_id, numero, facture_id, client_id, type, motif,
       total_ht, total_tva, total_ttc, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    boutiqueId, numero, input.facture_id, facture.client_id,
    type, input.motif,
    total_ht, total_tva, total_ttc,
    input.notes ?? null,
  ).first<{ id: number }>()

  if (!result?.id) throw new Error('Erreur lors de la création de l\'avoir.')
  const avoirId = result.id

  // Insérer les lignes (table lignes_avoir propre aux avoirs)
  const stmts = input.lignes.map((l, i) => {
    const ht  = Math.round(l.quantite * l.prix_unitaire_ht * 100) / 100
    const tva = Math.round(ht * ((l.tva_taux ?? 20) / 100) * 100) / 100
    return db.prepare(`
      INSERT INTO lignes_avoir
        (avoir_id, ordre, description, quantite, prix_unitaire_ht,
         tva_taux, total_ht, total_tva, total_ttc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      avoirId, i + 1, l.description, l.quantite, l.prix_unitaire_ht,
      l.tva_taux ?? 20, ht, tva, ht + tva
    )
  })
  if (stmts.length > 0) await db.batch(stmts)

  // Chaîne NF525 obligatoire pour les avoirs
  const hashNf525 = await enregistrerTransaction(db, {
    boutique_id:      boutiqueId,
    type_transaction: 'avoir',
    reference_id:     avoirId,
    reference_numero: numero,
    client_id:        facture.client_id,
    montant_ht:       total_ht,
    montant_tva:      total_tva,
    montant_ttc:      total_ttc,
    date_transaction: new Date().toISOString(),
    user_id:          userId,
  })

  await db.prepare('UPDATE avoirs SET hash_nf525 = ? WHERE id = ?')
    .bind(hashNf525, avoirId).run()

  await auditLog(db, {
    boutique_id: boutiqueId, user_id: userId,
    action:     'CREATE_AVOIR',
    entite_type: 'avoir', entite_id: avoirId,
    apres: { numero, facture_id: input.facture_id, type, motif: input.motif, total_ttc, hash_nf525: hashNf525 },
  })

  return { id: avoirId, numero, hash_nf525: hashNf525 }
}

// ─── Helpers NF525 pour conversion devis → facture ────────────────────────────

/**
 * Charge les données brutes d'un devis nécessaires à l'enregistrement NF525
 * lors de la conversion en facture (`PUT /api/devis/:id/convertir`).
 *
 * @param db      - Instance D1Database
 * @param devisId - ID du devis converti
 * @returns       Données devis (boutique_id, client_id, totaux) ou `null` si inexistant
 */
export async function getDevisPourNf525(
  db:      D1Database,
  devisId: number
): Promise<{
  boutique_id: number
  client_id:   number
  total_ht:    number
  total_tva:   number
  total_ttc:   number
} | null> {
  return db.prepare(
    'SELECT boutique_id, client_id, total_ht, total_tva, total_ttc FROM devis WHERE id = ?'
  ).bind(devisId).first()
}

/**
 * Écrit le hash NF525 calculé sur une facture.
 * Appelé après `convertirDevis()` + `enregistrerTransaction()`.
 *
 * @param db        - Instance D1Database
 * @param factureId - ID de la facture à mettre à jour
 * @param hash      - Hash NF525 hex 64 caractères
 */
export async function updateFactureHash(
  db:        D1Database,
  factureId: number,
  hash:      string
): Promise<void> {
  await db.prepare('UPDATE factures SET hash_nf525 = ? WHERE id = ?')
    .bind(hash, factureId).run()
}
