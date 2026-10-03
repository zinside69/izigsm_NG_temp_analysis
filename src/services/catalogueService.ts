/**
 * catalogueService.ts — Recherche catalogue unifiée (chantier `vente-lit-catalogue`, tickets 02-03)
 *
 * Point d'entrée unique des sélecteurs de vente : la caisse aujourd'hui, les lignes de ticket
 * au lot 2. Les résultats sont **typés** (`type`) pour que les types suivants (ticket, IMEI)
 * s'ajoutent sans changer le contrat de lecture.
 *
 * Couvre :
 *   - produits actifs par nom, SKU **et code-barres** (ticket 02 — le code-barres n'était lu par
 *     aucune recherche avant lui) ;
 *   - services actifs par nom et référence (ticket 03).
 */

import type { Database } from '../ports/database'

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Plafond de résultats d'une recherche : un sélecteur n'affiche pas une liste complète. */
export const PLAFOND_RECHERCHE_CATALOGUE = 20

/** Un produit trouvé, avec ce qu'il faut pour préremplir une ligne de vente. */
export interface ResultatProduit {
  type:          'produit'
  id:            number
  nom:           string
  sku:           string | null
  code_barre:    string | null
  prix_vente_ht: number
  tva_taux:      number
  stock_actuel:  number
  /**
   * Prix HT de la vente la plus récente de ce produit (facture émise non annulée de la boutique),
   * `null` s'il n'a jamais été vendu. L'écran le prend quand la fiche est à 0 (recette 002 D).
   */
  dernier_prix_vendu_ht: number | null
}

/**
 * Sous-requête du dernier prix vendu d'un produit (recette 002 D, 2026-10-03) — seule définition,
 * partagée par les quatre lectures de produits. Même périmètre que les favoris : factures émises
 * (`locked = 1`) non annulées, **de la boutique de la fiche** (isolation), ligne la plus récente.
 * @param alias  Table ou alias des produits dans la requête appelante
 */
function sqlDernierPrixVendu(alias: string): string {
  // Lecture : « le prix unitaire HT de la ligne de facture la plus récente qui vend ce produit ».
  // Les noms `ligne_vendue` / `facture_vendue` évitent toute confusion avec les tables de la
  // requête appelante (`ld`, `f` dans les favoris).
  return `(
    SELECT ligne_vendue.prix_unitaire_ht
    FROM   lignes_document AS ligne_vendue
    JOIN   factures        AS facture_vendue ON facture_vendue.id = ligne_vendue.document_id
    WHERE  ligne_vendue.document_type   = 'facture'               -- une ligne de facture, pas de devis
      AND  ligne_vendue.produit_id      = ${alias}.id              -- ce produit
      AND  facture_vendue.boutique_id   = ${alias}.boutique_id     -- de la même boutique (isolation)
      AND  facture_vendue.locked        = 1                        -- facture émise (pas un brouillon)
      AND  facture_vendue.statut       <> 'annulee'                -- et pas annulée
    ORDER  BY facture_vendue.issued_at DESC, ligne_vendue.id DESC  -- la plus récente d'abord
    LIMIT  1
  ) AS dernier_prix_vendu_ht`
}

/** Un service (prestation) trouvé, avec ce qu'il faut pour préremplir une ligne de vente. */
export interface ResultatService {
  type:      'service'
  id:        number
  nom:       string
  reference: string | null
  prix_ht:   number
  tva_taux:  number
}

/** Un dossier SAV trouvé : le choisir l'ouvre, il n'ajoute rien à une vente. */
export interface ResultatSav {
  type:    'sav'
  id:      number
  numero:  string
  client:  string | null
  statut:  string
  motif:   string
}

export type ResultatCatalogue = ResultatProduit | ResultatService | ResultatSav

// ═══════════════════════════════════════════════════════════════════════════════
// Recherche
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cherche dans le catalogue d'une boutique.
 *
 * Chaque type est lu séparément puis le plafond est **réparti** : une recherche « film » qui
 * trouve vingt produits doit encore montrer la pose de film. Les résultats sont retenus à tour
 * de rôle par type, puis rendus groupés par type : produits et services triés par nom, dossiers
 * SAV du plus récent au plus ancien.
 *
 * @param db          Port Database
 * @param boutiqueId  Boutique consultée — aucune autre n'est lue
 * @param texte       Saisie de l'opérateur, déjà nettoyée
 * @returns           Au plus `PLAFOND_RECHERCHE_CATALOGUE` résultats typés
 */
