---
id: 07
titre: Import CSV de produits en TTC
statut: ready-for-agent
bloque-par: [06]
migration: aucune
---

## Contexte
Spec stories 41-43. Le CSV d'un fournisseur porte des prix d'achat HT ; le prix de vente TTC se calcule
par la marge et l'arrondi de la boutique (Q13).

## Critères d'acceptation
- [ ] Colonne `prix_vente_ttc` lue (virgule décimale acceptée) ; prioritaire
- [ ] `prix_vente_ht` encore accepté, converti en TTC au centime
- [ ] Aucune des deux : prix calculé par la marge de la famille et l'arrondi (fonction du ticket 06) ; marge non réglée → prix vide
- [ ] Modèle de fichier / aide de l'écran d'import à jour
- [ ] vitest vert, tsc ≤ 32

## Coutures à tester
- `importCatalogueCsv()` : les trois cas de colonne, cellule invalide refusée

## Notes
Les règles de création (`createProduit()`, seuil, stock initial) ne changent pas.
