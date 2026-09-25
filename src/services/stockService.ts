/**
 * stockService.ts — Model layer pour la gestion des produits et du stock
 * Sprint 2.17 — Extraction depuis routes/stocks.ts (violation P1 résolue)
 * Sprint 2.34 — MOD-04 : familles produits + import catalogue CSV fournisseur
 *
 * Périmètre : produits, catégories, mouvements de stock.
 * Aucun SQL ne doit subsister dans routes/stocks.ts après ce sprint.
 *
 * Fonctions exportées :
 *   listProduits(db, boutiqueId, opts)              — Liste paginée + filtres + alertes stock
 *   getProduitById(db, id)                          — Fiche produit avec derniers mouvements
 *   createProduit(db, boutiqueId, userId, data)     — Création + mouvement stock initial si stock > 0
 *   updateProduit(db, id, userId, data)             — Mise à jour champs éditables
 *   deleteProduit(db, id, userId)                   — Soft delete (actif = 0)
 *   enregistrerMouvement(db, produitId, userId, m)  — Mouvement stock (entrée/sortie/ajustement/inventaire)
 *   listCategories(db, boutiqueId)                  — Catégories + nb_produits
 *   createCategorie(db, boutiqueId, data)           — Création catégorie
 *   getKpisStock(db, boutiqueId)                    — KPIs : valeur stock, ruptures, alertes
 *   importCatalogueCsv(db, boutiqueId, userId, csv) — Import/UPSERT catalogue fournisseur CSV
 */

import { parsePagination, auditLog } from '../lib/db'
import type { Database } from '../ports/database'
import { sqlSousSeuil } from '../lib/stockSeuil'
// Seul point de résolution des valeurs par défaut de stock (`CLAUDE.md` § Stock). Pas de cycle :
// boutiqueService n'importe de ce fichier qu'un type.
import { resoudreDefautsStock, type DefautsStock, type DefautsStockEffectifs } from './boutiqueService'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TypeMouvement  = 'entree' | 'sortie' | 'ajustement' | 'inventaire'
export type FamilleProduit = 'piece' | 'accessoire' | 'appareil' | 'consommable'

export const FAMILLES: FamilleProduit[] = ['piece', 'accessoire', 'appareil', 'consommable']

export interface ProduitRow {
  id:                   number
  boutique_id:          number
  categorie_id:         number | null
  sku:                  string | null
  nom:                  string
  marque:               string | null
  description:          string | null
  famille:              FamilleProduit
  prix_achat_ht:        number
  prix_achat_cump:      number
  prix_vente_ht:        number
  tva_taux:             number
  stock_actuel:         number
  stock_minimum:        number
  fournisseur:          string | null
  reference_fournisseur: string | null
  code_barre:           string | null
  actif:                number
  created_at:           string
  updated_at:           string
}

export interface ListProduitsOpts {
  categorie_id?: number
  /** Fiche fournisseur source (lien du bilan de l'import par génération) */
  fournisseur_id?: number
  famille?:      FamilleProduit | string
  stock_bas?:    boolean
  search?:       string
  limit?:        number
  offset?:       number
  page?:         number
}

export interface CreateProduitData {
  nom:                   string
  sku?:                  string | null
  marque?:               string | null
  categorie_id?:         number | null
  famille?:              FamilleProduit
  prix_achat_ht?:        number
  prix_vente_ht?:        number
  tva_taux?:             number
  stock_actuel?:         number
  stock_minimum?:        number
  fournisseur?:          string | null
  reference_fournisseur?: string | null
  code_barre?:           string | null
  description?:          string | null
}

/**
 * Lien vers une fiche `fournisseurs` — hors de `CreateProduitData` à dessein : `POST /produits`
 * passe le corps de requête tel quel, et un `fournisseur_id` pris dans ce corps pourrait viser
 * la fiche d'une autre boutique. Seul un appelant serveur (import Mobilax) le fournit.
 */
export interface CreateProduitOptions {
  fournisseur_id?: number | null
}

export interface UpdateProduitData {
  nom?:                  string
  /** « Notes » de la fiche produit — seule colonne texte libre de `produits` (pas de `notes`). */
  description?:          string | null
  sku?:                  string | null
  marque?:               string | null
  categorie_id?:         number | null
  famille?:              FamilleProduit
  prix_achat_ht?:        number
  prix_vente_ht?:        number
  tva_taux?:             number
  stock_minimum?:        number
  fournisseur?:          string | null
  code_barre?:           string | null
}

export interface MouvementData {
  type_mouvement: TypeMouvement
  quantite:       number
  motif?:         string | null
  ticket_id?:     number | null
}

export interface CreateCategorieData {
  nom:       string
  parent_id?: number | null
}