export async function rechercherCatalogue(
  db:         Database,
  boutiqueId: number,
  texte:      string,
): Promise<ResultatCatalogue[]> {
  // « % » et « _ » sont des jokers de LIKE : un SKU qui en contient doit être cherché tel quel
  const motif = `%${texte.replace(/[\\%_]/g, c => '\\' + c)}%`

  const [produits, services, dossiers] = await Promise.all([
    chercherProduits(db, boutiqueId, motif),
    chercherServices(db, boutiqueId, motif),
    chercherDossiersSav(db, boutiqueId, motif),
  ])
  return repartirPlafond<ResultatCatalogue>([produits, services, dossiers])
}

/**
 * Cherche un article par un **code scanné** (ticket 04 — douchette) : égalité stricte sur le
 * code-barres **ou** le SKU, produits actifs de la boutique.
 *
 * Le SKU compte parce que la fiche produit n'a pas de champ code-barres : l'EAN du fournisseur y
 * est tapé comme SKU (décision de l'exploitant du 2026-09-30). ⊥ le `LIKE %…%` de
 * `rechercherCatalogue()` : un SKU qui *contient* les chiffres ne doit pas remonter.
 *
 * Plusieurs résultats restent possibles malgré l'index unique `0048` (l'EAN d'un produit peut être
 * le SKU d'un autre) : ils sont tous rendus, l'écran ne choisit jamais à la place du vendeur.
 *
 * @param db          Port Database
 * @param boutiqueId  Boutique consultée — aucune autre n'est lue
 * @param code        Code scanné, déjà nettoyé (`routerScan()`)
 * @returns           Au plus `PLAFOND_RECHERCHE_CATALOGUE` produits
 */
export async function rechercherParCode(
  db:         Database,
  boutiqueId: number,
  code:       string,
): Promise<ResultatCatalogue[]> {
  const lignes = await db.all<Omit<ResultatProduit, 'type'>>(`
    -- AVANT (2026-10-02, recette 002 D — dernier prix vendu) : SELECT id, nom, sku, code_barre, prix_vente_ht, tva_taux, stock_actuel
    SELECT id, nom, sku, code_barre, prix_vente_ht, tva_taux, stock_actuel, ${sqlDernierPrixVendu('produits')}
    FROM   produits
    WHERE  boutique_id = ? AND actif = 1
      AND  (code_barre = ? OR sku = ?)
    ORDER  BY nom ASC
    LIMIT  ?
  `, [boutiqueId, code, code, PLAFOND_RECHERCHE_CATALOGUE])

  return (lignes ?? []).map(versResultatProduit)
}

/**
 * Cherche un téléphone d'occasion par l'**IMEI** de sa fiche (ticket 07, story 21) : égalité
 * stricte, produits actifs de la boutique. L'IMEI arrive déjà contrôlé (`luhnValide()`, route) :
 * un IMEI faux ne lance aucune requête.
 *
 * @param db          Port Database
 * @param boutiqueId  Boutique consultée — aucune autre n'est lue
 * @param imei        IMEI à clé juste
 * @returns           Le produit trouvé (au plus un par boutique, index de 0054)
 */
export async function rechercherParImei(
  db:         Database,
  boutiqueId: number,
  imei:       string,
): Promise<ResultatCatalogue[]> {
  const lignes = await db.all<Omit<ResultatProduit, 'type'>>(`
    -- AVANT (2026-10-02, recette 002 D — dernier prix vendu) : SELECT id, nom, sku, code_barre, prix_vente_ht, tva_taux, stock_actuel
    SELECT id, nom, sku, code_barre, prix_vente_ht, tva_taux, stock_actuel, ${sqlDernierPrixVendu('produits')}
    FROM   produits
    WHERE  boutique_id = ? AND actif = 1 AND imei = ?
    ORDER  BY nom ASC
    LIMIT  ?
  `, [boutiqueId, imei, PLAFOND_RECHERCHE_CATALOGUE])

  return (lignes ?? []).map(versResultatProduit)
}

/** Mapping explicite d'une ligne produit : le contrat de sortie ne dépend pas des colonnes lues. */
function versResultatProduit(p: Omit<ResultatProduit, 'type'>): ResultatProduit {
  return {
    type:          'produit',
    id:            p.id,
    nom:           p.nom,
    sku:           p.sku,
    code_barre:    p.code_barre,
    prix_vente_ht: p.prix_vente_ht,
    tva_taux:      p.tva_taux,
    stock_actuel:  p.stock_actuel,
    dernier_prix_vendu_ht: p.dernier_prix_vendu_ht ?? null,
  }
}

