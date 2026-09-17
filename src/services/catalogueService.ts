/**
 * catalogueService.ts — Recherche catalogue unifiée (chantier `vente-lit-catalogue`, ticket 02)
 *
 * Point d'entrée unique des sélecteurs de vente : la caisse aujourd'hui, les lignes de ticket
 * au lot 2. Les résultats sont **typés** (`type`) pour que les types suivants (service, dossier
 * SAV, ticket) s'ajoutent sans changer le contrat de lecture.
 *
 * Ce ticket ne couvre que les produits : nom, SKU **et code-barres** — ce dernier n'était lu par
 * aucune recherche avant lui (`listProduits()` cherche nom, SKU, marque).
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

export type ResultatCatalogue = ResultatProduit

// ═══════════════════════════════════════════════════════════════════════════════
// Recherche
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cherche dans le catalogue d'une boutique (produits actifs seulement).
 *
 * @param db          Port Database
 * @param boutiqueId  Boutique consultée — aucune autre n'est lue
 * @param texte       Saisie de l'opérateur (nom, SKU ou code-barres), déjà nettoyée
 * @returns           Au plus `PLAFOND_RECHERCHE_CATALOGUE` résultats typés, triés par nom
 */
export async function rechercherCatalogue(
  db:         Database,
  boutiqueId: number,
  texte:      string,
): Promise<ResultatCatalogue[]> {
  // « % » et « _ » sont des jokers de LIKE : un SKU qui en contient doit être cherché tel quel
  const motif = `%${texte.replace(/[\\%_]/g, c => '\\' + c)}%`
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
