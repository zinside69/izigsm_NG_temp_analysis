/**
 * reconditionnementService.ts — Model layer : Reconditionnement + Bons d'achat
 * Sprint 2.16 — MOD-05 Reconditionnement + MOD-11 Bons d'achat
 *
 * Rôle architectural (P1 MVC) : Model — toute la logique SQL et les règles
 * métier sont ici. Les controllers (routes/*.ts) n'écrivent aucune requête.
 *
 * Module Reconditionnement :
 *   Workflow rachat → ordre → reconditionnement → produit occasion en stock.
 *   Un ordre de reconditionnement transforme un rachat (livre de police) en
 *   produit revendable. Le coût de revient = prix_rachat + MO + pièces.
 *
 * Module Bons d'achat :
 *   Geste commercial (code unique) attribué à un client.
 *   Peut être lié à un ticket SAV, une facture, ou émis manuellement.
 *   Consommé à la facturation : montant déduit du total TTC.
 *
 * Fonctions exportées — Reconditionnement :
 *   listOrdres(db, boutiqueId, query)          — liste paginée + filtres
 *   getOrdre(db, id, boutiqueId)               — détail + rachat source + produit
 *   createOrdre(db, boutiqueId, data)          — créer depuis rachat ou ex nihilo
 *   updateOrdre(db, id, boutiqueId, data)      — modifier coûts / description
 *   updateStatutOrdre(db, id, boutiqueId, s)   — machine à états
 *   terminerOrdre(db, id, boutiqueId, data)    — clôturer + créer/MAJ produit stock
 *   getKpisReconditionnement(db, boutiqueId)   — KPIs dashboard
 *
 * Fonctions exportées — Bons d'achat :
 *   listBonsAchat(db, boutiqueId, query)       — liste paginée + filtres
 *   getBonAchat(db, id, boutiqueId)            — détail bon
 *   createBonAchat(db, boutiqueId, data)       — émettre un bon
 *   verifierBonAchat(db, code, boutiqueId)     — valider un code avant encaissement
 *   consommerBonAchat(db, code, boutiqueId, factureId, montantUtilise) — encaisser
 *   annulerBonAchat(db, id, boutiqueId)        — annuler (non consommé uniquement)
 */

import { nextNumero, parsePagination } from '../lib/db'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Statuts d'un ordre de reconditionnement (transitions linéaires) */
export type StatutOrdre = 'brouillon' | 'en_cours' | 'termine' | 'abandonne'

/** Grade qualité d'un appareil reconditionné */
export type GradeQualite = 'A' | 'B' | 'C' | 'D'

export interface OrdreRow {
  id:                 number
  boutique_id:        number
  rachat_id:          number | null
  produit_id:         number | null
  numero:             string
  statut:             StatutOrdre
  appareil_marque:    string | null
  appareil_modele:    string | null
  imei:               string | null
  couleur:            string | null
  capacite:           string | null
  prix_rachat:        number
  cout_main_oeuvre:   number
  cout_pieces:        number
  cout_revient:       number    // colonne générée : prix_rachat + cout_main_oeuvre + cout_pieces
  prix_revente_ht:    number | null
  description_travaux: string | null
  grade:              GradeQualite | null
  date_debut:         string | null
  date_fin:           string | null
  actif:              number
  created_at:         string
  updated_at:         string
}

/** Données pour créer un ordre de reconditionnement */
export interface CreateOrdreData {
  rachat_id?:          number
  appareil_marque?:    string
  appareil_modele?:    string
  imei?:               string
  couleur?:            string
  capacite?:           string
  prix_rachat?:        number
  cout_main_oeuvre?:   number
  cout_pieces?:        number
  prix_revente_ht?:    number
  description_travaux?: string
  grade?:              GradeQualite
}

/** Statuts d'un bon d'achat */
export type StatutBonAchat = 'actif' | 'utilise' | 'expire' | 'annule'

export interface BonAchatRow {
  id:                   number
  boutique_id:          number
  client_id:            number | null
  source_type:          'manuel' | 'ticket' | 'facture' | 'sav' | null
  source_id:            number | null
  code:                 string
  montant:              number
  montant_utilise:      number
  statut:               StatutBonAchat
  date_expiration:      string | null
  utilise_le:           string | null
  utilise_facture_id:   number | null
  motif:                string | null
  actif:                number
  created_at:           string
  updated_at:           string
}

