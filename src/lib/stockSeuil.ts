/**
 * @file src/lib/stockSeuil.ts
 * @description Règle unique du seuil d'alerte de stock — « ce produit est-il sous son seuil ? ».
 *
 * **Un seuil à 0 signifie « produit non surveillé »** (décision du 2026-09-12, `decisions.md`) :
 * il n'alerte jamais, quel que soit le stock. Sans cette règle, toute pièce Mobilax importée
 * (stock 0, seuil 0) apparaissait « à commander » dès l'import, puisque 0 ≤ 0. Un seuil > 0
 * garde la règle historique `stock ≤ seuil`, rupture comprise.
 *
 * La rupture (stock 0) reste un **état** affiché à part (badge, compteur `nb_ruptures`) : ce
 * fragment ne dit que si le produit est à commander.
 *
 * Toute requête sur ce sujet passe par ici — `tests/stock-sous-seuil.test.ts` fait échouer la
 * suite si une comparaison `stock_actuel <= stock_minimum` est réécrite à la main ailleurs.
 */

/**
 * Condition SQL « produit sous son seuil d'alerte », à insérer dans un `WHERE` ou un `CASE`.
 *
 * @param alias  Alias de la table `produits` dans la requête (`'p'`), omis sans alias
 * @returns      Fragment parenthésé, sans paramètre lié
 */
export function sqlSousSeuil(alias?: string): string {
  const p = alias ? `${alias}.` : ''
  return `(${p}stock_minimum > 0 AND ${p}stock_actuel <= ${p}stock_minimum)`
}
