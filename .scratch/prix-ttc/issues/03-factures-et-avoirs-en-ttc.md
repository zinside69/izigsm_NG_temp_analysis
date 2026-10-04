---
id: 03
titre: Factures et avoirs en TTC — création, conversion, impression
statut: ready-for-agent
bloque-par: [02]
migration: aucune
---

## Contexte
Spec stories 15-16, 24-25, 27. Les documents comptables suivent le calcul TTC du ticket 02. Les factures
émises et les brouillons existants ne bougent pas (Q19).

## Critères d'acceptation
- [ ] Création manuelle d'une facture : lignes saisies en prix unitaire TTC, calcul en mode TTC
- [ ] Conversion devis → facture : chaque ligne garde son mode et son prix unitaire
- [ ] Avoir sur une facture en mode TTC : rend exactement les montants de ses lignes
- [ ] Brouillon antérieur à la bascule : montants inchangés ; une ligne ajoutée suit le mode TTC
- [ ] Facture imprimée : prix unitaire TTC sur les lignes, récapitulatif HT / TVA par taux / TTC, 1 page A4
- [ ] Facture émise avant la bascule : réimprimée à l'identique
- [ ] vitest vert, tsc ≤ 32, E2E factures verts

## Coutures à tester
- `calculLignes()` : document mêlant lignes anciennes (HT) et nouvelles (TTC)
- Routes facture et avoir sur vrai SQLite : émission, journal NF525, avoir à l'identique
- E2E factures : création, émission, impression (récapitulatif)

## Notes
L'avoir réserve son numéro avant tout calcul : la validation des lignes reste dans la route
(`quantiteLigneInvalide()`). `_triggerPrint()` garde la garantie A4.