/** Données pour créer un bon d'achat */
export interface CreateBonAchatData {
  client_id?:       number
  source_type?:     'manuel' | 'ticket' | 'facture' | 'sav'
  source_id?:       number
  montant:          number
  date_expiration?: string
  motif?:           string
}

// Transitions autorisées pour la machine à états de l'ordre
const TRANSITIONS_ORDRE: Record<StatutOrdre, StatutOrdre[]> = {
  brouillon:  ['en_cours', 'abandonne'],
  en_cours:   ['termine', 'abandonne'],
  termine:    [],
  abandonne:  [],
}

// ─── Helpers privés ───────────────────────────────────────────────────────────

/**
 * Génère un code bon d'achat unique sur 8 caractères alphanumériques majuscules.
 * Exemple : "BA-K3X9PQ2W"
 * Préfixe fixe "BA-" pour identification visuelle immédiate en caisse.
 */
function genererCodeBon(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  // sans I/O/1/0 (ambiguïté visuelle)
  let code = 'BA-'
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

/**
 * Vérifie qu'un code bon est disponible (non déjà utilisé en DB).
 * Tente jusqu'à 5 fois pour couvrir les rares collisions.
 *
 * @param db         - Instance D1Database
 * @param boutiqueId - ID boutique (les codes sont globaux, pas par boutique)
 * @returns Code unique disponible
 * @throws Error si aucun code disponible après 5 tentatives (quasi-impossible)
 */
async function genererCodeUnique(db: D1Database, boutiqueId: number): Promise<string> {
  for (let tentative = 0; tentative < 5; tentative++) {
    const code = genererCodeBon()
    const existant = await db.prepare(
      'SELECT id FROM bons_achat WHERE code = ?'
    ).bind(code).first()
    if (!existant) return code
  }
  throw new Error('Impossible de générer un code bon unique après 5 tentatives.')
}

// ─── Ordres de reconditionnement — liste ──────────────────────────────────────

/**
 * Retourne la liste paginée des ordres de reconditionnement d'une boutique.
 * Jointure LEFT avec rachats (source) et produits (destination).
 *
 * @param db         - Instance D1Database
 * @param boutiqueId - ID boutique
 * @param query      - Paramètres URL : page, limit, statut, search, grade
 * @returns { data, pagination }
 */
export async function listOrdres(
  db:          D1Database,
  boutiqueId:  number,
  query:       Record<string, string>
): Promise<{ data: any[]; pagination: any }> {
  const { page, limit, offset } = parsePagination(query)
  const statut = query.statut ?? null    // brouillon | en_cours | termine | abandonne
  const grade  = query.grade  ?? null    // A | B | C | D
  const search = query.search ?? null

  const conditions: string[] = ['o.boutique_id = ?', 'o.actif = 1']
  const params: any[]         = [boutiqueId]

  if (statut) {
    conditions.push('o.statut = ?')
    params.push(statut)
  }
  if (grade) {
    conditions.push('o.grade = ?')
    params.push(grade)
  }
  if (search) {
    conditions.push(`(o.numero LIKE ? OR o.appareil_marque LIKE ?
                       OR o.appareil_modele LIKE ? OR o.imei LIKE ?)`)
    const like = `%${search}%`
    params.push(like, like, like, like)
  }

  const where = conditions.join(' AND ')

  const [total, rows] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) as cnt
      FROM   ordres_reconditionnement o
      WHERE  ${where}
    `).bind(...params).first<{ cnt: number }>(),

    db.prepare(`
      SELECT o.*,
             r.numero          AS rachat_numero,
             r.prix_rachat     AS rachat_prix,
             p.nom             AS produit_nom,
             p.sku             AS produit_sku,
             p.stock_actuel    AS produit_stock
      FROM   ordres_reconditionnement o
      LEFT   JOIN rachats  r ON r.id = o.rachat_id
      LEFT   JOIN produits p ON p.id = o.produit_id
      WHERE  ${where}
      ORDER  BY o.created_at DESC
      LIMIT  ? OFFSET ?
    `).bind(...params, limit, offset).all<any>(),
  ])

  return {
    data:       rows.results ?? [],
    pagination: {
      page,
      limit,
      total:  total?.cnt ?? 0,
      pages:  Math.ceil((total?.cnt ?? 0) / limit),
    },
  }
}

// ─── Ordres de reconditionnement — détail ─────────────────────────────────────

/**
 * Retourne le détail complet d'un ordre avec le rachat source et le produit créé.
 *
 * @param db         - Instance D1Database
 * @param id         - ID de l'ordre
 * @param boutiqueId - ID boutique (isolation multi-tenant)
 * @returns Ordre enrichi ou null si introuvable
 */
export async function getOrdre(
  db:          D1Database,
  id:          number,
  boutiqueId:  number
): Promise<any | null> {
  return db.prepare(`
    SELECT o.*,
           r.numero                AS rachat_numero,
           r.marque                AS rachat_marque,
           r.modele                AS rachat_modele,
           r.imei                  AS rachat_imei,
           r.prix_rachat           AS rachat_prix,
           r.etat                  AS rachat_etat,
           r.vendeur_nom           AS rachat_vendeur_nom,
           r.vendeur_prenom        AS rachat_vendeur_prenom,
           p.nom                   AS produit_nom,
           p.sku                   AS produit_sku,
           p.stock_actuel          AS produit_stock,
           p.prix_vente_ht         AS produit_prix_vente
    FROM   ordres_reconditionnement o
    LEFT   JOIN rachats  r ON r.id = o.rachat_id
    LEFT   JOIN produits p ON p.id = o.produit_id
    WHERE  o.id = ? AND o.boutique_id = ? AND o.actif = 1
  `).bind(id, boutiqueId).first<any>()
}

// ─── Ordres de reconditionnement — création ───────────────────────────────────

/**
 * Crée un nouvel ordre de reconditionnement.
 * Si rachat_id est fourni, les informations de l'appareil et le prix sont
 * copiés depuis le rachat (l'utilisateur peut les surcharger ensuite via updateOrdre).
 *
 * @param db         - Instance D1Database
 * @param boutiqueId - ID boutique
 * @param data       - Données de l'ordre (rachat_id optionnel)
 * @returns OrdreRow créé
 */
export async function createOrdre(
  db:          D1Database,
  boutiqueId:  number,
  data:        CreateOrdreData
): Promise<OrdreRow> {
  // Si rachat_id fourni → pré-remplissage depuis le rachat
  let prixRachat      = data.prix_rachat       ?? 0
  let appareilMarque  = data.appareil_marque   ?? null
  let appareilModele  = data.appareil_modele   ?? null
  let imei            = data.imei              ?? null
  let couleur         = data.couleur           ?? null
  let capacite        = data.capacite          ?? null

  if (data.rachat_id) {
    const rachat = await db.prepare(`
      SELECT marque, modele, imei, couleur, capacite, prix_rachat
      FROM   rachats WHERE id = ? AND boutique_id = ?
    `).bind(data.rachat_id, boutiqueId).first<{
      marque: string; modele: string; imei: string
      couleur: string; capacite: string; prix_rachat: number
    }>()

    if (!rachat) throw new Error('Rachat introuvable pour cette boutique.')

    // Pré-remplissage depuis le rachat (les valeurs explicites dans data ont priorité)
    prixRachat     = data.prix_rachat     ?? rachat.prix_rachat ?? 0
    appareilMarque = data.appareil_marque ?? rachat.marque      ?? null
    appareilModele = data.appareil_modele ?? rachat.modele      ?? null
    imei           = data.imei            ?? rachat.imei        ?? null
    couleur        = data.couleur         ?? rachat.couleur     ?? null
    capacite       = data.capacite        ?? rachat.capacite    ?? null
  }

  const numero = await nextNumero(db, boutiqueId, 'sav')  // on réutilise la séquence générique
  // Note : nextNumero ne supporte pas encore 'reconditionnement' → préfixe RC injecté manuellement
  const numeroRc = numero.replace(/^SAV-/, 'RC-')

  const result = await db.prepare(`
    INSERT INTO ordres_reconditionnement
      (boutique_id, rachat_id, numero, statut,
       appareil_marque, appareil_modele, imei, couleur, capacite,
       prix_rachat, cout_main_oeuvre, cout_pieces,
       prix_revente_ht, description_travaux, grade)
    VALUES (?, ?, ?, 'brouillon', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    boutiqueId,
    data.rachat_id           ?? null,
    numeroRc,
    appareilMarque,
    appareilModele,
    imei,
    couleur,
    capacite,
    prixRachat,
    data.cout_main_oeuvre    ?? 0,
    data.cout_pieces         ?? 0,
    data.prix_revente_ht     ?? null,
    data.description_travaux ?? null,
    data.grade               ?? null
  ).first<OrdreRow>()

  if (!result) throw new Error('Échec création ordre de reconditionnement.')
  return result
}