export interface KpisStock {
  nb_produits:        number
  nb_ruptures:        number
  nb_alertes:         number
  valeur_stock_ht:    number
  valeur_stock_cump:  number
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const TYPES_MOUVEMENT_VALIDES: TypeMouvement[] = ['entree', 'sortie', 'ajustement', 'inventaire']

// ─── Fonctions exportées ──────────────────────────────────────────────────────

/**
 * Liste les produits d'une boutique avec filtres, pagination et calcul de marge.
 * Ajoute l'indicateur alerte_stock : 'ok' | 'bas' | 'rupture'.
 *
 * @param db          — Port Database
 * @param boutiqueId  — ID boutique obligatoire
 * @param opts        — Filtres optionnels : categorie_id, stock_bas, search + pagination
 * @returns           — { data, pagination }
 */
export async function listProduits(
  db: Database,
  boutiqueId: number,
  opts: ListProduitsOpts = {}
): Promise<{ data: any[]; pagination: { page: number; limit: number; total: number; pages: number } }> {
  const { limit, offset, page } = parsePagination({
    page:  String(opts.page  ?? 1),
    limit: String(opts.limit ?? 20),
  })

  const conditions: string[] = ['p.boutique_id = ?', 'p.actif = 1']
  const bindings:   any[]    = [boutiqueId]

  if (opts.categorie_id) {
    conditions.push('p.categorie_id = ?')
    bindings.push(opts.categorie_id)
  }
  // Fiche fournisseur source (bilan de l'import par génération) — la boutique reste filtrée ci-dessus
  if (opts.fournisseur_id) {
    conditions.push('p.fournisseur_id = ?')
    bindings.push(opts.fournisseur_id)
  }
  if (opts.famille && FAMILLES.includes(opts.famille as FamilleProduit)) {
    conditions.push('p.famille = ?')
    bindings.push(opts.famille)
  }
  if (opts.stock_bas) {
    conditions.push(sqlSousSeuil('p'))   // un seuil 0 n'alerte pas (lib/stockSeuil.ts)
  }
  if (opts.search) {
    conditions.push('(p.nom LIKE ? OR p.sku LIKE ? OR p.marque LIKE ?)')
    const s = `%${opts.search}%`
    bindings.push(s, s, s)
  }

  const where = 'WHERE ' + conditions.join(' AND ')

  const totRow = await db.get<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM produits p ${where}`,
    bindings
  )

  const rows = await db.all<any>(`
    SELECT p.*,
           c.nom AS categorie_nom,
           ROUND((p.prix_vente_ht - p.prix_achat_ht) / NULLIF(p.prix_vente_ht, 0) * 100, 1) AS marge_pct,
           CASE
             WHEN p.stock_actuel = 0               THEN 'rupture'
             WHEN ${sqlSousSeuil('p')}             THEN 'bas'
             ELSE 'ok'
           END AS alerte_stock
    FROM   produits p
    LEFT JOIN categories c ON c.id = p.categorie_id
    ${where}
    ORDER  BY p.nom ASC
    LIMIT ? OFFSET ?
  `, [...bindings, limit, offset])

  return {
    data: rows ?? [],
    pagination: {
      page,
      limit,
      total:  totRow?.cnt ?? 0,
      pages:  Math.ceil((totRow?.cnt ?? 0) / limit),
    },
  }
}

/**
 * Retourne la fiche complète d'un produit avec ses 20 derniers mouvements de stock.
 *
 * @param db  — Port Database
 * @param id  — ID du produit
 * @returns   — ProduitRow enrichi avec mouvements, ou null si introuvable
 */
export async function getProduitById(
  db: Database,
  id: number
): Promise<any | null> {
  const produit = await db.get<any>(`
    SELECT p.*,
           c.nom AS categorie_nom,
           ROUND((p.prix_vente_ht - p.prix_achat_ht) / NULLIF(p.prix_vente_ht, 0) * 100, 1) AS marge_pct
    FROM   produits p
    LEFT JOIN categories c ON c.id = p.categorie_id
    WHERE  p.id = ? AND p.actif = 1
  `, [id])

  if (!produit) return null

  const mouvements = await db.all<any>(`
    SELECT m.*, u.prenom || ' ' || u.nom AS user_nom
    FROM   mouvements_stock m
    LEFT JOIN users u ON u.id = m.user_id
    WHERE  m.produit_id = ?
    ORDER  BY m.created_at DESC
    LIMIT  20
  `, [id])

  return {
    ...produit,
    mouvements: mouvements ?? [],
  }
}

/** Message du refus d'un prix d'achat négatif — commun à la création, la modification et au CSV. */
export const ERREUR_PRIX_ACHAT_NEGATIF = 'Le prix d\'achat ne peut pas être négatif.'

/**
 * Message du refus d'une quantité de départ qui n'est pas un entier ≥ 0 (décision de l'exploitant,
 * 2026-09-12) : un stock négatif sans mouvement tracé est impossible. Retirer des pièces (casse,
 * non conforme) passe par un mouvement de sortie, jamais par la quantité de départ. Même règle que
 * l'import CSV (`entierCsv()`).
 */
export const ERREUR_QUANTITE_DEPART_INVALIDE = 'La quantité de départ doit être un entier positif ou nul.'

/**
 * Règle commune d'une quantité de départ : entier ≥ 0. Partagée par la création manuelle et par
 * l'import depuis un fournisseur connecté (`mobilaxService`) — l'import CSV lit ses cellules
 * texte par `entierCsv()`, même règle.
 *
 * @param n  Quantité déjà convertie en nombre (`NaN` pour une saisie illisible)
 * @returns  `true` si c'est un entier positif ou nul
 */
export function estEntierPositifOuNul(n: number): boolean {
  return Number.isInteger(n) && n >= 0
}

/**
 * Règle unique : un prix d'achat ne peut pas être négatif (décision de l'exploitant, 2026-09-12).
 * Depuis le ticket 02 `reglages-stock-boutique`, le prix d'achat valorise le stock initial au
 * coût moyen — un prix négatif ferait baisser la valeur du stock.
 *
 * @param prix  Prix d'achat HT tel que reçu (nombre, ou chaîne d'un corps JSON), absent permis
 * @returns     `true` si le prix est fourni et strictement négatif
 */
export function prixAchatNegatif(prix: unknown): boolean {
  return prix != null && Number(prix) < 0
}

/** Champ d'un produit dont l'unicité par boutique est tenue en base (migration 0048). */
export type ChampCodeUnique = 'code_barre' | 'sku'

/**
 * Lit, dans une erreur de la base, un doublon de code-barres ou de SKU.
 *
 * S'appuie sur le message du moteur, qui cite les colonnes de l'index violé
 * (« UNIQUE constraint failed: produits.boutique_id, produits.code_barre ») — mesuré contre un vrai
 * SQLite (`produits-unicite-codes-migration.test.ts`). La colonne doit **terminer** la liste : la
 * contrainte de l'import fournisseur (0046, `…, produits.reference_fournisseur`) n'est pas un doublon
 * de code et rend `null`.
 *
 * @param err  Erreur levée par une écriture (ou n'importe quoi d'autre)
 * @returns    Le champ en doublon, ou `null` si l'erreur est d'une autre nature
 */
export function champEnDoublon(err: unknown): ChampCodeUnique | null {
  const message = String((err as Error)?.message ?? '')
  const liste = /UNIQUE constraint failed: ([\w., ]+)/.exec(message)?.[1] ?? ''
  const derniere = liste.split(',').pop()?.trim()
  if (derniere === 'produits.code_barre') return 'code_barre'
  if (derniere === 'produits.sku') return 'sku'
  return null
}

/**
 * Message du refus d'un code déjà porté — il **nomme** le produit, pour que l'opérateur corrige le
 * doublon au lieu de subir une erreur de base de données (ticket 01 `vente-lit-catalogue`).
 */
export function messageCodeEnDoublon(champ: ChampCodeUnique, existant: { id: number; nom: string }): string {
  const libelle = champ === 'code_barre' ? 'Ce code-barres' : 'Ce SKU'
  return `${libelle} est déjà utilisé par « ${existant.nom} » (produit n° ${existant.id}).`
}

/** Refus d'une écriture qui donnerait à un produit le code-barres ou le SKU d'un autre. */
export class ErreurCodeEnDoublon extends Error {
  constructor(
    readonly champ: ChampCodeUnique,
    readonly produit: { id: number; nom: string },
  ) {
    super(messageCodeEnDoublon(champ, produit))
    this.name = 'ErreurCodeEnDoublon'
  }
}

/**
 * Convertit une violation d'unicité de code en `ErreurCodeEnDoublon`, en cherchant le produit qui
 * porte déjà la valeur. Toute autre erreur — et un porteur introuvable (supprimé entre-temps) — est
 * laissée à l'appelant, qui la relève telle quelle : rien n'est inventé.
 *
 * @param cible  Boutique du produit créé, ou produit modifié (exclu de la recherche du porteur)
 */
async function leverSiCodeEnDoublon(
  db: D1Database,
  err: unknown,
  valeurs: { code_barre?: string | null; sku?: string | null },
  cible: { boutiqueId: number } | { produitId: number },
): Promise<void> {
  const champ = champEnDoublon(err)
  const valeur = champ ? valeurs[champ] : null
  if (!champ || valeur == null) return

  // Colonne interpolée : `champ` ne vaut jamais que 'code_barre' ou 'sku' (type fermé)
  const porteur = 'boutiqueId' in cible
    ? await db.prepare(
        `SELECT id, nom FROM produits WHERE boutique_id = ? AND ${champ} = ? AND actif = 1 LIMIT 1`,
      ).bind(cible.boutiqueId, valeur).first<{ id: number; nom: string }>()
    : await db.prepare(
        `SELECT id, nom FROM produits
         WHERE boutique_id = (SELECT boutique_id FROM produits WHERE id = ?)
           AND ${champ} = ? AND actif = 1 AND id <> ? LIMIT 1`,
      ).bind(cible.produitId, valeur, cible.produitId).first<{ id: number; nom: string }>()

  if (porteur) throw new ErreurCodeEnDoublon(champ, porteur)
}

/**
 * Coût moyen d'un produit à sa création (règle « sur tous les chemins », `decisions.md`) : des
 * pièces déjà en rayon valent leur prix d'achat ; sans pièce, 0 (`DEFAULT` de la colonne).
 *
 * @param quantite   Quantité de départ
 * @param prixAchat  Prix d'achat HT connu à la création
 * @returns          Valeur à écrire dans `prix_achat_cump`
 */
function coutMoyenInitial(quantite: number, prixAchat: number): number {
  return quantite > 0 ? prixAchat : 0
}

/**
 * Nombre d'une cellule CSV, virgule décimale admise (export tableur français : « 12,50 »).
 * `parseFloat` seul lisait 12 — le coût moyen du stock initial en héritait.
 *
 * @param brut  Contenu de la cellule, absent permis
 * @returns     Le nombre, ou `NaN` si la cellule est vide ou illisible
 */
function nombreCsv(brut: string | undefined): number {
  return parseFloat((brut ?? '').trim().replace(',', '.'))
}

/**
 * Entier ≥ 0 d'une cellule CSV, strict : « 3 » oui ; « -3 », « 2.5 », « abc », « 0x10 » non.
 *
 * @param brut    Contenu de la cellule, absent permis
 * @param defaut  Valeur d'une cellule vide ou absente
 * @returns       L'entier, `defaut` si vide, `null` si invalide (la ligne doit être ignorée)
 */
function entierCsv(brut: string | undefined, defaut: number): number | null {
  const texte = (brut ?? '').trim()
  if (texte === '') return defaut
  return /^\d+$/.test(texte) ? Number(texte) : null
}

/**
 * Valeurs par défaut de stock de la boutique, telles que les chemins de création de ce fichier
 * les appliquent (`createProduit()`, `importCatalogueCsv()`). Seul lecteur de ces réglages sur
 * D1 brut — ces deux fonctions y restent pour `auditLog()` ; la résolution `NULL` → 0 est celle
 * de `resoudreDefautsStock()`, jamais un repli local.
 *
 * @param db          Instance D1Database
 * @param boutiqueId  Boutique dont on lit les réglages
 * @returns           `{ seuil_alerte, stock_initial }`, entiers ≥ 0 (0 si jamais réglé)
 */
async function lireDefautsStock(db: D1Database, boutiqueId: number): Promise<DefautsStockEffectifs> {
  return resoudreDefautsStock(
    await db.prepare('SELECT stock_seuil_defaut, stock_initial_defaut FROM boutique_settings WHERE boutique_id = ?')
      .bind(boutiqueId).first<DefautsStock>()
  )
}

/**
 * Crée un nouveau produit.
 * Si stock_actuel > 0, enregistre automatiquement un mouvement 'entree' (stock initial) et pose
 * le coût moyen (`prix_achat_cump`) au prix d'achat HT saisi ; sinon le coût moyen vaut 0.
 * Un seuil d'alerte absent prend le seuil par défaut de la boutique (`resoudreDefautsStock()`,
 * 0 = non surveillé si jamais réglé) ; un seuil explicite, même 0, l'emporte.
 *
 * @param db          — Instance D1Database
 * @param boutiqueId  — ID boutique
 * @param userId      — ID utilisateur (pour mouvement + audit)
 * @param data        — Données du produit (voir CreateProduitData)
 * @returns           — { id }
 */
export async function createProduit(
  db: D1Database,
  boutiqueId: number,
  userId: number,
  data: CreateProduitData,
  options: CreateProduitOptions = {}
): Promise<{ id: number }> {
  // Toute validation précède l'écriture : rien n'est inséré pour un prix ou une quantité refusés
  if (prixAchatNegatif(data.prix_achat_ht)) throw new Error(ERREUR_PRIX_ACHAT_NEGATIF)
  // Entier ≥ 0 exigé : un « abc » donnait NaN, que `NaN < 0` laissait passer ; 1.5 aussi
  if (data.stock_actuel != null && !estEntierPositifOuNul(Number(data.stock_actuel)))
    throw new Error(ERREUR_QUANTITE_DEPART_INVALIDE)

  // Seuil absent du corps → seuil d'alerte par défaut de la boutique (0 si jamais réglé), lu
  // seulement dans ce cas ; plus de repli 5 codé en dur (ticket 03 `reglages-stock-boutique`).
  // Un seuil explicite, même 0, l'emporte.
  const seuilAlerte = data.stock_minimum ?? (await lireDefautsStock(db, boutiqueId)).seuil_alerte

  const famille = FAMILLES.includes(data.famille as FamilleProduit)
    ? data.famille! : 'piece'

  const stockInitial = data.stock_actuel ?? 0

  // `description` et `fournisseur_id` en fin de liste : ajoutés au ticket 04 (import Mobilax),
  // ils ne décalent aucune colonne existante. `prix_achat_cump` de même (ticket 02
  // `reglages-stock-boutique`) : des pièces déjà en rayon valent leur prix d'achat au coût moyen
  // dès la création, au lieu de 0 € jusqu'à la première réception. Sans stock, 0 est écrit
  // explicitement — la même valeur que le `DEFAULT 0` de la colonne (migration 0014).
  // Un code-barres ou un SKU déjà porté est refusé par la base (migration 0048) : la violation
  // devient un refus qui nomme le produit existant (ticket 01 `vente-lit-catalogue`)
  const result = await db.prepare(`
    INSERT INTO produits
      (boutique_id, categorie_id, sku, nom, marque, famille, prix_achat_ht, prix_vente_ht, tva_taux,
       stock_actuel, stock_minimum, fournisseur, reference_fournisseur, code_barre, description, fournisseur_id,
       prix_achat_cump)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    boutiqueId,
    data.categorie_id          ?? null,
    data.sku                   ?? null,
    data.nom,
    data.marque                ?? null,
    famille,
    data.prix_achat_ht         ?? 0,
    data.prix_vente_ht         ?? 0,
    data.tva_taux              ?? 20,
    data.stock_actuel          ?? 0,
    seuilAlerte,
    data.fournisseur           ?? null,
    data.reference_fournisseur ?? null,
    data.code_barre            ?? null,
    data.description           ?? null,
    options.fournisseur_id     ?? null,
    coutMoyenInitial(stockInitial, data.prix_achat_ht ?? 0),
  ).first<{ id: number }>().catch(async (err) => {
    await leverSiCodeEnDoublon(db, err, data, { boutiqueId })
    throw err
  })

