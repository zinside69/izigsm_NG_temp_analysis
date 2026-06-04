/**
 * services/fournisseursService.ts — Logique métier : Fournisseurs + Bons de commande + CUMP
 * Rôle architectural (P3 BFF Hono) : Model — tout le SQL ici, aucune route n'accède à D1 directement.
 * Sprint 2.5 — MOD-10 Achats/Approvisionnement
 */

import { parsePagination, auditLog } from '../lib/db'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Fournisseur {
  id:          number
  boutique_id: number
  nom:         string
  contact:     string | null
  email:       string | null
  telephone:   string | null
  adresse:     string | null
  site_web:    string | null
  notes:       string | null
  actif:       number
}

export interface BonCommande {
  id:              number
  boutique_id:     number
  fournisseur_id:  number
  numero:          string
  statut:          string
  statut_paiement: string
  date_commande:   string | null
  date_reception:  string | null
  montant_ht:      number
  montant_ttc:     number
  notes:           string | null
  ticket_id:       number | null
}

export interface LigneBonCommande {
  id:                  number
  bon_commande_id:     number
  produit_id:          number | null
  designation:         string
  reference:           string | null
  quantite_commandee:  number
  quantite_recue:      number
  prix_achat_ht:       number
  tva_taux:            number
}

// ─── Fournisseurs ─────────────────────────────────────────────────────────────

/**
 * Liste tous les fournisseurs actifs d'une boutique.
 * Inclut le nombre de bons de commande associés.
 */
export async function listFournisseurs(
  db: D1Database,
  boutiqueId: number,
  query: Record<string, string> = {}
) {
  const { limit, offset, page } = parsePagination(query)

  const conditions = ['f.boutique_id = ?', 'f.actif = 1']
  const bindings: any[] = [boutiqueId]

  if (query.search) {
    conditions.push('(f.nom LIKE ? OR f.email LIKE ? OR f.contact LIKE ?)')
    const s = `%${query.search}%`
    bindings.push(s, s, s)
  }

  const where = 'WHERE ' + conditions.join(' AND ')

  const total = await db.prepare(
    `SELECT COUNT(*) as cnt FROM fournisseurs f ${where}`
  ).bind(...bindings).first<{ cnt: number }>()

  const rows = await db.prepare(`
    SELECT f.*,
           COUNT(bc.id)  as nb_commandes,
           SUM(CASE WHEN bc.statut = 'awaiting_delivery' THEN 1 ELSE 0 END) as nb_en_attente
    FROM   fournisseurs f
    LEFT JOIN bons_commande bc ON bc.fournisseur_id = f.id
    ${where}
    GROUP BY f.id
    ORDER BY f.nom ASC
    LIMIT ? OFFSET ?
  `).bind(...bindings, limit, offset).all()

  return {
    data:       rows.results,
    pagination: { page, limit, total: total?.cnt ?? 0, pages: Math.ceil((total?.cnt ?? 0) / limit) }
  }
}

/**
 * Retourne un fournisseur par son id.
 */
export async function getFournisseur(
  db: D1Database, id: number
): Promise<Fournisseur | null> {
  const row = await db.prepare(
    `SELECT * FROM fournisseurs WHERE id = ? AND actif = 1`
  ).bind(id).first()
  return (row as Fournisseur) ?? null
}

/**
 * Crée un fournisseur.
 * @returns id du fournisseur créé
 */
export async function createFournisseur(
  db: D1Database,
  data: {
    boutique_id: number; nom: string; contact?: string; email?: string
    telephone?: string; adresse?: string; site_web?: string; notes?: string
  },
  userId: number
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO fournisseurs (boutique_id, nom, contact, email, telephone, adresse, site_web, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    data.boutique_id,
    data.nom.trim(),
    data.contact   ?? null,
    data.email     ?? null,
    data.telephone ?? null,
    data.adresse   ?? null,
    data.site_web  ?? null,
    data.notes     ?? null
  ).first<{ id: number }>()

  await auditLog(db, { boutique_id: data.boutique_id, user_id: userId, action: 'CREATE_FOURNISSEUR', entite_type: 'fournisseur', entite_id: result?.id })
  return result?.id ?? 0
}

/**
 * Met à jour un fournisseur.
 */
export async function updateFournisseur(
  db: D1Database,
  id: number,
  data: { nom?: string; contact?: string; email?: string; telephone?: string; adresse?: string; site_web?: string; notes?: string },
  userId: number
): Promise<void> {
  await db.prepare(`
    UPDATE fournisseurs SET
      nom       = COALESCE(?, nom),
      contact   = COALESCE(?, contact),
      email     = COALESCE(?, email),
      telephone = COALESCE(?, telephone),
      adresse   = COALESCE(?, adresse),
      site_web  = COALESCE(?, site_web),
      notes     = COALESCE(?, notes),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND actif = 1
  `).bind(
    data.nom?.trim() ?? null,
    data.contact     ?? null,
    data.email       ?? null,
    data.telephone   ?? null,
    data.adresse     ?? null,
    data.site_web    ?? null,
    data.notes       ?? null,
    id
  ).run()
  await auditLog(db, { user_id: userId, action: 'UPDATE_FOURNISSEUR', entite_type: 'fournisseur', entite_id: id })
}