// ─── Ordres de reconditionnement — mise à jour ────────────────────────────────

/**
 * Met à jour les champs éditables d'un ordre (statut brouillon ou en_cours uniquement).
 * Un ordre terminé ou abandonné ne peut plus être modifié.
 *
 * @param db         - Instance D1Database
 * @param id         - ID de l'ordre
 * @param boutiqueId - ID boutique
 * @param data       - Champs à mettre à jour
 * @returns true si la mise à jour a réussi
 */
export async function updateOrdre(
  db:          D1Database,
  id:          number,
  boutiqueId:  number,
  data:        Partial<CreateOrdreData>
): Promise<boolean> {
  // Vérifier que l'ordre est modifiable
  const ordre = await db.prepare(`
    SELECT statut FROM ordres_reconditionnement WHERE id = ? AND boutique_id = ? AND actif = 1
  `).bind(id, boutiqueId).first<{ statut: StatutOrdre }>()

  if (!ordre) throw new Error('Ordre introuvable.')
  if (ordre.statut === 'termine')   throw new Error('Un ordre terminé ne peut pas être modifié.')
  if (ordre.statut === 'abandonne') throw new Error('Un ordre abandonné ne peut pas être modifié.')

  const res = await db.prepare(`
    UPDATE ordres_reconditionnement SET
      appareil_marque    = COALESCE(?, appareil_marque),
      appareil_modele    = COALESCE(?, appareil_modele),
      imei               = COALESCE(?, imei),
      couleur            = COALESCE(?, couleur),
      capacite           = COALESCE(?, capacite),
      prix_rachat        = COALESCE(?, prix_rachat),
      cout_main_oeuvre   = COALESCE(?, cout_main_oeuvre),
      cout_pieces        = COALESCE(?, cout_pieces),
      prix_revente_ht    = COALESCE(?, prix_revente_ht),
      description_travaux = COALESCE(?, description_travaux),
      grade              = COALESCE(?, grade),
      updated_at         = CURRENT_TIMESTAMP
    WHERE id = ? AND boutique_id = ?
  `).bind(
    data.appareil_marque    ?? null,
    data.appareil_modele    ?? null,
    data.imei               ?? null,
    data.couleur            ?? null,
    data.capacite           ?? null,
    data.prix_rachat        ?? null,
    data.cout_main_oeuvre   ?? null,
    data.cout_pieces        ?? null,
    data.prix_revente_ht    ?? null,
    data.description_travaux ?? null,
    data.grade              ?? null,
    id, boutiqueId
  ).run()

  return (res.meta?.changes ?? 0) > 0
}

