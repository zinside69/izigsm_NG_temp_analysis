---
id: 09
titre: Franchise de TVA — TVA nulle sur toute ligne
statut: ready-for-agent
bloque-par: [02]
migration: aucune
---

## Contexte
Spec story 29. Une boutique en franchise (taux par défaut à 0) a une TVA de 0 sur toute ligne, quel que
soit le taux de la fiche (Q9). Aujourd'hui ses produits et services restent à 20 %.

## Critères d'acceptation
- [ ] `calculLignes()` : boutique en franchise → taux effectif 0, TTC = HT, sur caisse, devis, factures, avoirs
- [ ] Mention « TVA non applicable, art. 293 B » inchangée sur le document
- [ ] Boutique hors franchise : aucun changement
- [ ] vitest vert, tsc ≤ 32

## Coutures à tester
- `calculLignes()` : franchise × fiche à 20 %
- Route de vente sur vrai SQLite : boutique en franchise, TVA 0 en base et au journal

## Notes
La franchise se lit sur `tva_taux_defaut === 0` (CLAUDE.md § Factures) — ⊥ nouvelle colonne.