async function chercherProduits(db: Database, boutiqueId: number, motif: string): Promise<ResultatProduit[]> {
  const lignes = await db.all<Omit<ResultatProduit, 'type'>>(`
    -- AVANT (2026-10-02, recette 002 D — dernier prix vendu) : SELECT id, nom, sku, code_barre, prix_vente_ht, tva_taux, stock_actuel
    SELECT id, nom, sku, code_barre, prix_vente_ht, tva_taux, stock_actuel, ${sqlDernierPrixVendu('produits')}
    FROM   produits
    WHERE  boutique_id = ? AND actif = 1
      AND  (nom LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\' OR code_barre LIKE ? ESCAPE '\\')
    ORDER  BY nom ASC
    LIMIT  ?
  `, [boutiqueId, motif, motif, motif, PLAFOND_RECHERCHE_CATALOGUE])

  // Mapping explicite : le contrat de sortie ne dépend pas des colonnes lues
  return (lignes ?? []).map(p => ({
    type:          'produit' as const,
    id:            p.id,
    nom:           p.nom,
    sku:           p.sku,
    code_barre:    p.code_barre,
    prix_vente_ht: p.prix_vente_ht,
    tva_taux:      p.tva_taux,
    stock_actuel:  p.stock_actuel,
    dernier_prix_vendu_ht: p.dernier_prix_vendu_ht ?? null,
  }))
}

async function chercherServices(db: Database, boutiqueId: number, motif: string): Promise<ResultatService[]> {
  const lignes = await db.all<Omit<ResultatService, 'type'>>(`
    SELECT id, nom, reference, prix_ht, tva_taux
    FROM   services
    WHERE  boutique_id = ? AND actif = 1
      AND  (nom LIKE ? ESCAPE '\\' OR reference LIKE ? ESCAPE '\\')
    ORDER  BY nom ASC
    LIMIT  ?
  `, [boutiqueId, motif, motif, PLAFOND_RECHERCHE_CATALOGUE])

  return (lignes ?? []).map(s => ({
    type:      'service' as const,
    id:        s.id,
    nom:       s.nom,
    reference: s.reference,
    prix_ht:   s.prix_ht,
    tva_taux:  s.tva_taux,
  }))
}

/**
 * Dossiers SAV actifs par numéro ou par client (prénom, nom, ou « prénom nom »). Le client est
 * joint sur sa boutique aussi : un `client_id` pendant vers une autre boutique ne doit rien révéler.
 */
async function chercherDossiersSav(db: Database, boutiqueId: number, motif: string): Promise<ResultatSav[]> {
  const lignes = await db.all<{
    id: number; numero: string; statut: string; motif: string
    client_prenom: string | null; client_nom: string | null
  }>(`
    SELECT s.id, s.numero, s.statut, s.motif, c.prenom AS client_prenom, c.nom AS client_nom
    FROM   sav_dossiers s
    LEFT   JOIN clients c ON c.id = s.client_id AND c.boutique_id = s.boutique_id
    WHERE  s.boutique_id = ? AND s.actif = 1
      AND  (s.numero LIKE ? ESCAPE '\\' OR c.nom LIKE ? ESCAPE '\\' OR c.prenom LIKE ? ESCAPE '\\'
            OR (c.prenom || ' ' || c.nom) LIKE ? ESCAPE '\\')
    ORDER  BY s.date_ouverture DESC
    LIMIT  ?
  `, [boutiqueId, motif, motif, motif, motif, PLAFOND_RECHERCHE_CATALOGUE])

  return (lignes ?? []).map(s => ({
    type:   'sav' as const,
    id:     s.id,
    numero: s.numero,
    client: [s.client_prenom, s.client_nom].filter(Boolean).join(' ') || null,
    statut: s.statut,
    motif:  s.motif,
  }))
}

/**
 * Retient au plus `PLAFOND_RECHERCHE_CATALOGUE` résultats, un de chaque liste à tour de rôle,
 * et les rend dans l'ordre des listes (chacune gardant son tri).
 */
