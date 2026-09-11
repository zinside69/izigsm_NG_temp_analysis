# 04 — Import d'une pièce trouvée dans l'inventaire (Stock)

**What to build:** depuis un résultat de recherche Mobilax, un bouton « Importer » crée un
produit local dans le stock de la boutique, lié à sa source Mobilax, avec le prix Mobilax comme
coût de référence. L'opérateur garde la main sur le prix de vente et la quantité après import —
rien n'est imposé par l'import.

**Blocked by:** 03 — Recherche Mobilax dans Stock (sans import)

**Status:** done (2026-09-11)

- [x] Le bouton « Importer » sur un résultat de recherche crée un produit local (nom,
      description, prix Mobilax comme coût de référence)
- [x] Le produit importé porte `fournisseur_id` et `reference_fournisseur` (colonnes déjà
      existantes) pointant vers sa source Mobilax — aucune nouvelle colonne sur `produits`
- [x] Le prix de vente et la quantité du produit importé restent librement modifiables par
      l'opérateur, sans valeur imposée par l'import au-delà d'un défaut raisonnable
- [x] Isolation : le produit importé appartient exclusivement à la boutique qui a fait la
      recherche
- [x] Test Playwright : recherche → import → le produit apparaît dans la liste du stock
- [x] Test vu rouge avant le correctif

## Notes d'implémentation (2026-09-11)

- **Décisions de l'exploitant** (avant le premier test) : trois seams (service, route, E2E en
  vraie préproduction) ; nom et prix **relus chez Mobilax** côté serveur ; défauts : vente =
  marge résolue (famille « pièce », sinon défaut boutique, 0 sans taux), stock 0, seuil 0, fiche
  ouverte après import ; doublon refusé en montrant l'existant.
- **Référence** : la vraie référence Mobilax (`ECRTAREAPPIPHNE12MNO`, sur `/products/:id/full`)
  va dans `reference_fournisseur`, l'EAN dans `code_barre`. Le ticket 05 pourra relire une pièce
  par `/products/lookup?reference=`.
- **`fournisseur_id`** passe par un 5e argument de `createProduit()`, jamais par le corps de
  `POST /produits` (isolation).
- **Écart constaté** : seuil 0 n'évite pas l'alerte « à commander » (`stock ≤ seuil`, 0 ≤ 0) —
  consigné dans `todo.md`, décision à prendre.
