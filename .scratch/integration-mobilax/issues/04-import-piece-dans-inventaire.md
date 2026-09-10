# 04 — Import d'une pièce trouvée dans l'inventaire (Stock)

**What to build:** depuis un résultat de recherche Mobilax, un bouton « Importer » crée un
produit local dans le stock de la boutique, lié à sa source Mobilax, avec le prix Mobilax comme
coût de référence. L'opérateur garde la main sur le prix de vente et la quantité après import —
rien n'est imposé par l'import.

**Blocked by:** 03 — Recherche Mobilax dans Stock (sans import)

**Status:** ready-for-agent

- [ ] Le bouton « Importer » sur un résultat de recherche crée un produit local (nom,
      description, prix Mobilax comme coût de référence)
- [ ] Le produit importé porte `fournisseur_id` et `reference_fournisseur` (colonnes déjà
      existantes) pointant vers sa source Mobilax — aucune nouvelle colonne sur `produits`
- [ ] Le prix de vente et la quantité du produit importé restent librement modifiables par
      l'opérateur, sans valeur imposée par l'import au-delà d'un défaut raisonnable
- [ ] Isolation : le produit importé appartient exclusivement à la boutique qui a fait la
      recherche
- [ ] Test Playwright : recherche → import → le produit apparaît dans la liste du stock
- [ ] Test vu rouge avant le correctif