function repartirPlafond<T>(listes: T[][]): T[] {
  const retenus = listes.map(() => 0)
  let total = 0
  while (total < PLAFOND_RECHERCHE_CATALOGUE) {
    let avance = false
    for (const [i, liste] of listes.entries()) {
      if (total < PLAFOND_RECHERCHE_CATALOGUE && retenus[i] < liste.length) {
        retenus[i]++; total++; avance = true
      }
    }
    if (!avance) break
  }
  return listes.flatMap((liste, i) => liste.slice(0, retenus[i]))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Favoris de la caisse
// ═══════════════════════════════════════════════════════════════════════════════

/** Nombre de tuiles « Favoris » de la fenêtre de vente (recette 001 A′ : 8 à 12). */
export const PLAFOND_FAVORIS_VENTE = 12

/** Période de vente lue pour les favoris, en jours. */
const PERIODE_FAVORIS_JOURS = 90

/**
 * Articles et services les plus vendus de la boutique sur 90 jours (recette 001 A′, décision de
 * l'exploitant du 2026-10-02) : tuiles « Favoris » de la fenêtre de vente.
 *
 * Source : lignes des factures **émises** (`locked = 1`, hors `annulee`) de la boutique, par
 * `produit_id` / `service_id` — une ligne libre ne compte pas. Classées par quantité vendue, puis
 * par nom. Rendues au format de la recherche (`ResultatProduit` / `ResultatService`) avec le prix
 * **courant** de la fiche : un clic ajoute la ligne comme un résultat de recherche. Fiche
 * désactivée exclue ; la fiche est jointe sur la boutique de la facture (isolation).
 *
 * @returns Au plus `PLAFOND_FAVORIS_VENTE` résultats ; `[]` pour une boutique sans historique
 */
export async function lireFavorisVente(
  db:         Database,
  boutiqueId: number,
): Promise<(ResultatProduit | ResultatService)[]> {
  const periode = `-${PERIODE_FAVORIS_JOURS} days`
  // Filtre commun aux deux lectures : facture émise, non annulée, de la boutique, sur la période
  const factureRetenue = `
        ld.document_type = 'facture'
    AND f.boutique_id = ? AND f.locked = 1 AND f.statut <> 'annulee'
    AND f.issued_at >= datetime('now', ?)`

  const [produits, services] = await Promise.all([
    db.all<Omit<ResultatProduit, 'type'> & { vendus: number }>(`
      -- AVANT (2026-10-02, recette 002 D) : SELECT p.id, p.nom, p.sku, p.code_barre, p.prix_vente_ht, p.tva_taux, p.stock_actuel,
      SELECT p.id, p.nom, p.sku, p.code_barre, p.prix_vente_ht, p.tva_taux, p.stock_actuel, ${sqlDernierPrixVendu('p')},
             SUM(ld.quantite) AS vendus
      FROM   lignes_document ld
      JOIN   factures f ON f.id = ld.document_id
      JOIN   produits p ON p.id = ld.produit_id AND p.boutique_id = f.boutique_id AND p.actif = 1
      WHERE  ${factureRetenue}
      GROUP  BY p.id
    `, [boutiqueId, periode]),
    db.all<Omit<ResultatService, 'type'> & { vendus: number }>(`
      SELECT s.id, s.nom, s.reference, s.prix_ht, s.tva_taux,
             SUM(ld.quantite) AS vendus
      FROM   lignes_document ld
      JOIN   factures f ON f.id = ld.document_id
      JOIN   services s ON s.id = ld.service_id AND s.boutique_id = f.boutique_id AND s.actif = 1
      WHERE  ${factureRetenue}
      GROUP  BY s.id
    `, [boutiqueId, periode]),
  ])

  // Mapping explicite : le contrat de sortie est celui de la recherche, sans `vendus`
  const tous = [
    ...(produits ?? []).map(p => ({ vendus: p.vendus, r: {
      type: 'produit' as const, id: p.id, nom: p.nom, sku: p.sku, code_barre: p.code_barre,
      prix_vente_ht: p.prix_vente_ht, tva_taux: p.tva_taux, stock_actuel: p.stock_actuel,
      dernier_prix_vendu_ht: p.dernier_prix_vendu_ht ?? null,
    } })),
    ...(services ?? []).map(s => ({ vendus: s.vendus, r: {
      type: 'service' as const, id: s.id, nom: s.nom, reference: s.reference,
      prix_ht: s.prix_ht, tva_taux: s.tva_taux,
    } })),
  ]
  return tous
    .sort((a, b) => b.vendus - a.vendus || a.r.nom.localeCompare(b.r.nom, 'fr'))
    .slice(0, PLAFOND_FAVORIS_VENTE)
    .map(x => x.r)
}