  const produitId = result!.id

  // Mouvement stock initial si stock de départ > 0
  if (stockInitial > 0) {
    await db.prepare(`
      INSERT INTO mouvements_stock
        (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, user_id, motif)
      VALUES (?, ?, 'entree', ?, 0, ?, ?, 'Stock initial')
    `).bind(produitId, boutiqueId, data.stock_actuel, data.stock_actuel, userId).run()
  }

  await auditLog(db, {
    boutique_id: boutiqueId,
    user_id:     userId,
    action:      'CREATE_PRODUIT',
    entite_type: 'produit',
    entite_id:   produitId,
  })

  return { id: produitId }
}

/**
 * Retrouve un produit déjà importé depuis une pièce fournisseur (ticket 04, import Mobilax) :
 * même boutique, même fiche fournisseur, même référence. Sert à refuser un second import,
 * qui éclaterait le stock et le coût d'une même pièce sur deux fiches.
 *
 * @param db             Port Database
 * @param boutiqueId     Boutique — filtre d'isolation porté par la requête elle-même
 * @param fournisseurId  Fiche fournisseur source
 * @param reference      Référence de la pièce chez le fournisseur
 * @returns              `{ id }` du produit existant, ou `null`
 */
export async function trouverProduitImporte(
  db: Database, boutiqueId: number, fournisseurId: number, reference: string
): Promise<{ id: number } | null> {
  return db.get<{ id: number }>(
    `SELECT id FROM produits
     WHERE boutique_id = ? AND fournisseur_id = ? AND reference_fournisseur = ? AND actif = 1 LIMIT 1`,
    [boutiqueId, fournisseurId, reference]
  )
}

