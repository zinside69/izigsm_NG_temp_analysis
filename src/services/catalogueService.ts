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

async function chercherProduits(db: Database, boutiqueId: number, motif: string): Promise<ResultatProduit[]> {
  const lignes = await db.all<Omit<ResultatProduit, 'type'>>(`
    SELECT id, nom, sku, code_barre, prix_vente_ht, tva_taux, stock_actuel
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
