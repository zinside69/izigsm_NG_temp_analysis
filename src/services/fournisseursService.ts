/**
 * @module fournisseursService
 * @description Model P1 : Fournisseurs + Bons de commande + gestion CUMP stock.
 *
 * Rôle architectural (P1 MVC) : Model exclusif — tout le SQL ici.
 * Les routes `src/routes/fournisseurs.ts` délèguent sans aucun `.prepare()`.
 *
 * Fonctionnalités :
 *  - CRUD fournisseurs (soft delete, pagination, recherche)
 *  - CRUD bons de commande avec numérotation BC-AAAA-XXXXX
 *  - Réception partielle/totale : mise à jour stock + recalcul CUMP
 *  - Vue "à commander" : produits sous le seuil minimum
 *  - KPIs : nb commandes, montants, impayés, produits en rupture
 *
 * Algorithme CUMP (Coût Unitaire Moyen Pondéré) :
 *   CUMP_nouveau = (stock_avant × CUMP_avant + qty_reçue × prix_achat) / stock_après
 *   Si stock_avant = 0 : CUMP_nouveau = prix_achat (pas de pondération)
 *   Le CUMP est stocké dans `produits.prix_achat_cump`.
 *
 * Numérotation bons de commande :
 *   Format : BC-AAAA-NNNNN (ex: BC-2026-00001)
 *   Calculée par MAX(seq) sur la table (pas via nextNumero — différent du préfixe standard).
 *
 * Sprint 2.5 — MOD-10 Achats/Approvisionnement
 */

import { parsePagination, auditLog } from '../lib/db'
import { chiffrer, dechiffrer } from '../lib/chiffrement'
import type { Database } from '../ports/database'

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
  /** Plateforme d'API branchée (migration 0045) : 'mobilax' ou null. */
  api_plateforme: string | null
}

/**
 * Ne garde que les champs publics d'une ligne `fournisseurs`, quels que soient ceux
 * portés par la ligne source. Filet en plus de la sélection SQL explicite (jamais
 * `SELECT *`) : même si une ligne venait à porter `api_key_chiffree` — colonne existante
 * mais jamais destinée à sortir de ce service — l'objet renvoyé à un appelant ne l'aura
 * jamais. Ticket 01, bugs.md § email_api_key : cette classe de défaut ne doit plus se
 * reproduire ailleurs dans ce dépôt.
 */