// ─── Ordres de reconditionnement — machine à états ────────────────────────────

/**
 * Change le statut d'un ordre selon les transitions autorisées.
 * Transitions :
 *   brouillon → en_cours   (démarrage des travaux)
 *   brouillon → abandonne  (annulation avant démarrage)
 *   en_cours  → termine    (utiliser terminerOrdre() pour la clôture complète)
 *   en_cours  → abandonne  (abandon en cours de route)
 *
 * Pour la transition → termine, préférer terminerOrdre() qui crée aussi le produit.
 *
 * @param db         - Instance D1Database
 * @param id         - ID de l'ordre
 * @param boutiqueId - ID boutique
 * @param statut     - Nouveau statut cible
 * @returns OrdreRow mis à jour
 */
export async function updateStatutOrdre(
  db:          D1Database,
  id:          number,
  boutiqueId:  number,
  statut:      StatutOrdre
): Promise<OrdreRow> {
  const ordre = await db.prepare(`
    SELECT * FROM ordres_reconditionnement WHERE id = ? AND boutique_id = ? AND actif = 1
  `).bind(id, boutiqueId).first<OrdreRow>()

  if (!ordre) throw new Error('Ordre de reconditionnement introuvable.')

  const transitions = TRANSITIONS_ORDRE[ordre.statut] ?? []
  if (!transitions.includes(statut)) {
    throw new Error(
      `Transition invalide : ${ordre.statut} → ${statut}. ` +
      `Autorisées : ${transitions.join(', ') || 'aucune'}`
    )
  }

  // Horodatage automatique selon le statut
  const dateDebutClause = statut === 'en_cours'   ? ', date_debut = CURRENT_TIMESTAMP' : ''
  const dateFinClause   = statut === 'abandonne'  ? ', date_fin   = CURRENT_TIMESTAMP' : ''

  const updated = await db.prepare(`
    UPDATE ordres_reconditionnement
    SET    statut     = ?,
           updated_at = CURRENT_TIMESTAMP
           ${dateDebutClause}
           ${dateFinClause}
    WHERE  id = ? AND boutique_id = ?
    RETURNING *
  `).bind(statut, id, boutiqueId).first<OrdreRow>()

  if (!updated) throw new Error('Mise à jour statut échouée.')
  return updated
}

