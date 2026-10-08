---
id: 06
titre: Fenêtre d'avoir préremplie des lignes de la facture
statut: ready-for-agent
bloque-par: [01]
migration: aucune
qui-code: socle possible (après 05 : fichiers partagés)
---

## Contexte
Spec stories 26-28. La fenêtre « Créer un avoir » s'ouvre sur une ligne vide : pour annuler une facture de
deux lignes, il faut les retaper (vécu en recette, `AV-2026-00001`). Décision Q7.

## Critères d'acceptation
- [ ] À l'ouverture, la fenêtre reprend les lignes de la facture : désignation, quantité, PU TTC, taux
- [ ] Ligne d'une facture d'avant la bascule (HT) → PU TTC proposé = PU HT × (1 + taux), arrondi au centime
- [ ] Lignes modifiables et supprimables ; « Ajouter une ligne » conservé
- [ ] Totaux de la fenêtre recalculés à l'ouverture et à chaque modification
- [ ] Refus `plafond_depasse` (ticket 01) affiché avec le montant encore annulable
- [ ] Réponses d'API déballées ; données échappées ; vitest vert, tsc ≤ 32 ; E2E vu rouge puis vert

## Coutures à tester
- **E2E** : facture de deux lignes à deux taux → fenêtre préremplie, avoir total émis en un clic → facture
  « Annulée » ; ligne retirée → avoir partiel ; facture d'avant la bascule → PU TTC déduit

## Notes
- **Fichiers partagés** : écran des factures — après 05 si confié au socle (le blocage logique n'est que 01).