function versFournisseurPublic(ligne: any): Fournisseur {
  const { id, boutique_id, nom, contact, email, telephone, adresse, site_web, notes, actif,
          api_plateforme = null } = ligne
  return { id, boutique_id, nom, contact, email, telephone, adresse, site_web, notes, actif,
           api_plateforme }
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
  date_paiement?:  string | null   // migration 0044 — posée par marquerBonCommandeRegle()
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
 * Liste paginée des fournisseurs actifs d'une boutique.
 * Inclut le nombre de bons de commande associés et le nombre en attente de livraison.
 *
 * @param db          Port Database
 * @param boutiqueId  Identifiant de la boutique
 * @param query       Filtres : `search` (nom/email/contact), `page`, `limit`
 * @returns           `{ data: Fournisseur[], pagination }`
 */
export async function listFournisseurs(
  db: Database,
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

  const total = await db.get<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM fournisseurs f ${where}`,
    bindings
  )

  // ⚠ Colonnes explicites, jamais `f.*` : `api_key_chiffree` ne doit jamais pouvoir
  // remonter par accident dans une réponse API (ticket 01, bugs.md § email_api_key).
  const rows = await db.all<any>(`
    SELECT f.id, f.boutique_id, f.nom, f.contact, f.email, f.telephone, f.adresse,
           f.site_web, f.notes, f.actif, f.api_plateforme,
           COUNT(bc.id)  as nb_commandes,
           SUM(CASE WHEN bc.statut = 'awaiting_delivery' THEN 1 ELSE 0 END) as nb_en_attente
    FROM   fournisseurs f
    LEFT JOIN bons_commande bc ON bc.fournisseur_id = f.id
    ${where}
    GROUP BY f.id
    ORDER BY f.nom ASC
    LIMIT ? OFFSET ?
  `, [...bindings, limit, offset])

  return {
    // Mapping explicite (pas un ...rows brut) : mêmes garanties que versFournisseurPublic,
    // en gardant les deux agrégats calculés par la requête.
    data: rows.map((r: any) => ({
      ...versFournisseurPublic(r),
      nb_commandes:   r.nb_commandes,
      nb_en_attente:  r.nb_en_attente,
    })),
    pagination: { page, limit, total: total?.cnt ?? 0, pages: Math.ceil((total?.cnt ?? 0) / limit) }
  }
}

/**
 * Récupère un fournisseur par son identifiant.
 *
 * @param db  Port Database
 * @param id  Identifiant du fournisseur
 * @returns   `Fournisseur` ou `null` si introuvable / soft-deleted
 */
export async function getFournisseur(
  db: Database, id: number
): Promise<Fournisseur | null> {
  // ⚠ Colonnes explicites, jamais `SELECT *` : `api_key_chiffree` ne doit jamais pouvoir
  // remonter par accident dans une réponse API (ticket 01, bugs.md § email_api_key).
  const row = await db.get<any>(
    `SELECT id, boutique_id, nom, contact, email, telephone, adresse, site_web, notes, actif, api_plateforme
     FROM fournisseurs WHERE id = ? AND actif = 1`,
    [id]
  )
  return row ? versFournisseurPublic(row) : null
}

/**
 * Lit et déchiffre la clé API d'un fournisseur, pour un usage serveur uniquement.
 *
 * **⚠ N'est exposée par AUCUNE route.** C'est le seul point du dépôt qui relit une clé
 * fournisseur en clair — réservé aux services qui doivent appeler l'API du fournisseur au
 * nom de la boutique (ex. le service Mobilax, ticket 03). Ne jamais transmettre son
 * résultat dans une réponse HTTP.
 *
 * @param db             Port Database
 * @param fournisseurId  Identifiant du fournisseur
 * @param cleChiffrement Clé de chiffrement (secret de plateforme)
 * @returns              La clé en clair, ou `null` si le fournisseur n'en a pas / n'existe pas
 */
export async function getApiKeyDechiffree(
  db: Database, fournisseurId: number, boutiqueId: number, cleChiffrement: string
): Promise<string | null> {
  // La vérification d'appartenance est ICI, dans la requête — pas déléguée au futur
  // appelant (ticket 03, service Mobilax). Ce dépôt a déjà payé le prix d'une isolation
  // tenue par un filtre en amont supposé suffisant (CLAUDE.md § isolation multi-tenant).
  const row = await db.get<{ api_key_chiffree: string | null }>(
    `SELECT api_key_chiffree FROM fournisseurs WHERE id = ? AND boutique_id = ? AND actif = 1`,
    [fournisseurId, boutiqueId]
  )
  if (!row?.api_key_chiffree) return null
  return dechiffrer(row.api_key_chiffree, cleChiffrement)
}

/**
 * Trouve la fiche fournisseur d'une boutique marquée pour une plateforme d'API (migration
 * 0045, ex. 'mobilax'), et dit si elle porte une clé — sans jamais la lire.
 *
 * Renvoie au plus 2 lignes : l'appelant distingue ainsi « aucune fiche », « une fiche » et
 * « plusieurs fiches » (ambigu, à signaler plutôt qu'à trancher au hasard).
 *
 * @param db          Port Database
 * @param boutiqueId  Boutique appelante — filtre d'isolation porté par la requête elle-même
 * @param plateforme  Valeur de `api_plateforme` recherchée
 * @returns           `[{ id, nom, a_cle }]`, `a_cle` à 1 si une clé chiffrée est enregistrée
 */
export async function trouverFournisseurApi(
  db: Database, boutiqueId: number, plateforme: string
): Promise<Array<{ id: number; nom: string; a_cle: number }>> {
  return db.all<{ id: number; nom: string; a_cle: number }>(
    `SELECT id, nom, (api_key_chiffree IS NOT NULL) AS a_cle
     FROM fournisseurs
     WHERE boutique_id = ? AND api_plateforme = ? AND actif = 1
     ORDER BY id LIMIT 2`,
    [boutiqueId, plateforme]
  )
}

/**
 * Crée un nouveau fournisseur et trace dans l'audit log.
 *
 * @param db      Binding D1 Cloudflare
 * @param data    Données du fournisseur (nom obligatoire, reste optionnel)
 * @param userId  Identifiant de l'utilisateur (pour audit log)
 * @returns       Identifiant du fournisseur créé
 */
export async function createFournisseur(
  db: D1Database,
  data: {
    boutique_id: number; nom: string; contact?: string; email?: string
    telephone?: string; adresse?: string; site_web?: string; notes?: string
    /** Clé API en clair (ex. Mobilax) — chiffrée avant stockage, jamais persistée telle quelle. */
    api_key?: string
    /** Plateforme d'API (migration 0045) — 'mobilax' ou null, validée par `validateFournisseur()`. */
    api_plateforme?: string | null
  },
  userId: number,
  /** Clé de chiffrement (secret de plateforme). Requise seulement si `data.api_key` est fourni. */
  cleChiffrement?: string
): Promise<number> {
  if (data.api_key && !cleChiffrement)
    throw new Error('cleChiffrement requise pour stocker api_key.')
  const apiKeyChiffree = data.api_key
    ? await chiffrer(data.api_key, cleChiffrement!)
    : null

  const result = await db.prepare(`
    INSERT INTO fournisseurs (boutique_id, nom, contact, email, telephone, adresse, site_web, notes, api_key_chiffree, api_plateforme)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    data.boutique_id,
    data.nom.trim(),
    data.contact   ?? null,
    data.email     ?? null,
    data.telephone ?? null,
    data.adresse   ?? null,
    data.site_web  ?? null,
    data.notes     ?? null,
    apiKeyChiffree,
    data.api_plateforme ?? null
  ).first<{ id: number }>()

  await auditLog(db, { boutique_id: data.boutique_id, user_id: userId, action: 'CREATE_FOURNISSEUR', entite_type: 'fournisseur', entite_id: result?.id })
  return result?.id ?? 0
}