/**
 * Désactive (soft delete) un fournisseur.
 */
export async function deleteFournisseur(
  db: D1Database, id: number, userId: number
): Promise<void> {
  await db.prepare(`UPDATE fournisseurs SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run()
  await auditLog(db, { user_id: userId, action: 'DELETE_FOURNISSEUR', entite_type: 'fournisseur', entite_id: id })
}

// ─── Bons de commande ─────────────────────────────────────────────────────────

/**
 * Liste les bons de commande d'une boutique avec filtres.
 */
export async function listBonsCommande(
  db: D1Database,
  boutiqueId: number,
  query: Record<string, string> = {}
) {
  const { limit, offset, page } = parsePagination(query)

  const conditions = ['bc.boutique_id = ?']
  const bindings: any[] = [boutiqueId]

  if (query.statut)          { conditions.push('bc.statut = ?');              bindings.push(query.statut) }
  if (query.fournisseur_id)  { conditions.push('bc.fournisseur_id = ?');      bindings.push(parseInt(query.fournisseur_id, 10)) }
  if (query.statut_paiement) { conditions.push('bc.statut_paiement = ?');     bindings.push(query.statut_paiement) }
  if (query.search)          {
    conditions.push('(bc.numero LIKE ? OR f.nom LIKE ?)')
    const s = `%${query.search}%`
    bindings.push(s, s)
  }

  const where = 'WHERE ' + conditions.join(' AND ')

  const total = await db.prepare(`
    SELECT COUNT(*) as cnt
    FROM   bons_commande bc
    LEFT JOIN fournisseurs f ON f.id = bc.fournisseur_id
    ${where}
  `).bind(...bindings).first<{ cnt: number }>()

  const rows = await db.prepare(`
    SELECT bc.*,
           f.nom      as fournisseur_nom,
           f.email    as fournisseur_email,
           f.telephone as fournisseur_telephone,
           COUNT(l.id) as nb_lignes,
           SUM(l.quantite_commandee) as total_articles_commandes,
           SUM(l.quantite_recue)     as total_articles_recus
    FROM   bons_commande bc
    LEFT JOIN fournisseurs f ON f.id = bc.fournisseur_id
    LEFT JOIN lignes_bon_commande l ON l.bon_commande_id = bc.id
    ${where}
    GROUP BY bc.id
    ORDER BY bc.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...bindings, limit, offset).all()

  return {
    data:       rows.results,
    pagination: { page, limit, total: total?.cnt ?? 0, pages: Math.ceil((total?.cnt ?? 0) / limit) }
  }
}

/**
 * Retourne un bon de commande complet avec ses lignes.
 */
export async function getBonCommande(
  db: D1Database, id: number
): Promise<{ bc: BonCommande; lignes: LigneBonCommande[] } | null> {
  const bc = await db.prepare(`
    SELECT bc.*, f.nom as fournisseur_nom, f.email as fournisseur_email, f.telephone as fournisseur_telephone
    FROM   bons_commande bc
    LEFT JOIN fournisseurs f ON f.id = bc.fournisseur_id
    WHERE  bc.id = ?
  `).bind(id).first()

  if (!bc) return null

  const lignes = await db.prepare(`
    SELECT l.*, p.nom as produit_nom, p.stock_actuel, p.prix_achat_cump
    FROM   lignes_bon_commande l
    LEFT JOIN produits p ON p.id = l.produit_id
    WHERE  l.bon_commande_id = ?
    ORDER BY l.id ASC
  `).bind(id).all()

  return { bc: bc as BonCommande, lignes: lignes.results as LigneBonCommande[] }
}

/**
 * Crée un bon de commande avec ses lignes.
 * Utilise nextNumero pour la numérotation BC-AAAA-XXXXX.
 * @returns id du bon créé
 */
