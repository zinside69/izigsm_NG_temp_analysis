---
id: 10
titre: Reconditionnement — prix de revente en TTC
statut: ready-for-agent
bloque-par: [01]
migration: 0067
---

## Contexte
Spec story 10. Le prix de revente d'un appareil reconditionné se saisit en TTC ; la clôture crée le produit
avec ce TTC. Le régime de la marge est hors périmètre (chantier séparé).

## Critères d'acceptation
- [ ] Migration `0067` : prix de revente TTC ; reprise au centime ; colonne HT intacte
- [ ] Écran reconditionnement : saisie et affichage en TTC, marge sur le HT déduit
- [ ] Clôture : produit créé avec son prix de vente TTC
- [ ] vitest vert, tsc ≤ 32, E2E reconditionnement verts

## Coutures à tester
- Migration sur vrai SQLite
- Clôture d'un reconditionnement : TTC du produit créé
- E2E écran reconditionnement

## Notes
La clôture code le taux à 20 en dur : laisser tel quel (régime de la marge à venir).