/**
 * Références fournisseur déjà importées dans la boutique pour une fiche fournisseur — même clé
 * que `trouverProduitImporte()`, lue en une requête pour tout un aperçu (ticket 02
 * `import-par-generation`) au lieu d'une par article.
 *
 * @param db             Port Database
 * @param boutiqueId     Boutique — filtre d'isolation porté par la requête elle-même
 * @param fournisseurId  Fiche fournisseur source
 * @returns              Ensemble des `reference_fournisseur` des produits actifs
 */
export async function referencesImportees(
  db: Database, boutiqueId: number, fournisseurId: number
): Promise<Set<string>> {
  const lignes = await db.all<{ reference_fournisseur: string }>(
    `SELECT reference_fournisseur FROM produits
     WHERE boutique_id = ? AND fournisseur_id = ? AND actif = 1 AND reference_fournisseur IS NOT NULL`,
    [boutiqueId, fournisseurId]
  )
  return new Set(lignes.map(l => String(l.reference_fournisseur)))
}

/**
 * Retrouve le produit d'une boutique rattaché à une pièce Mobilax par son identifiant — la
 * reconnaissance d'un import qui ne doit **pas** rappeler le fournisseur (ticket 18
 * `vente-lit-catalogue`, décision du 2026-09-24) : la référence Mobilax n'est que sur la fiche
 * complète, l'identifiant est ce que l'écran envoie déjà. Colonne posée par la migration 0050.
 *
 * @param db          Port Database
 * @param boutiqueId  Boutique — filtre d'isolation porté par la requête elle-même
 * @param mobilaxId   Identifiant de la pièce chez Mobilax
 * @returns           `{ id }` du produit actif rattaché, ou `null`
 */
export async function trouverProduitParMobilaxId(
  db: Database, boutiqueId: number, mobilaxId: number
): Promise<{ id: number } | null> {
  return db.get<{ id: number }>(
    'SELECT id FROM produits WHERE boutique_id = ? AND mobilax_id = ? AND actif = 1 LIMIT 1',
    [boutiqueId, mobilaxId]
  )
}

/** Ce qu'un produit reçoit quand il est reconnu comme une pièce Mobilax. */
export interface RattachementMobilax {
  fournisseur_id:  number
  fournisseur_nom: string
  /** Vraie référence Mobilax (`reference_fournisseur`). */
  reference:       string
  mobilax_id:      number
}

/**
 * Rattache un produit existant à sa pièce Mobilax : fiche fournisseur, référence et identifiant,
 * pour que les imports suivants le reconnaissent sans appel au fournisseur (ticket 18).
 *
 * Jamais d'écrasement : une colonne déjà remplie n'est pas réécrite (le nom de fournisseur saisi à
 * la main reste), et un produit déjà lié à une **autre** pièce ou déjà porteur d'un identifiant
 * Mobilax est laissé tel quel. Pas de rattachement non plus si la référence est déjà portée par un
 * autre produit de la boutique (contrainte 0046) — vérifié dans la même requête, sans course.
 *
 * @param db          Port Database
 * @param boutiqueId  Boutique — le produit doit lui appartenir
 * @param produitId   Produit à rattacher
 * @param source      Fiche fournisseur, référence et identifiant Mobilax de la pièce
 * @returns           `true` si le produit a été rattaché, `false` s'il est resté tel quel
 */