// ─── Ordres de reconditionnement — clôture ────────────────────────────────────

/**
 * Clôture un ordre de reconditionnement (en_cours → termine).
 * Actions effectuées en séquence :
 *   1. Valide la transition en_cours → termine
 *   2. Crée un produit occasion dans le catalogue (si produit_id non fourni)
 *      ou incrémente le stock d'un produit existant
 *   3. Lie le produit à l'ordre (ordre.produit_id = produit.id)
 *   4. Met à jour le statut de l'ordre + date_fin
 *
 * @param db          - Instance D1Database
 * @param id          - ID de l'ordre
 * @param boutiqueId  - ID boutique
 * @param data        - Prix de revente HT + grade final + description travaux optionnelle
 * @returns OrdreRow terminé avec produit_id renseigné
 */
export async function terminerOrdre(
  db:          D1Database,
  id:          number,
  boutiqueId:  number,
  data: {
    prix_revente_ht:     number
    grade:               GradeQualite
    description_travaux?: string
    produit_id_existant?: number   // si on alimente un produit déjà en catalogue
  }
): Promise<OrdreRow> {
  const ordre = await db.prepare(`
    SELECT * FROM ordres_reconditionnement WHERE id = ? AND boutique_id = ? AND actif = 1
  `).bind(id, boutiqueId).first<OrdreRow>()

  if (!ordre) throw new Error('Ordre introuvable.')
  if (ordre.statut !== 'en_cours') {
    throw new Error(`Impossible de terminer un ordre en statut "${ordre.statut}". Statut requis : en_cours.`)
  }

  let produitId = data.produit_id_existant ?? null

  if (produitId) {
    // ── Cas 1 : produit existant → incrémenter le stock de 1 ──
    await db.prepare(`
      UPDATE produits
      SET    stock_actuel = stock_actuel + 1,
             updated_at   = CURRENT_TIMESTAMP
      WHERE  id = ? AND boutique_id = ?
    `).bind(produitId, boutiqueId).run()
  } else {
    // ── Cas 2 : nouveau produit occasion → créer dans le catalogue ──
    const nomProduit = [
      ordre.appareil_marque,
      ordre.appareil_modele,
      ordre.capacite,
      ordre.couleur,
      data.grade ? `[Grade ${data.grade}]` : null,
    ].filter(Boolean).join(' ')

    const sku = `OCC-${ordre.numero}`

    const produitResult = await db.prepare(`
      INSERT INTO produits
        (boutique_id, nom, sku, marque, description, prix_achat_ht, prix_vente_ht,
         tva_taux, stock_actuel, stock_minimum, actif)
      VALUES (?, ?, ?, ?, ?, ?, ?, 20, 1, 0, 1)
      RETURNING id
    `).bind(
      boutiqueId,
      nomProduit || 'Appareil occasion',
      sku,
      ordre.appareil_marque ?? '',
      data.description_travaux ?? ordre.description_travaux ?? null,
      ordre.cout_revient,          // prix d'achat = coût de revient
      data.prix_revente_ht
    ).first<{ id: number }>()

    if (!produitResult) throw new Error('Échec création produit occasion.')
    produitId = produitResult.id
  }

  // Mettre à jour l'ordre : statut termine + lien produit + date_fin
  const updated = await db.prepare(`
    UPDATE ordres_reconditionnement SET
      statut              = 'termine',
      produit_id          = ?,
      prix_revente_ht     = ?,
      grade               = ?,
      description_travaux = COALESCE(?, description_travaux),
      date_fin            = CURRENT_TIMESTAMP,
      updated_at          = CURRENT_TIMESTAMP
    WHERE id = ? AND boutique_id = ?
    RETURNING *
  `).bind(
    produitId,
    data.prix_revente_ht,
    data.grade,
    data.description_travaux ?? null,
    id, boutiqueId
  ).first<OrdreRow>()

  if (!updated) throw new Error('Clôture ordre échouée.')
  return updated
}

