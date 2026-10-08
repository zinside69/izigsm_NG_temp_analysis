---
id: 04
titre: Onglet « Avoirs » dans la page Factures
statut: ready-for-agent
bloque-par: [01]
migration: aucune
qui-code: socle possible (après 03 : fichiers partagés)
---

## Contexte
Spec stories 1-13, 50. `AV-2026-00001` est introuvable : aucune page ne lit les avoirs, alors que
`GET /avoirs` et `GET /avoirs/:id` existent. Décisions Q2, Q4, Q16.

## Critères d'acceptation
- [ ] Onglet « Avoirs » dans la page Factures (pas d'entrée de menu)
- [ ] Liste paginée : numéro, date, client, facture d'origine (lien), type, motif, TTC, expiration d'un bon
      d'achat
- [ ] Recherche par numéro ou nom du client ; filtre par type ; total TTC des avoirs du mois — portés par
      `GET /avoirs`
- [ ] Détail d'un avoir : lignes (désignation, quantité, PU TTC — PU HT × (1 + taux) pour un ancien avoir —,
      taux, total), motif, type, lien vers la facture d'origine
- [ ] Consultation : tous les rôles de la boutique et l'admin plateforme (boutique sélectionnée) ; aucun
      bouton de création pour un technicien
- [ ] Avoirs d'une autre boutique jamais visibles (garde d'appartenance existante sur le détail)
- [ ] Motif et nom du client échappés (charge XSS inerte) ; réponses d'API déballées ; vitest vert, tsc ≤ 32
- [ ] E2E vu rouge puis vert

## Coutures à tester
- **E2E** : onglet (liste, recherche, filtre, total du mois), détail, lien facture, technicien en lecture,
  charge XSS dans le motif

## Notes
- **Fichiers partagés** : écran des factures — après 03, avant 05 et 06.
- Le balayage du menu de gauche reste un gate (aucune entrée ajoutée).