export async function rattacherProduitMobilax(
  db: Database, boutiqueId: number, produitId: number, source: RattachementMobilax
): Promise<boolean> {
  try {
    const r = await db.run(
      `UPDATE produits SET
         fournisseur_id        = COALESCE(fournisseur_id, ?),
         reference_fournisseur = COALESCE(reference_fournisseur, ?),
         fournisseur           = COALESCE(fournisseur, ?),
         mobilax_id            = ?,
         updated_at            = CURRENT_TIMESTAMP
       WHERE id = ? AND boutique_id = ? AND actif = 1
         AND mobilax_id IS NULL
         AND (fournisseur_id IS NULL OR fournisseur_id = ?)
         AND (reference_fournisseur IS NULL OR reference_fournisseur = ?)
         AND NOT EXISTS (
           SELECT 1 FROM produits autre
           WHERE autre.boutique_id = ? AND autre.fournisseur_id = ? AND autre.reference_fournisseur = ?
             AND autre.actif = 1 AND autre.id <> ?
         )`,
      [
        source.fournisseur_id, source.reference, source.fournisseur_nom, source.mobilax_id,
        produitId, boutiqueId,
        source.fournisseur_id, source.reference,
        boutiqueId, source.fournisseur_id, source.reference, produitId,
      ]
    )
    return r.changes > 0
  } catch (err) {
    // Course : un autre import a posé cet identifiant Mobilax entre-temps (index 0050). Le
    // produit reste tel quel ; toute autre erreur remonte.
    // AVANT (2026-09-25, point 2 de la relecture : toute violation d'unicité passait pour la course — une violation 0046 aurait été tue) : if (/UNIQUE constraint failed/.test(String((err as Error)?.message))) return false
    // Seules les colonnes de `idx_produits_mobilax_id` (0050), dans l'ordre où SQLite les nomme
    if (/UNIQUE constraint failed: produits\.boutique_id, produits\.mobilax_id\b/.test(String((err as Error)?.message))) return false
    throw err
  }
}

/**
 * Reprend la description du fournisseur sur un produit existant **seulement si la sienne est
 * vide** — les notes saisies à la main ne sont jamais écrasées (ticket 18).
 *
 * @param db           Port Database
 * @param boutiqueId   Boutique — le produit doit lui appartenir
 * @param produitId    Produit à compléter
 * @param description  Description du fournisseur, déjà réduite en texte ; absente → rien à reprendre
 * @returns            `true` si la description a été posée
 */
export async function completerDescriptionSiVide(
  db: Database, boutiqueId: number, produitId: number, description: string | null
): Promise<boolean> {
  if (!description || !description.trim()) return false
  const r = await db.run(
    `UPDATE produits SET description = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND boutique_id = ? AND actif = 1 AND (description IS NULL OR TRIM(description) = '')`,
    [description, produitId, boutiqueId]
  )
  return r.changes > 0
}

/** Motif de l'entrée de stock écrite par « Ajouter N au stock » (ticket 18). */
export const MOTIF_AJOUT_PIECE_DEJA_EN_STOCK = 'Import fournisseur — déjà en stock'

/**
 * Clé d'ajout acceptée : ce que tire `crypto.randomUUID()` à l'écran, avec de la marge — lettres,
 * chiffres et tirets, 8 à 64 caractères. Rien d'autre n'entre dans `ajouts_stock_import`.
 */
export const MOTIF_CLE_AJOUT = /^[A-Za-z0-9-]{8,64}$/

/** Résultat de « Ajouter N au stock » : l'ajout (fait maintenant ou déjà fait) ou le refus d'une clé. */
export type ResultatAjoutStock =
  | { stock_avant: number; stock_apres: number; deja_applique: boolean }
  | { erreur: 'cle_reutilisee' | 'cle_en_cours' }

/**
 * Ajoute une quantité à une pièce fournisseur déjà en stock, par **une** entrée tracée — le geste
 * explicite que l'import n'accomplit jamais tout seul (règle du 2026-09-12).
 *
 * **Idempotent par clé** (migration 0051, point 1 de la relecture du 2026-09-24) : la clé tirée par
 * l'écran est réservée dans `ajouts_stock_import` AVANT le mouvement. Rejouée (réponse perdue,
 * second clic), elle rend le premier résultat sans rien rajouter. Une clé réservée dont l'ajout n'a
 * pas abouti n'est jamais libérée : `enregistrerMouvement()` écrit le stock avant le journal, un
 * nouvel essai pourrait doubler un stock déjà bougé — on répond `cle_en_cours`.
 *
 * @param db          Port Database
 * @param boutiqueId  Boutique appelante — le produit doit lui appartenir
 * @param userId      Utilisateur qui ajoute (mouvement)
 * @param produitId   Produit déjà en stock
 * @param quantite    Entier ≥ 1
 * @param cle         Clé d'ajout de l'offre (`MOTIF_CLE_AJOUT`)
 * @returns           Ancien et nouveau stock (`deja_applique` si la clé avait déjà servi), un refus
 *                    de clé, ou `null` si le produit n'est pas de cette boutique
 * @throws            Error si la quantité n'est pas un entier ≥ 1 ou si la clé est mal formée
 */