// ─── Ordres de reconditionnement — KPIs ───────────────────────────────────────

/**
 * Calcule les KPIs du module reconditionnement pour le dashboard.
 *
 * @param db         - Instance D1Database
 * @param boutiqueId - ID boutique
 * @returns KPIs agrégés (compteurs + CA reconditionnement)
 */
export async function getKpisReconditionnement(
  db:          D1Database,
  boutiqueId:  number
): Promise<{
  nb_total:          number
  nb_en_cours:       number
  nb_termines:       number
  nb_abandonnes:     number
  cout_revient_total: number
  ca_estime_total:   number
  marge_estimee:     number
}> {
  const row = await db.prepare(`
    SELECT
      COUNT(*)                                              AS nb_total,
      SUM(CASE WHEN statut = 'en_cours'   THEN 1 ELSE 0 END) AS nb_en_cours,
      SUM(CASE WHEN statut = 'termine'    THEN 1 ELSE 0 END) AS nb_termines,
      SUM(CASE WHEN statut = 'abandonne'  THEN 1 ELSE 0 END) AS nb_abandonnes,
      COALESCE(SUM(cout_revient),     0)                   AS cout_revient_total,
      COALESCE(SUM(CASE WHEN statut = 'termine'
                   THEN prix_revente_ht ELSE 0 END), 0)    AS ca_estime_total
    FROM ordres_reconditionnement
    WHERE boutique_id = ? AND actif = 1
  `).bind(boutiqueId).first<{
    nb_total: number; nb_en_cours: number; nb_termines: number
    nb_abandonnes: number; cout_revient_total: number; ca_estime_total: number
  }>()

  const coutTotal = row?.cout_revient_total ?? 0
  const caTotal   = row?.ca_estime_total   ?? 0

  return {
    nb_total:           row?.nb_total          ?? 0,
    nb_en_cours:        row?.nb_en_cours        ?? 0,
    nb_termines:        row?.nb_termines        ?? 0,
    nb_abandonnes:      row?.nb_abandonnes      ?? 0,
    cout_revient_total: coutTotal,
    ca_estime_total:    caTotal,
    marge_estimee:      Math.round((caTotal - coutTotal) * 100) / 100,
  }
}

// ─── Bons d'achat — liste ─────────────────────────────────────────────────────

/**
 * Retourne la liste paginée des bons d'achat d'une boutique.
 * Jointure LEFT avec clients pour afficher le nom du bénéficiaire.
 *
 * @param db         - Instance D1Database
 * @param boutiqueId - ID boutique
 * @param query      - Paramètres URL : page, limit, statut, client_id, search
 * @returns { data, pagination }
 */
