---
id: 06
titre: Prix calculé par la marge en TTC et réglage d'arrondi par boutique
statut: ready-for-agent
bloque-par: [01]
migration: 0065
---

## Contexte
Spec stories 36-40. Prix de vente TTC = prix d'achat HT × (1 + marge) × (1 + TVA), puis arrondi selon le
réglage de la boutique (Q7, Q18). Jamais d'arrondi sur un prix saisi à la main.

## Critères d'acceptation
- [ ] Migration `0065` : règle d'arrondi sur les réglages de boutique (`centime` | `dixieme_superieur` | `quatre_vingt_dix_superieur`), défaut `quatre_vingt_dix_superieur`
- [ ] Fonction pure (achat HT, taux de marge, taux de TVA, règle) → prix TTC, ou « aucun » si la marge n'est pas réglée
- [ ] ,90 supérieur : 23,49 → 23,90 ; 23,95 → 24,90 ; 23,90 → 23,90
- [ ] Onglet Marges des Réglages : choix de l'arrondi, écrit par la route des marges seule (⊥ `/settings`)
- [ ] Import Mobilax (unitaire et en lot) : prix de vente TTC calculé par cette fonction
- [ ] vitest vert, tsc ≤ 32, E2E Mobilax et réglages verts

## Coutures à tester
- Fonction pure : trois arrondis, marge absente, bornes
- Import Mobilax (`importerProduitMobilax()`) sur mock ou vrai SQLite : TTC écrit selon le réglage
- E2E réglage d'arrondi + import simulé (`page.route()`)

## Notes
`resoudreTauxMarge()` reste le seul point de résolution du taux (null = aucune marge imposée).
`reglages-onglets-sans-ecrasement.spec.ts` doit rester vert.
