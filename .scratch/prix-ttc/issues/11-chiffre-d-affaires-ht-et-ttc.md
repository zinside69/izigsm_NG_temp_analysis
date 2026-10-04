---
id: 11
titre: Chiffre d'affaires HT et TTC côte à côte
statut: done
bloque-par: []
migration: aucune
---

## Contexte
Spec stories 48-49. Le chiffre d'affaires s'affiche en HT et en TTC (Q21) ; l'export comptable reste en HT.

## Critères d'acceptation
- [x] Tableau de bord et statistiques : CA HT et CA TTC côte à côte, sur les mêmes factures — **factures payées seulement** (filtre existant gardé, décision de l'exploitant du 2026-10-04 ; « émises, non annulées » était une description supposée du filtre)
- [x] Export comptable inchangé
- [x] vitest vert, tsc ≤ 32, E2E tableau de bord et statistiques verts

## Coutures à tester
- Service des statistiques sur vrai SQLite : CA HT et TTC sur un jeu de factures
- E2E tableau de bord : les deux montants affichés

## Notes
Statut `'emise'` dans `statsService.ts` fausse déjà les KPI (CLAUDE.md § Factures) : ne pas l'étendre au
CA TTC ; vérifier le filtre réellement employé avant d'écrire.

## Réalisation (2026-10-04)
Portée décidée par l'exploitant : **encarts seuls** — « CA ce mois » (tableau de bord, statistiques) et « CA 12 mois » portent leur HT ; moyenne mensuelle, graphique et écart avec le mois dernier restent en TTC. Service : `ca_mois_ht`, `ca_mois_precedent_ht`, `total_12_mois_ht` ; alias SQL `ca` → `ca_ttc`. Tests : `stats-ca-ht-ttc-sqlite` (vrai SQLite, facture en attente non comptée), E2E `ca-ht-ttc`.