export async function listBonsAchat(
  db:          D1Database,
  boutiqueId:  number,
  query:       Record<string, string>
): Promise<{ data: any[]; pagination: any }> {
  const { page, limit, offset } = parsePagination(query)
  const statut   = query.statut    ?? null
  const clientId = query.client_id ? Number(query.client_id) : null
  const search   = query.search    ?? null

  const conditions: string[] = ['b.boutique_id = ?', 'b.actif = 1']
  const params: any[]         = [boutiqueId]

  if (statut) {
    conditions.push('b.statut = ?')
    params.push(statut)
  }
  if (clientId) {
    conditions.push('b.client_id = ?')
    params.push(clientId)
  }
  if (search) {
    conditions.push(`(b.code LIKE ? OR c.nom LIKE ? OR c.prenom LIKE ? OR b.motif LIKE ?)`)
    const like = `%${search}%`
    params.push(like, like, like, like)
  }

  const where = conditions.join(' AND ')

  const [total, rows] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) as cnt
      FROM   bons_achat b
      LEFT   JOIN clients c ON c.id = b.client_id
      WHERE  ${where}
    `).bind(...params).first<{ cnt: number }>(),

    db.prepare(`
      SELECT b.*,
             c.nom       AS client_nom,
             c.prenom    AS client_prenom,
             c.telephone AS client_telephone,
             (b.montant - b.montant_utilise) AS montant_restant
      FROM   bons_achat b
      LEFT   JOIN clients c ON c.id = b.client_id
      WHERE  ${where}
      ORDER  BY b.created_at DESC
      LIMIT  ? OFFSET ?
    `).bind(...params, limit, offset).all<any>(),
  ])

  return {
    data:       rows.results ?? [],
    pagination: {
      page,
      limit,
      total:  total?.cnt ?? 0,
      pages:  Math.ceil((total?.cnt ?? 0) / limit),
    },
  }
}

// ─── Bons d'achat — détail ────────────────────────────────────────────────────

/**
 * Retourne le détail d'un bon d'achat avec son bénéficiaire et la facture d'utilisation.
 *
 * @param db         - Instance D1Database
 * @param id         - ID du bon
 * @param boutiqueId - ID boutique
 * @returns BonAchat enrichi ou null
 */
export async function getBonAchat(
  db:          D1Database,
  id:          number,
  boutiqueId:  number
): Promise<any | null> {
  return db.prepare(`
    SELECT b.*,
           c.nom          AS client_nom,
           c.prenom       AS client_prenom,
           c.email        AS client_email,
           c.telephone    AS client_telephone,
           f.numero       AS facture_utilisation_numero,
           (b.montant - b.montant_utilise) AS montant_restant
    FROM   bons_achat b
    LEFT   JOIN clients  c ON c.id = b.client_id
    LEFT   JOIN factures f ON f.id = b.utilise_facture_id
    WHERE  b.id = ? AND b.boutique_id = ? AND b.actif = 1
  `).bind(id, boutiqueId).first<any>()
}

// ─── Bons d'achat — création ──────────────────────────────────────────────────

/**
 * Émet un nouveau bon d'achat pour un client.
 * Le code est généré automatiquement (format BA-XXXXXXXX).
 *
 * @param db         - Instance D1Database
 * @param boutiqueId - ID boutique
 * @param data       - Données du bon (montant obligatoire)
 * @returns BonAchatRow créé
 */
export async function createBonAchat(
  db:          D1Database,
  boutiqueId:  number,
  data:        CreateBonAchatData
): Promise<BonAchatRow> {
  if (data.montant <= 0) throw new Error('Le montant du bon doit être positif.')

  const code = await genererCodeUnique(db, boutiqueId)

  const result = await db.prepare(`
    INSERT INTO bons_achat
      (boutique_id, client_id, source_type, source_id,
       code, montant, date_expiration, motif)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    boutiqueId,
    data.client_id       ?? null,
    data.source_type     ?? 'manuel',
    data.source_id       ?? null,
    code,
    data.montant,
    data.date_expiration ?? null,
    data.motif           ?? null
  ).first<BonAchatRow>()

  if (!result) throw new Error('Échec création bon d\'achat.')
  return result
}

// ─── Bons d'achat — vérification ─────────────────────────────────────────────

/**
 * Vérifie la validité d'un code bon d'achat avant encaissement.
 * Contrôles :
 *   - Code existant et actif
 *   - Statut = 'actif'
 *   - Date d'expiration non dépassée (si définie)
 *   - Montant restant > 0
 *
 * @param db         - Instance D1Database
 * @param code       - Code alphanumérique saisi en caisse
 * @param boutiqueId - ID boutique
 * @returns { valide, bon?, raison? }
 */
