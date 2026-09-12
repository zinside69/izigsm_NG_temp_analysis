-- Migration 0046 — une pièce fournisseur n'existe qu'une fois par boutique (décision du
-- 2026-09-12, défaut trouvé en revue du ticket 04 Mobilax)
--
-- `importerProduitMobilax()` vérifie `deja_importe` (trouverProduitImporte) PUIS crée le
-- produit : deux clics simultanés passaient tous deux la vérification et créaient deux
-- produits pour la même pièce — stock et coût éclatés. Le bouton désactivé pendant l'import
-- ne réduisait que la fenêtre. Cet index la ferme au niveau de la base ; le service convertit
-- la violation en `deja_importe`, avec le produit du premier import.
--
-- Partiel, sur le même périmètre que la vérification applicative :
--   - `actif = 1` : un produit supprimé (soft delete) ne bloque pas une réimportation ;
--   - `fournisseur_id` / `reference_fournisseur` non nuls : seuls les imports posent
--     `fournisseur_id` (`createProduit()` ne le prend jamais du corps de requête) — les
--     produits saisis à la main ne sont pas contraints.
-- Clé préfixée par `boutique_id` : la même pièce reste importable par chaque boutique.
--
-- Prérequis : aucun doublon actif existant, sinon la création échoue (atomiquement, rien
-- n'est écrit). Contrôlé à 0 en local le 2026-09-12.

CREATE UNIQUE INDEX IF NOT EXISTS idx_produits_source_fournisseur
  ON produits(boutique_id, fournisseur_id, reference_fournisseur)
  WHERE actif = 1 AND fournisseur_id IS NOT NULL AND reference_fournisseur IS NOT NULL;