/**
 * Met à jour les champs d'un fournisseur (PATCH partiel via COALESCE).
 * Seuls les champs fournis sont modifiés.
 *
 * @param db      Binding D1 Cloudflare
 * @param id      Identifiant du fournisseur
 * @param data    Champs à mettre à jour (tous optionnels)
 * @param userId  Identifiant de l'utilisateur (pour audit log)
 * @returns       void
 */
export async function updateFournisseur(
  db: D1Database,
  id: number,
  data: {
    nom?: string; contact?: string; email?: string; telephone?: string; adresse?: string
    site_web?: string; notes?: string
    /** Nouvelle clé API en clair — chiffrée avant persistance. Absente = clé inchangée. */
    api_key?: string
    /**
     * Plateforme d'API (migration 0045). Trois états, que COALESCE ne sait pas tenir (il ne
     * peut pas remettre NULL) : absent = inchangé · null = marquage retiré · 'mobilax' = posé.
     */
    api_plateforme?: string | null
  },
  userId: number,
  /** Clé de chiffrement (secret de plateforme). Requise seulement si `data.api_key` est fourni. */
  cleChiffrement?: string
): Promise<void> {
  if (data.api_key && !cleChiffrement)
    throw new Error('cleChiffrement requise pour stocker api_key.')
  const apiKeyChiffree = data.api_key
    ? await chiffrer(data.api_key, cleChiffrement!)
    : null
  const plateformeFournie = data.api_plateforme !== undefined ? 1 : 0

  await db.prepare(`
    UPDATE fournisseurs SET
      nom       = COALESCE(?, nom),
      contact   = COALESCE(?, contact),
      email     = COALESCE(?, email),
      telephone = COALESCE(?, telephone),
      adresse   = COALESCE(?, adresse),
      site_web  = COALESCE(?, site_web),
      notes     = COALESCE(?, notes),
      api_key_chiffree = COALESCE(?, api_key_chiffree),
      api_plateforme = CASE WHEN ? = 1 THEN ? ELSE api_plateforme END,
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
    apiKeyChiffree,
    plateformeFournie,
    data.api_plateforme ?? null,
    id
  ).run()
  await auditLog(db, { user_id: userId, action: 'UPDATE_FOURNISSEUR', entite_type: 'fournisseur', entite_id: id })
}

/**
 * Désactive un fournisseur (soft delete — `actif = 0`).
 * Le fournisseur n'apparaît plus dans les listes mais les données sont conservées.
 *
 * @param db      Binding D1 Cloudflare
 * @param id      Identifiant du fournisseur
 * @param userId  Identifiant de l'utilisateur (pour audit log)
 * @returns       void
 */
export async function deleteFournisseur(
  db: D1Database, id: number, userId: number
): Promise<void> {
  await db.prepare(`UPDATE fournisseurs SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run()
  await auditLog(db, { user_id: userId, action: 'DELETE_FOURNISSEUR', entite_type: 'fournisseur', entite_id: id })
}

// ─── Bons de commande ─────────────────────────────────────────────────────────

/**
 * Liste paginée des bons de commande avec filtres et enrichissement fournisseur.
 *
 * @param db          Port Database
 * @param boutiqueId  Identifiant de la boutique
 * @param query       Filtres : `statut`, `fournisseur_id`, `statut_paiement`, `search`, `page`, `limit`
 * @returns           `{ data: BonCommande[], pagination }` enrichi avec nb_lignes et totaux articles
 */
export async function listBonsCommande(
  db: Database,
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

  const total = await db.get<{ cnt: number }>(`
    SELECT COUNT(*) as cnt
    FROM   bons_commande bc
    LEFT JOIN fournisseurs f ON f.id = bc.fournisseur_id
    ${where}
  `, bindings)

  const rows = await db.all<any>(`
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
  `, [...bindings, limit, offset])

  return {
    data:       rows,
    pagination: { page, limit, total: total?.cnt ?? 0, pages: Math.ceil((total?.cnt ?? 0) / limit) }
  }
}

/**
 * Récupère un bon de commande complet avec ses lignes de détail.
 * Joint les infos du fournisseur et les stocks/CUMP des produits liés.
 *
 * @param db  Port Database
 * @param id  Identifiant du bon de commande
 * @returns   `{ bc: BonCommande, lignes: LigneBonCommande[] }` ou `null` si introuvable
 */
export async function getBonCommande(
  db: Database, id: number
): Promise<{ bc: BonCommande; lignes: LigneBonCommande[] } | null> {
  const bc = await db.get<BonCommande>(`
    SELECT bc.*, f.nom as fournisseur_nom, f.email as fournisseur_email, f.telephone as fournisseur_telephone
    FROM   bons_commande bc
    LEFT JOIN fournisseurs f ON f.id = bc.fournisseur_id
    WHERE  bc.id = ?
  `, [id])

  if (!bc) return null

  const lignes = await db.all<LigneBonCommande>(`
    SELECT l.*, p.nom as produit_nom, p.stock_actuel, p.prix_achat_cump
    FROM   lignes_bon_commande l
    LEFT JOIN produits p ON p.id = l.produit_id
    WHERE  l.bon_commande_id = ?
    ORDER BY l.id ASC
  `, [id])

  return { bc, lignes }
}

/**
 * Retourne uniquement le `boutique_id` d'un bon de commande.
 * Utilisé par la garde d'isolation de `PATCH /bons-commande/:id/statut`
 * (`routes/fournisseurs.ts`), sur le modèle de `getTicketBoutiqueId()`
 * (`services/ticketService.ts`) — évite de charger lignes et fournisseur
 * (`getBonCommande()`) juste pour vérifier l'appartenance.
 *
 * @param db  Port Database
 * @param id  Identifiant du bon de commande
 * @returns   `{ boutique_id }` ou `null` si introuvable
 */
export async function getBonCommandeBoutiqueId(
  db: Database, id: number
): Promise<{ boutique_id: number } | null> {
  return db.get<{ boutique_id: number }>('SELECT boutique_id FROM bons_commande WHERE id = ?', [id])
}

/**
 * Crée un bon de commande avec ses lignes d'articles.
 *
 * Numérotation : `BC-AAAA-NNNNN` calculée par `MAX(seq)` sur la table
 * (différente de `nextNumero()` qui gère d'autres préfixes).
 * Statut initial : `draft` / paiement : `pending`.
 * Calcule automatiquement `montant_ht` et `montant_ttc` depuis les lignes.
 *
 * Isolation multi-tenant : chaque `produit_id` de ligne est vérifié contre
 * `data.boutique_id` AVANT toute écriture (voir bloc de garde ci-dessous).
 *
 * @param db      Binding D1 Cloudflare
 * @param data    Données du bon (fournisseur, lignes, boutique_id, notes, ticket_id optionnel)
 * @param userId  Identifiant de l'utilisateur (pour audit log)
 * @returns       Identifiant du bon de commande créé
 * @throws        Error si l'insertion du bon échoue, ou si une ligne référence un
 *                produit qui n'appartient pas à `data.boutique_id`
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
  // ── Isolation multi-tenant : les produits référencés doivent être ceux du bon ──
  // Un `produit_id` étranger accepté ici devient, à la réception, une écriture sur
  // le `stock_actuel` et le `prix_achat_cump` d'un concurrent (receptionnerBonCommande()
  // ne compare pas les boutiques avant ce chantier). La garde est ici, en amont de
  // toute écriture : ni le numéro de séquence ni le bon ne sont consommés si une
  // ligne est illégitime.
  //
  // Rejet explicite plutôt qu'ignorance silencieuse : une ligne pointant un produit
  // d'une autre boutique n'a aucun usage métier légitime (on ne commande pas le stock
  // d'un concurrent), et l'ignorer produirait un bon dont la réception ne bougerait
  // rien, sans que l'utilisateur comprenne pourquoi. Vérifié en base locale avant de
  // trancher : 0 ligne de bon de commande référence un produit d'une autre boutique
  // (69 bons, 0 ligne avec produit_id renseigné) — ce rejet ne casse aucun usage existant.
  const produitIds = [...new Set(
    data.lignes.map(l => l.produit_id).filter((v): v is number => typeof v === 'number')
  )]
  for (const produitId of produitIds) {
    const produit = await db.prepare(
      `SELECT boutique_id FROM produits WHERE id = ?`
    ).bind(produitId).first<{ boutique_id: number }>()

    if (!produit || produit.boutique_id !== data.boutique_id)
      throw new Error(`Produit ${produitId} introuvable dans cette boutique.`)
  }

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
 *
 * Flux de statuts : `draft` → `awaiting_delivery` → `received` | `cancelled`
 * La validation du statut est effectuée ici (liste blanche).
 *
 * @param db      Binding D1 Cloudflare
 * @param id      Identifiant du bon de commande
 * @param statut  Nouveau statut (parmi draft | awaiting_delivery | received | cancelled)
 * @param userId  Identifiant de l'utilisateur (pour audit log)
 * @returns       void
 * @throws        Error si statut invalide
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
 * Marque un bon de commande comme réglé au fournisseur.
 *
 * Seul chemin du dépôt qui fait passer `statut_paiement` à `paid` — avant lui, la valeur
 * restait `pending` à vie et « Impayés fournisseurs » ne pouvait que grossir.
 *
 * Refus (aucune écriture) :
 *  - `draft` : un brouillon n'a pas été passé au fournisseur, il n'y a rien à régler ;
 *  - `cancelled` : rien à régler ;
 *  - déjà `paid` : la date de règlement d'origine n'est pas réécrite.
 * `awaiting_delivery` est accepté : un règlement à la commande (prépaiement) est légitime.
 *
 * Isolation multi-tenant : assurée par la route (`assertBoutiqueOwnership` sur le bon),
 * même patron que `updateStatutBonCommande()`.
 *
 * @param db      Binding D1 Cloudflare (auditLog() reste sur D1Database)
 * @param id      Identifiant du bon de commande
 * @param userId  Identifiant de l'utilisateur (pour audit log)
 * @throws        Error si bon introuvable, brouillon, annulé ou déjà réglé
 */
export async function marquerBonCommandeRegle(
  db: D1Database,
  id: number,
  userId: number
): Promise<void> {
  const bc = await db.prepare(
    `SELECT id, statut, statut_paiement FROM bons_commande WHERE id = ?`
  ).bind(id).first<{ id: number; statut: string; statut_paiement: string }>()

  if (!bc) throw new Error('Bon de commande introuvable.')
  if (bc.statut === 'draft')     throw new Error('Un brouillon n\'engage rien auprès du fournisseur : rien à régler.')
  if (bc.statut === 'cancelled') throw new Error('Bon de commande annulé : rien à régler.')
  if (bc.statut_paiement === 'paid') throw new Error('Bon de commande déjà réglé.')

  await db.prepare(`
    UPDATE bons_commande
    SET statut_paiement = 'paid', date_paiement = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(id).run()

  await auditLog(db, { user_id: userId, action: 'BC_REGLE', entite_type: 'bon_commande', entite_id: id })
}

/**
 * Réceptionne un bon de commande : met à jour le stock et recalcule le CUMP.
 *
 * Pour chaque ligne reçue avec un `produit_id` :
 *  1. Met à jour `quantite_recue` sur la ligne du bon
 *  2. Incrémente `stock_actuel` du produit
 *  3. Recalcule `prix_achat_cump` (Coût Unitaire Moyen Pondéré) :
 *     `CUMP = (stock_avant × CUMP_avant + qty × prix) / stock_après`
 *     Si `stock_avant = 0` : `CUMP = prix_achat_ht` (pas de pondération)
 *  4. Crée un mouvement de stock `reception_commande` pour la traçabilité
 *  5. Passe le bon en statut `received`
 *
 * Isolation multi-tenant : seuls les produits de la boutique du bon sont mutés
 * (filtre `boutique_id` sur le SELECT produit, voir commentaire dans la boucle).
 *
 * @param db           Binding D1 Cloudflare
 * @param id           Identifiant du bon de commande
 * @param lignesRecues Liste `[{ ligne_id, quantite_recue }]` — quantité ≤ 0 ignorée
 * @param userId       Identifiant de l'utilisateur (pour audit log)
 * @returns            `{ nb_produits_mis_a_jour }` — nombre de produits dont le stock a changé
 * @throws             Error si bon introuvable, déjà reçu, ou annulé
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
      // Isolation multi-tenant : le filtre `boutique_id` porte la garde de la MUTATION.
      // La garde de route (assertBoutiqueOwnership sur le bon) ne couvre que le bon —
      // les produits mutés ici sont désignés par les lignes, et un produit_id étranger
      // ferait écrire sur le stock et le CUMP d'un concurrent. createBonCommande()
      // rejette désormais ces lignes à la création ; ce filtre est la seconde barrière,
      // qui couvre aussi les bons créés avant ce correctif.
      //
      // Ignorer (produit non trouvé → ligne sautée) plutôt que lever : un bon
      // historiquement hétérogène resterait sinon irréceptionnable à vie. La ligne du
      // bon reste incrémentée (elle appartient bien à l'appelant), seul le produit
      // étranger n'est pas touché et n'est pas compté dans nb_produits_mis_a_jour.
      const produit = await db.prepare(
        `SELECT id, stock_actuel, prix_achat_cump, boutique_id FROM produits WHERE id = ? AND boutique_id = ?`
      ).bind(ligne.produit_id, bc.boutique_id).first<{ id: number; stock_actuel: number; prix_achat_cump: number; boutique_id: number }>()

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
 * Calcule les KPIs fournisseurs et achats pour le tableau de bord.
 * Exécute 2 requêtes en parallèle via `Promise.all`.
 *
 * @param db          Port Database
 * @param boutiqueId  Identifiant de la boutique
 * @returns           `{ nb_fournisseurs, nb_commandes_total, nb_en_attente,
 *                    montant_achats_ht, montant_impaye_ttc, nb_produits_a_commander }`
 */
export async function getKpisFournisseurs(
  db: Database, boutiqueId: number
) {
  const [kpis, aCommander] = await Promise.all([
    // montant_impaye_ttc = marchandise reçue et pas encore réglée (décision du 2026-09-11) :
    // un brouillon ou un bon envoyé non reçu ne doit rien au fournisseur.
    db.get<any>(`
      SELECT
        COUNT(DISTINCT f.id)                                              as nb_fournisseurs,
        COUNT(bc.id)                                                      as nb_commandes_total,
        SUM(CASE WHEN bc.statut = 'awaiting_delivery' THEN 1 ELSE 0 END) as nb_en_attente,
        SUM(CASE WHEN bc.statut = 'received' THEN bc.montant_ht ELSE 0 END) as montant_achats_ht,
        SUM(CASE WHEN bc.statut = 'received' AND bc.statut_paiement != 'paid' THEN bc.montant_ttc ELSE 0 END) as montant_impaye_ttc
      FROM fournisseurs f
      LEFT JOIN bons_commande bc ON bc.fournisseur_id = f.id
      WHERE f.boutique_id = ? AND f.actif = 1
    `, [boutiqueId]),

    // Produits en stock bas = besoins potentiels à commander
    db.get<{ nb_produits_a_commander: number }>(`
      SELECT COUNT(*) as nb_produits_a_commander
      FROM   produits
      WHERE  boutique_id = ? AND actif = 1 AND stock_actuel <= stock_minimum
    `, [boutiqueId])
  ])

  return { ...kpis, nb_produits_a_commander: aCommander?.nb_produits_a_commander ?? 0 }
}

/**
 * Retourne les produits dont le stock est inférieur ou égal au seuil minimum.
 * Enrichit chaque produit avec son fournisseur principal (si renseigné).
 * Calcule la quantité suggérée à commander : `stock_minimum - stock_actuel + 1`.
 *
 * @param db          Port Database
 * @param boutiqueId  Identifiant de la boutique
 * @returns           Liste de produits en alerte `{ id, nom, stock_actuel, alerte: 'rupture'|'bas', quantite_suggere, ... }`
 *                    triée par stock croissant (ruptures en premier)
 */
export async function getProduitsACommander(
  db: Database, boutiqueId: number
) {
  return db.all<any>(`
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
  `, [boutiqueId])
}