export async function createBonCommande(
  db: D1Database,
  data: {
    boutique_id: number; fournisseur_id: number; notes?: string
    date_livraison_prevue?: string; ticket_id?: number
    lignes: Array<{ produit_id?: number; designation: string; reference?: string; quantite_commandee: number; prix_achat_ht: number; tva_taux?: number }>
  },
  userId: number
): Promise<number> {
  // Générer le numéro séquentiel BC-AAAA-XXXXX
  const annee = new Date().getFullYear()
  const seqRow = await db.prepare(`
    SELECT COALESCE(MAX(CAST(SUBSTR(numero, -5) AS INTEGER)), 0) + 1 AS next
    FROM   bons_commande
    WHERE  boutique_id = ? AND numero LIKE 'BC-${annee}-%'
  `).bind(data.boutique_id).first<{ next: number }>()

  const seq    = seqRow?.next ?? 1
  const numero = `BC-${annee}-${String(seq).padStart(5, '0')}`

  // Calculer les totaux depuis les lignes
  const montantHt  = data.lignes.reduce((sum, l) => sum + l.quantite_commandee * l.prix_achat_ht, 0)
  const montantTtc = data.lignes.reduce((sum, l) => {
    const tva = l.tva_taux ?? 20
    return sum + l.quantite_commandee * l.prix_achat_ht * (1 + tva / 100)
  }, 0)

  // Insérer le bon
  const bc = await db.prepare(`
    INSERT INTO bons_commande
      (boutique_id, fournisseur_id, numero, statut, statut_paiement, date_commande,
       date_livraison_prevue, montant_ht, montant_ttc, notes, ticket_id, user_id)
    VALUES (?, ?, ?, 'draft', 'pending', CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    data.boutique_id,
    data.fournisseur_id,
    numero,
    data.date_livraison_prevue ?? null,
    Math.round(montantHt  * 100) / 100,
    Math.round(montantTtc * 100) / 100,
    data.notes    ?? null,
    data.ticket_id ?? null,
    userId
  ).first<{ id: number }>()

  if (!bc?.id) throw new Error('Échec création bon de commande.')

  // Insérer les lignes
  for (const ligne of data.lignes) {
    await db.prepare(`
      INSERT INTO lignes_bon_commande
        (bon_commande_id, produit_id, designation, reference, quantite_commandee, prix_achat_ht, tva_taux)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      bc.id,
      ligne.produit_id   ?? null,
      ligne.designation.trim(),
      ligne.reference    ?? null,
      ligne.quantite_commandee,
      ligne.prix_achat_ht,
      ligne.tva_taux     ?? 20
    ).run()
  }

  await auditLog(db, { boutique_id: data.boutique_id, user_id: userId, action: 'CREATE_BON_COMMANDE', entite_type: 'bon_commande', entite_id: bc.id })
  return bc.id
}

/**
 * Met à jour le statut d'un bon de commande.
 * Statuts autorisés : draft → awaiting_delivery → received | cancelled
 */
