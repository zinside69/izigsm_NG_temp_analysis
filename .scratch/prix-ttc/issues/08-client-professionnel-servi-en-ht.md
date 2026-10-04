---
id: 08
titre: Client professionnel servi en HT
statut: ready-for-agent
bloque-par: [03, 05]
migration: 0066
---

## Contexte
Spec stories 30-35. Réglage « servi en HT » sur la fiche d'un client professionnel, modifiable sur chaque
document (Q3, Q5). En mode HT, la ligne se calcule à partir du HT ; PU HT = TTC de référence ÷ (1 + taux),
arrondi au centime.

## Critères d'acceptation
- [ ] Migration `0066` : « servi en HT » sur la fiche client ; mode de calcul sur devis et factures
- [ ] Fiche client : case visible pour un client professionnel seulement ; refusée pour un particulier (serveur)
- [ ] Devis, facture, caisse : mode proposé selon le client, bascule HT / TTC sur le document
- [ ] Mode HT : 100 € HT → 120,00 € ; prix proposés convertis ÷ (1 + taux) au centime
- [ ] Mode figé à l'émission : réimpression identique
- [ ] vitest vert, tsc ≤ 32, E2E verts

## Coutures à tester
- `calculLignes()` en mode HT sur des prix venus du TTC
- Routes devis / facture / vente sur vrai SQLite : mode HT, mode figé
- E2E client pro : fiche, bascule, document émis

## Notes
`acheteur_snapshot` fige déjà l'identité ; le mode se fige avec le reste à l'émission (`emettreFacture()`
et `createVente()`, seuls sites de figeage).
