---
id: 11
titre: Chiffre d'affaires HT et TTC côte à côte
statut: ready-for-agent
bloque-par: []
migration: aucune
---

## Contexte
Spec stories 48-49. Le chiffre d'affaires s'affiche en HT et en TTC (Q21) ; l'export comptable reste en HT.

## Critères d'acceptation
- [ ] Tableau de bord et statistiques : CA HT et CA TTC côte à côte, sur les mêmes factures (émises, non annulées)
- [ ] Export comptable inchangé
- [ ] vitest vert, tsc ≤ 32, E2E tableau de bord et statistiques verts

## Coutures à tester
- Service des statistiques sur vrai SQLite : CA HT et TTC sur un jeu de factures
- E2E tableau de bord : les deux montants affichés

## Notes
Statut `'emise'` dans `statsService.ts` fausse déjà les KPI (CLAUDE.md § Factures) : ne pas l'étendre au
CA TTC ; vérifier le filtre réellement employé avant d'écrire.