export async function verifierBonAchat(
  db:          D1Database,
  code:        string,
  boutiqueId:  number
): Promise<{ valide: boolean; bon?: any; raison?: string }> {
  const bon = await db.prepare(`
    SELECT b.*,
           c.nom       AS client_nom,
           c.prenom    AS client_prenom,
           (b.montant - b.montant_utilise) AS montant_restant
    FROM   bons_achat b
    LEFT   JOIN clients c ON c.id = b.client_id
    WHERE  b.code = ? AND b.boutique_id = ? AND b.actif = 1
  `).bind(code.toUpperCase(), boutiqueId).first<any>()

  if (!bon)                          return { valide: false, raison: 'Code inconnu.' }
  if (bon.statut === 'utilise')      return { valide: false, raison: 'Bon déjà entièrement utilisé.', bon }
  if (bon.statut === 'annule')       return { valide: false, raison: 'Bon annulé.', bon }
  if (bon.statut === 'expire')       return { valide: false, raison: 'Bon expiré.', bon }
  if (bon.montant_restant <= 0)      return { valide: false, raison: 'Solde épuisé.', bon }

  // Vérification expiration en temps réel (la colonne statut peut être en retard)
  if (bon.date_expiration) {
    const expiration = new Date(bon.date_expiration)
    if (expiration < new Date()) {
      // Mettre à jour le statut en DB de manière opportuniste
      await db.prepare(`
        UPDATE bons_achat SET statut = 'expire', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(bon.id).run()
      return { valide: false, raison: `Bon expiré le ${bon.date_expiration}.`, bon }
    }
  }

  return { valide: true, bon }
}

// ─── Bons d'achat — consommation ─────────────────────────────────────────────

/**
 * Consomme (totalement ou partiellement) un bon d'achat lors d'une facturation.
 * Si montant_utilise >= montant total → statut passe à 'utilise'.
 * Sinon le bon reste 'actif' avec un solde résiduel.
 *
 * @param db              - Instance D1Database
 * @param code            - Code du bon
 * @param boutiqueId      - ID boutique
 * @param factureId       - ID de la facture sur laquelle le bon est appliqué
 * @param montantUtilise  - Montant effectivement déduit (≤ montant_restant)
 * @returns BonAchatRow mis à jour
 */
export async function consommerBonAchat(
  db:             D1Database,
  code:           string,
  boutiqueId:     number,
  factureId:      number,
  montantUtilise: number
): Promise<BonAchatRow> {
  // Re-vérifier la validité juste avant d'écrire (évite les race conditions)
  const verification = await verifierBonAchat(db, code, boutiqueId)
  if (!verification.valide) throw new Error(verification.raison)

  const bon = verification.bon!
  const nouveauMontantUtilise = bon.montant_utilise + montantUtilise

  if (montantUtilise > bon.montant_restant) {
    throw new Error(
      `Montant à utiliser (${montantUtilise} €) supérieur au solde disponible (${bon.montant_restant} €).`
    )
  }

  const nouveauStatut: StatutBonAchat =
    nouveauMontantUtilise >= bon.montant ? 'utilise' : 'actif'

  const updated = await db.prepare(`
    UPDATE bons_achat SET
      montant_utilise    = ?,
      statut             = ?,
      utilise_le         = CURRENT_TIMESTAMP,
      utilise_facture_id = ?,
      updated_at         = CURRENT_TIMESTAMP
    WHERE code = ? AND boutique_id = ?
    RETURNING *
  `).bind(
    nouveauMontantUtilise,
    nouveauStatut,
    factureId,
    code.toUpperCase(),
    boutiqueId
  ).first<BonAchatRow>()

  if (!updated) throw new Error('Consommation bon d\'achat échouée.')
  return updated
}

// ─── Bons d'achat — annulation ────────────────────────────────────────────────

/**
 * Annule un bon d'achat non encore utilisé.
 * Un bon partiellement ou totalement consommé ne peut pas être annulé.
 *
 * @param db         - Instance D1Database
 * @param id         - ID du bon
 * @param boutiqueId - ID boutique
 * @returns true si le bon a bien été annulé
 */
export async function annulerBonAchat(
  db:          D1Database,
  id:          number,
  boutiqueId:  number
): Promise<boolean> {
  const bon = await db.prepare(`
    SELECT statut, montant_utilise FROM bons_achat WHERE id = ? AND boutique_id = ? AND actif = 1
  `).bind(id, boutiqueId).first<{ statut: StatutBonAchat; montant_utilise: number }>()

  if (!bon) throw new Error('Bon d\'achat introuvable.')
  if (bon.statut === 'utilise')  throw new Error('Impossible d\'annuler un bon déjà utilisé.')
  if (bon.statut === 'annule')   throw new Error('Ce bon est déjà annulé.')
  if (bon.montant_utilise > 0)   throw new Error('Impossible d\'annuler un bon partiellement consommé.')

  const res = await db.prepare(`
    UPDATE bons_achat
    SET    statut     = 'annule',
           updated_at = CURRENT_TIMESTAMP
    WHERE  id = ? AND boutique_id = ?
  `).bind(id, boutiqueId).run()

  return (res.meta?.changes ?? 0) > 0
}