export async function updateStatutBonCommande(
  db: D1Database,
  id: number,
  statut: string,
  userId: number
): Promise<void> {
  const statuts_valides = ['draft', 'awaiting_delivery', 'received', 'cancelled']
  if (!statuts_valides.includes(statut)) throw new Error(`Statut invalide : ${statut}`)

  await db.prepare(`
    UPDATE bons_commande
    SET statut = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(statut, id).run()

  await auditLog(db, { user_id: userId, action: `BC_STATUT_${statut.toUpperCase()}`, entite_type: 'bon_commande', entite_id: id })
}

/**
 * Réceptionne un bon de commande :
 * - Met à jour quantite_recue sur chaque ligne
 * - Met à jour le stock de chaque produit (+qty)
 * - Recalcule le CUMP de chaque produit
 * - Passe le bon en statut 'received'
 * - Crée les mouvements de stock de type 'reception_commande'
 *
 * Formule CUMP : (stock_actuel × prix_achat_cump + qty_recue × prix_achat_ht) / (stock_actuel + qty_recue)
 */
export async function receptionnerBonCommande(
  db: D1Database,
  id: number,
  lignesRecues: Array<{ ligne_id: number; quantite_recue: number }>,
  userId: number
): Promise<{ nb_produits_mis_a_jour: number }> {
  // Vérifier que le bon existe et n'est pas déjà receptionné
  const bc = await db.prepare(
    `SELECT * FROM bons_commande WHERE id = ?`
  ).bind(id).first<BonCommande & { boutique_id: number }>()

  if (!bc) throw new Error('Bon de commande introuvable.')
  if (bc.statut === 'received') throw new Error('Bon de commande déjà réceptionné.')
  if (bc.statut === 'cancelled') throw new Error('Bon de commande annulé.')

  let nbMaj = 0

  for (const { ligne_id, quantite_recue } of lignesRecues) {
    if (quantite_recue <= 0) continue

    // Récupérer la ligne
    const ligne = await db.prepare(
      `SELECT * FROM lignes_bon_commande WHERE id = ? AND bon_commande_id = ?`
    ).bind(ligne_id, id).first<LigneBonCommande>()

    if (!ligne) continue

    // Mettre à jour quantite_recue sur la ligne
    await db.prepare(`
      UPDATE lignes_bon_commande SET quantite_recue = quantite_recue + ? WHERE id = ?
    `).bind(quantite_recue, ligne_id).run()

    // Si la ligne a un produit_id : MAJ stock + CUMP
    if (ligne.produit_id) {
      const produit = await db.prepare(
        `SELECT id, stock_actuel, prix_achat_cump, boutique_id FROM produits WHERE id = ?`
      ).bind(ligne.produit_id).first<{ id: number; stock_actuel: number; prix_achat_cump: number; boutique_id: number }>()

      if (produit) {
        const stockAvant   = produit.stock_actuel
        const cumpAvant    = produit.prix_achat_cump || ligne.prix_achat_ht
        const stockApres   = stockAvant + quantite_recue

        // Calcul CUMP : (ancien_stock × ancien_cump + qty × prix) / total
        const nouveauCump  = stockAvant === 0
          ? ligne.prix_achat_ht
          : Math.round(((stockAvant * cumpAvant + quantite_recue * ligne.prix_achat_ht) / stockApres) * 100) / 100

        // Mettre à jour stock + CUMP
        await db.prepare(`
          UPDATE produits
          SET stock_actuel = ?, prix_achat_cump = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(stockApres, nouveauCump, produit.id).run()

        // Enregistrer le mouvement de stock
        await db.prepare(`
          INSERT INTO mouvements_stock
            (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, user_id, motif)
          VALUES (?, ?, 'reception_commande', ?, ?, ?, ?, ?)
        `).bind(
          produit.id,
          produit.boutique_id,
          quantite_recue,
          stockAvant,
          stockApres,
          userId,
          `Réception BC ${bc.numero}`
        ).run()

        nbMaj++
      }
    }
  }

  // Passer le bon en 'received'
  await db.prepare(`
    UPDATE bons_commande
    SET statut = 'received', date_reception = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(id).run()

  await auditLog(db, { user_id: userId, action: 'RECEPTION_BON_COMMANDE', entite_type: 'bon_commande', entite_id: id })
  return { nb_produits_mis_a_jour: nbMaj }
}

/**
 * Retourne les KPIs fournisseurs / commandes d'une boutique.
 */
export async function getKpisFournisseurs(
  db: D1Database, boutiqueId: number
) {
  const [kpis, aCommander] = await Promise.all([
    db.prepare(`
      SELECT
        COUNT(DISTINCT f.id)                                              as nb_fournisseurs,
        COUNT(bc.id)                                                      as nb_commandes_total,
        SUM(CASE WHEN bc.statut = 'awaiting_delivery' THEN 1 ELSE 0 END) as nb_en_attente,
        SUM(CASE WHEN bc.statut = 'received' THEN bc.montant_ht ELSE 0 END) as montant_achats_ht,
        SUM(CASE WHEN bc.statut_paiement = 'pending' AND bc.statut != 'cancelled' THEN bc.montant_ttc ELSE 0 END) as montant_impaye_ttc
      FROM fournisseurs f
      LEFT JOIN bons_commande bc ON bc.fournisseur_id = f.id
      WHERE f.boutique_id = ? AND f.actif = 1
    `).bind(boutiqueId).first(),

    // Produits en stock bas = besoins potentiels à commander
    db.prepare(`
      SELECT COUNT(*) as nb_produits_a_commander
      FROM   produits
      WHERE  boutique_id = ? AND actif = 1 AND stock_actuel <= stock_minimum
    `).bind(boutiqueId).first<{ nb_produits_a_commander: number }>()
  ])

  return { ...kpis, nb_produits_a_commander: aCommander?.nb_produits_a_commander ?? 0 }
}

/**
 * Vue "À commander" : produits avec stock_actuel ≤ stock_minimum.
 * Enrichit avec le fournisseur principal si disponible.
 */
export async function getProduitsACommander(
  db: D1Database, boutiqueId: number
) {
  const rows = await db.prepare(`
    SELECT p.id, p.nom, p.sku, p.marque, p.stock_actuel, p.stock_minimum,
           p.prix_achat_ht, p.prix_achat_cump,
           f.id   as fournisseur_id,
           f.nom  as fournisseur_nom,
           f.email as fournisseur_email,
           (p.stock_minimum - p.stock_actuel + 1) as quantite_suggere,
           CASE WHEN p.stock_actuel = 0 THEN 'rupture' ELSE 'bas' END as alerte
    FROM   produits p
    LEFT JOIN fournisseurs f ON f.id = p.fournisseur_id AND f.actif = 1
    WHERE  p.boutique_id = ? AND p.actif = 1 AND p.stock_actuel <= p.stock_minimum
    ORDER BY p.stock_actuel ASC, p.nom ASC
  `).bind(boutiqueId).all()

  return rows.results
}
