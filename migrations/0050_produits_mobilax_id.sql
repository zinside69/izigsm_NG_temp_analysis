-- Migration 0050 — produits.mobilax_id : reconnaître une pièce Mobilax sans rappeler le fournisseur
-- (ticket 18 du chantier `vente-lit-catalogue`, décision de l'exploitant du 2026-09-24)
--
-- « Déjà en stock » doit se répondre sans aucun appel à Mobilax : le quota est partagé par toute la
-- boutique. La référence Mobilax, seule clé locale jusqu'ici (`reference_fournisseur`, index 0046),
-- n'existe que sur la fiche complète : la reconnaître coûte un appel. L'identifiant Mobilax, lui,
-- est ce que la recherche et l'écran envoient déjà.
--
-- Colonne nullable, sans défaut : un produit venu d'ailleurs, ou importé avant cette migration, n'en
-- porte pas ; le premier import qui le reconnaît (référence, code-barres, SKU) la pose. Pas de reprise.
--
-- Index unique partiel, même patron que 0046 et 0048 : par boutique, produits actifs, identifiant non
-- nul. Une pièce Mobilax n'est portée qu'une fois par boutique. Création sans risque : colonne vide.
--
-- ⚠ Cette migration part À DISTANCE avant le code (CLAUDE.md § Déploiement) : le code lit et écrit
-- mobilax_id dans l'import Mobilax ; sans la colonne, tout import échoue en « no such column ».

ALTER TABLE produits ADD COLUMN mobilax_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_produits_mobilax_id
  ON produits(boutique_id, mobilax_id)
  WHERE actif = 1 AND mobilax_id IS NOT NULL;
