---
id: 03
titre: Reste dû unique et lien facture → avoirs
statut: ready-for-agent
bloque-par: [01]
migration: aucune
qui-code: socle possible (relire la conception d'abord)
---

## Contexte
Spec stories 14-18, 23, 25. Une facture couverte reste « à encaisser » et « en retard » ; l'encart « impayés »
du tableau de bord lit le statut `emise`, que plus aucun code n'écrit. Décisions Q3, Q5, Q13, Q17.

## Critères d'acceptation
- [ ] Une fonction unique du service de facturation calcule le **reste dû** : total TTC − paiements − somme des
      avoirs émis (requête du ticket 01) ; facture `payee` ou `annulee` → 0 ; jamais négatif
- [ ] `GET /factures` et `GET /factures/:id` exposent `reste_du` et les avoirs liés (numéro, montant TTC)
- [ ] Liste des factures : badge « avoir » sur une facture qui en a ; mention « Annulée par AV-… » sur une
      facture annulée ; reste dû affiché à la place du calcul local actuel
- [ ] Compteurs « en attente » et « en retard » de la page Factures : comptent les factures au reste dû > 0
- [ ] Encart « impayés » du tableau de bord : même définition (reste dû > 0), plus de lecture de `emise`
- [ ] Facture annulée consultable et réimprimable à l'identique
- [ ] Réponses d'API déballées au point d'appel ; données échappées ; vitest vert, tsc ≤ 32
- [ ] E2E vu rouge puis vert

## Coutures à tester
- **Service sur vrai SQLite** : reste dû — en attente sans avoir, partiellement couverte, payée, annulée
- **E2E** : facture couverte hors des compteurs, badge et mention affichés ; tableau de bord = page Factures

## Notes
- **Fichiers partagés** : écran des factures, comme 04, 05, 06 → au socle, **03 → 04 → 05 → 06 l'un après
  l'autre**, jamais en parallèle.
- Ne pas corriger ici l'écriture du montant payé par la caisse (hors chantier, `todo.md`) : la règle
  « `payee` → 0 » la contourne.