// AVANT (2026-09-25, point 1 : clé d'ajout) : export async function ajouterStockPieceImportee(
// AVANT (2026-09-25, point 1 : clé d'ajout) :   db: Database, boutiqueId: number, userId: number, produitId: number, quantite: number
// AVANT (2026-09-25, point 1 : clé d'ajout) : ): Promise<{ stock_avant: number; stock_apres: number } | null> {
export async function ajouterStockPieceImportee(
  db: Database, boutiqueId: number, userId: number, produitId: number, quantite: number, cle: string
): Promise<ResultatAjoutStock | null> {
  if (!Number.isInteger(quantite) || quantite < 1)
    throw new Error('La quantité à ajouter doit être un entier supérieur ou égal à 1.')
  if (typeof cle !== 'string' || !MOTIF_CLE_AJOUT.test(cle))
    throw new Error('Clé d\'ajout invalide.')
  const produit = await db.get<{ id: number }>(
    'SELECT id FROM produits WHERE id = ? AND boutique_id = ? AND actif = 1',
    [produitId, boutiqueId]
  )
  if (!produit) return null
  // AVANT (2026-09-25, point 1 : le mouvement ne part qu'une fois la clé réservée) : return enregistrerMouvement(db, produitId, userId, {
  // AVANT (2026-09-25, point 1) :   type_mouvement: 'entree', quantite, motif: MOTIF_AJOUT_PIECE_DEJA_EN_STOCK,
  // AVANT (2026-09-25, point 1) : })

  // Réservation : la clé primaire (boutique_id, cle) ne laisse passer qu'une requête, course comprise
  const reservation = await db.run(
    `INSERT OR IGNORE INTO ajouts_stock_import (boutique_id, cle, produit_id, quantite, user_id)
     VALUES (?, ?, ?, ?, ?)`,
    [boutiqueId, cle, produitId, quantite, userId]
  )
  if (reservation.changes === 0) {
    const deja = await db.get<{ produit_id: number; quantite: number; stock_avant: number | null; stock_apres: number | null }>(
      'SELECT produit_id, quantite, stock_avant, stock_apres FROM ajouts_stock_import WHERE boutique_id = ? AND cle = ?',
      [boutiqueId, cle]
    )
    // Une clé ne vaut que pour l'offre qui l'a tirée : même produit, même quantité
    if (!deja || deja.produit_id !== produitId || deja.quantite !== quantite) return { erreur: 'cle_reutilisee' }
    if (deja.stock_avant === null || deja.stock_apres === null) return { erreur: 'cle_en_cours' }
    return { stock_avant: deja.stock_avant, stock_apres: deja.stock_apres, deja_applique: true }
  }

  const r = await enregistrerMouvement(db, produitId, userId, {
    type_mouvement: 'entree', quantite, motif: MOTIF_AJOUT_PIECE_DEJA_EN_STOCK,
  })
  await db.run(
    'UPDATE ajouts_stock_import SET stock_avant = ?, stock_apres = ? WHERE boutique_id = ? AND cle = ?',
    [r.stock_avant, r.stock_apres, boutiqueId, cle]
  )
  return { ...r, deja_applique: false }
}

/**
 * Catégorie de la boutique portant ce nom — créée si elle n'existe pas (import Mobilax : la
 * catégorie locale reçoit le nom de la catégorie Mobilax, décision du 2026-09-11).
 *
 * @param db          Port Database
 * @param boutiqueId  Boutique — la catégorie trouvée ou créée lui appartient exclusivement
 * @param nom         Nom exact de la catégorie
 * @returns           `{ id }` de la catégorie existante ou créée
 */
export async function trouverOuCreerCategorie(
  db: Database, boutiqueId: number, nom: string
): Promise<{ id: number }> {
  const existante = await db.get<{ id: number }>(
    'SELECT id FROM categories WHERE boutique_id = ? AND nom = ? AND actif = 1 LIMIT 1',
    [boutiqueId, nom]
  )
  return existante ?? createCategorie(db, boutiqueId, { nom })
}

/**
 * Met à jour les champs éditables d'un produit (hors stock_actuel, géré par enregistrerMouvement).
 *
 * @param db      — Instance D1Database
 * @param id      — ID du produit
 * @param userId  — ID utilisateur (pour audit)
 * @param data    — Champs à modifier (voir UpdateProduitData)
 * @throws        — Error si produit introuvable
 */
export async function updateProduit(
  db: D1Database,
  id: number,
  userId: number,
  data: UpdateProduitData
): Promise<void> {
  if (prixAchatNegatif(data.prix_achat_ht)) throw new Error(ERREUR_PRIX_ACHAT_NEGATIF)

  const existing = await db
    .prepare('SELECT id FROM produits WHERE id = ? AND actif = 1')
    .bind(id)
    .first()
  if (!existing) throw new Error('Produit introuvable.')

  const familleUpd = data.famille && FAMILLES.includes(data.famille as FamilleProduit)
    ? data.famille : null

  await db.prepare(`
    UPDATE produits SET
      nom          = COALESCE(?, nom),
      sku          = COALESCE(?, sku),
      marque       = COALESCE(?, marque),
      categorie_id = COALESCE(?, categorie_id),
      famille      = COALESCE(?, famille),
      prix_achat_ht= COALESCE(?, prix_achat_ht),
      prix_vente_ht= COALESCE(?, prix_vente_ht),
      tva_taux     = COALESCE(?, tva_taux),
      stock_minimum= COALESCE(?, stock_minimum),
      fournisseur  = COALESCE(?, fournisseur),
      code_barre   = COALESCE(?, code_barre),
      description  = COALESCE(?, description),
      updated_at   = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    data.nom          ?? null,
    data.sku          ?? null,
    data.marque       ?? null,
    data.categorie_id ?? null,
    familleUpd,
    data.prix_achat_ht ?? null,
    data.prix_vente_ht ?? null,
    data.tva_taux      ?? null,
    data.stock_minimum ?? null,
    data.fournisseur  ?? null,
    data.code_barre   ?? null,
    // « Notes » de la fiche : même COALESCE que le reste (absent = conservé)
    data.description  ?? null,
    id,
  ).run().catch(async (err) => {
    // Code-barres ou SKU déjà porté par un autre produit (migration 0048) → refus nommant ce produit
    await leverSiCodeEnDoublon(db, err, data, { produitId: id })
    throw err
  })

  await auditLog(db, {
    user_id:     userId,
    action:      'UPDATE_PRODUIT',
    entite_type: 'produit',
    entite_id:   id,
  })
}

/**
 * Soft-delete un produit (actif = 0).
 *
 * @param db      — Instance D1Database
 * @param id      — ID du produit
 * @param userId  — ID utilisateur (pour audit)
 */
export async function deleteProduit(
  db: D1Database,
  id: number,
  userId: number
): Promise<void> {
  await db
    .prepare('UPDATE produits SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(id)
    .run()

  await auditLog(db, {
    user_id:     userId,
    action:      'DELETE_PRODUIT',
    entite_type: 'produit',
    entite_id:   id,
  })
}

/**
 * Enregistre un mouvement de stock et met à jour stock_actuel du produit.
 *
 * Types de mouvement :
 *   - 'entree'     : quantite ajoutée au stock
 *   - 'sortie'     : quantite retirée du stock
 *   - 'ajustement' : quantite = valeur absolue cible (correction inventaire)
 *   - 'inventaire' : identique à ajustement
 *
 * @param db        — Port Database
 * @param produitId — ID du produit concerné
 * @param userId    — ID utilisateur
 * @param m         — Données du mouvement (voir MouvementData)
 * @returns         — { stock_avant, stock_apres }
 * @throws          — Error si type invalide, stock insuffisant ou produit introuvable
 */
export async function enregistrerMouvement(
  db: Database,
  produitId: number,
  userId: number,
  m: MouvementData
): Promise<{ stock_avant: number; stock_apres: number }> {
  if (!TYPES_MOUVEMENT_VALIDES.includes(m.type_mouvement)) {
    throw new Error(`type_mouvement invalide. Valeurs acceptées : ${TYPES_MOUVEMENT_VALIDES.join(', ')}.`)
  }
  if (m.quantite === 0) {
    throw new Error('quantite doit être différente de 0.')
  }

  const produit = await db.get<{ id: number; stock_actuel: number; boutique_id: number }>(
    'SELECT id, stock_actuel, boutique_id FROM produits WHERE id = ? AND actif = 1',
    [produitId]
  )
  if (!produit) throw new Error('Produit introuvable.')

  const estAjustement = m.type_mouvement === 'ajustement' || m.type_mouvement === 'inventaire'
  const delta         = m.type_mouvement === 'sortie' ? -Math.abs(m.quantite) : Math.abs(m.quantite)
  const stockApres    = estAjustement ? m.quantite : produit.stock_actuel + delta

  if (stockApres < 0) {
    throw new Error(`Stock insuffisant. Stock actuel : ${produit.stock_actuel}.`)
  }

  // Quantité réelle pour l'historique (delta effectif sur ajustement)
  const mouvQuantite = estAjustement ? stockApres - produit.stock_actuel : delta

  await db.run(
    'UPDATE produits SET stock_actuel = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [stockApres, produitId]
  )

  await db.run(`
    INSERT INTO mouvements_stock
      (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, ticket_id, user_id, motif)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    produitId,
    produit.boutique_id,
    m.type_mouvement,
    mouvQuantite,
    produit.stock_actuel,
    stockApres,
    m.ticket_id ?? null,
    userId,
    m.motif     ?? null,
  ])

  return { stock_avant: produit.stock_actuel, stock_apres: stockApres }
}

/**
 * Liste les catégories d'une boutique avec le nombre de produits actifs par catégorie.
 * Ordre : racines (parent_id NULL) en premier, puis alphabétique.
 *
 * @param db          — Port Database
 * @param boutiqueId  — ID boutique
 * @returns           — Tableau de catégories avec nb_produits
 */
export async function listCategories(
  db: Database,
  boutiqueId: number
): Promise<any[]> {
  const rows = await db.all<any>(`
    SELECT c.*, COUNT(p.id) AS nb_produits
    FROM   categories c
    LEFT JOIN produits p ON p.categorie_id = c.id AND p.actif = 1
    WHERE  c.boutique_id = ? AND c.actif = 1
    GROUP  BY c.id
    ORDER  BY c.parent_id NULLS FIRST, c.nom
  `, [boutiqueId])

  return rows ?? []
}

/**
 * Crée une nouvelle catégorie de produits.
 *
 * @param db          — Port Database
 * @param boutiqueId  — ID boutique
 * @param data        — { nom, parent_id? }
 * @returns           — { id }
 */
export async function createCategorie(
  db: Database,
  boutiqueId: number,
  data: CreateCategorieData
): Promise<{ id: number }> {
  const result = await db.get<{ id: number }>(
    'INSERT INTO categories (boutique_id, nom, parent_id) VALUES (?, ?, ?) RETURNING id',
    [boutiqueId, data.nom, data.parent_id ?? null]
  )

  return { id: result!.id }
}

/**
 * Calcule les KPIs de stock d'une boutique.
 *
// ─── Import catalogue CSV ─────────────────────────────────────────────────────

/**
 * Parse et importe un catalogue produits depuis un CSV fournisseur.
 *
 * Format CSV (1ère ligne = en-têtes, séparateur , ou ;) :
 *   sku, nom, prix_achat_ht, prix_vente_ht, stock_actuel, stock_minimum, famille, tva_taux, marque,
 *   fournisseur
 *
 * Règles métier :
 *   - SKU connu → UPDATE (nom, prix, famille, fournisseur) + ajustement stock si différent
 *   - SKU absent/inconnu → INSERT nouveau produit (ticket 04 `reglages-stock-boutique`) :
 *       · `stock_minimum` vide → seuil d'alerte par défaut de la boutique ; rempli → sa valeur,
 *         même 0 ; rempli mais pas un entier ≥ 0 → ligne ignorée
 *       · `stock_actuel` vide → 0, aucun mouvement ; > 0 → mouvement « Stock initial » et coût moyen
 *         (`prix_achat_cump`) au prix d'achat de la ligne ; rempli mais pas un entier ≥ 0 →
 *         ligne ignorée (jamais de stock fictif)
 *   - Prix et TVA : virgule décimale admise (« 12,50 »), pour tous les chemins
 *   - Colonne obligatoire : nom
 *   - Famille validée contre FAMILLES, défaut 'piece' si invalide
 *   - Limite 500 lignes par import (anti-abus)
 */
export async function importCatalogueCsv(
  db:         D1Database,
  boutiqueId: number,
  userId:     number,
  csvText:    string
): Promise<{ imported: number; updated: number; skipped: number; errors: string[] }> {
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (lines.length < 2) throw new Error('CSV vide ou sans données.')

  const sep = lines[0].includes(';') ? ';' : ','

  function parseLine(line: string): string[] {
    const fields: string[] = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = !inQ
      } else if (ch === sep && !inQ) {
        fields.push(cur.trim()); cur = ''
      } else {
        cur += ch
      }
    }
    fields.push(cur.trim())
    return fields
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/^\uFEFF/, '').trim())
  const idx     = (name: string) => headers.indexOf(name)

  const iSku     = idx('sku')
  const iNom     = idx('nom')
  const iPaHt    = idx('prix_achat_ht')
  const iPvHt    = idx('prix_vente_ht')
  const iStock   = idx('stock_actuel')
  const iFamille = idx('famille')
  const iTva     = idx('tva_taux')
  const iMarque  = idx('marque')
  const iFourn   = idx('fournisseur')
  const iSeuil   = idx('stock_minimum')

  if (iNom === -1) throw new Error('Colonne "nom" obligatoire introuvable dans le CSV.')

  // Réglages lus une fois pour tout le fichier : une ligne sans seuil prend le seuil par défaut
  const defauts = await lireDefautsStock(db, boutiqueId)

  const dataLines = lines.slice(1).filter(l => l.trim() !== '').slice(0, 500)

  let imported = 0, updated = 0, skipped = 0
  const errors: string[] = []

  for (let li = 0; li < dataLines.length; li++) {
    const row = parseLine(dataLines[li])
    const num = li + 2

    try {
      const nom = row[iNom]?.trim()
      if (!nom) { skipped++; errors.push(`Ligne ${num} : nom manquant — ignorée.`); continue }

      const sku     = iSku    >= 0 && row[iSku]?.trim()   ? row[iSku].trim()  : null
      const paHt    = iPaHt   >= 0 ? nombreCsv(row[iPaHt]) || 0  : 0
      if (prixAchatNegatif(paHt)) { skipped++; errors.push(`Ligne ${num} : prix d'achat négatif — ignorée.`); continue }
      const pvHt    = iPvHt   >= 0 ? nombreCsv(row[iPvHt]) || 0  : 0
      const stock   = iStock  >= 0 ? parseInt(row[iStock]   ?? '0', 10) || 0 : 0
      const tva     = iTva    >= 0 ? nombreCsv(row[iTva]) || 20 : 20
      const marque  = iMarque >= 0 ? row[iMarque]?.trim() || null : null
      const fourn   = iFourn  >= 0 ? row[iFourn]?.trim()  || null : null
      const famRaw  = iFamille >= 0 ? row[iFamille]?.trim().toLowerCase() : ''
      const famille = FAMILLES.includes(famRaw as FamilleProduit) ? (famRaw as FamilleProduit) : 'piece'

      if (sku) {
        const existing = await db
          .prepare('SELECT id, stock_actuel FROM produits WHERE boutique_id = ? AND sku = ? AND actif = 1 LIMIT 1')
          .bind(boutiqueId, sku)
          .first<{ id: number; stock_actuel: number }>()

        if (existing) {
          await db.prepare(`
            UPDATE produits SET
              nom           = ?,
              famille       = ?,
              prix_achat_ht = ?,
              prix_vente_ht = ?,
              tva_taux      = ?,
              marque        = COALESCE(?, marque),
              fournisseur   = COALESCE(?, fournisseur),
              updated_at    = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(nom, famille, paHt, pvHt, tva, marque, fourn, existing.id).run()

          if (stock > 0 && stock !== existing.stock_actuel) {
            await db.prepare(`
              INSERT INTO mouvements_stock
                (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, user_id, motif)
              VALUES (?, ?, 'inventaire', ?, ?, ?, ?, 'Import catalogue CSV')
            `).bind(existing.id, boutiqueId, stock - existing.stock_actuel,
                    existing.stock_actuel, stock, userId).run()
            await db.prepare('UPDATE produits SET stock_actuel = ? WHERE id = ?')
              .bind(stock, existing.id).run()
          }

          updated++
          continue
        }
      }

      // Seuil d'alerte du nouveau produit — lu ici, après la mise à jour d'un produit existant,
      // qui n'est pas concernée (ticket 04). Colonne vide → réglage ; remplie → sa valeur.
      const seuil = entierCsv(iSeuil >= 0 ? row[iSeuil] : undefined, defauts.seuil_alerte)
      if (seuil === null) { skipped++; errors.push(`Ligne ${num} : seuil d'alerte invalide — ignorée.`); continue }

      // Quantité du nouveau produit : vide → 0 ; remplie → entier ≥ 0, sinon ligne ignorée — un
      // « -3 » insérait un stock négatif sans mouvement, un « abc » devenait 0 en silence (story 20)
      const qte = entierCsv(iStock >= 0 ? row[iStock] : undefined, 0)
      if (qte === null) { skipped++; errors.push(`Ligne ${num} : quantité invalide — ignorée.`); continue }

      // INSERT nouveau produit — coût moyen au prix d'achat de la ligne si des pièces sont
      // déclarées (valeur du stock juste dès l'import), 0 sinon (`DEFAULT` de la colonne)
      const res = await db.prepare(`
        INSERT INTO produits
          (boutique_id, sku, nom, marque, famille, prix_achat_ht, prix_vente_ht,
           tva_taux, stock_actuel, stock_minimum, fournisseur, prix_achat_cump)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `).bind(boutiqueId, sku, nom, marque, famille, paHt, pvHt, tva, qte, seuil, fourn,
              coutMoyenInitial(qte, paHt))
        .first<{ id: number }>()

      // Motif « Stock initial », commun à tous les chemins de création (decisions.md, story 25 —
      // tranché le 2026-09-12) ; la mise à jour d'un SKU existant garde « Import catalogue CSV »
      if (res && qte > 0) {
        await db.prepare(`
          INSERT INTO mouvements_stock
            (produit_id, boutique_id, type_mouvement, quantite, stock_avant, stock_apres, user_id, motif)
          VALUES (?, ?, 'entree', ?, 0, ?, ?, 'Stock initial')
        `).bind(res.id, boutiqueId, qte, qte, userId).run()
      }

      imported++
    } catch (e: any) {
      skipped++
      errors.push(`Ligne ${num} : ${e.message}`)
    }
  }

  await auditLog(db, {
    boutique_id: boutiqueId,
    user_id:     userId,
    action:      'IMPORT_CATALOGUE_CSV',
    entite_type: 'produit',
    details:     JSON.stringify({ imported, updated, skipped }),
  })

  return { imported, updated, skipped, errors }
}

// ─── KPIs stock ───────────────────────────────────────────────────────────────

/**
 * @param db          — Port Database
 * @param boutiqueId  — ID boutique
 * @returns           — { nb_produits, nb_ruptures, nb_alertes, valeur_stock_ht, valeur_stock_cump }
 */
export async function getKpisStock(
  db: Database,
  boutiqueId: number
): Promise<KpisStock> {
  const row = await db.get<any>(`
    SELECT
      COUNT(*)                                                         AS nb_produits,
      SUM(CASE WHEN stock_actuel = 0 THEN 1 ELSE 0 END)               AS nb_ruptures,
      SUM(CASE WHEN stock_actuel > 0
               AND ${sqlSousSeuil()} THEN 1 ELSE 0 END)                AS nb_alertes,
      ROUND(SUM(stock_actuel * prix_achat_ht), 2)                     AS valeur_stock_ht,
      ROUND(SUM(stock_actuel * prix_achat_cump), 2)                   AS valeur_stock_cump
    FROM produits
    WHERE boutique_id = ? AND actif = 1
  `, [boutiqueId])

  return {
    nb_produits:       row?.nb_produits      ?? 0,
    nb_ruptures:       row?.nb_ruptures       ?? 0,
    nb_alertes:        row?.nb_alertes        ?? 0,
    valeur_stock_ht:   row?.valeur_stock_ht   ?? 0,
    valeur_stock_cump: row?.valeur_stock_cump ?? 0,
  }
}
