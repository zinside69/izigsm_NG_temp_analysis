---
id: 07
titre: Acompte d'un ticket annulé → bon d'achat
statut: ready-for-agent
bloque-par: [04]
migration: aucune
qui-code: socle possible
---

## Contexte
Spec stories 3, 42-44. Annuler un ticket dont l'acompte était facturé crée un avoir valable 60 jours — un
bon d'achat — mais l'écran des tickets n'envoie pas de type : il est enregistré « remboursement ». Décision Q11.

## Critères d'acceptation
- [ ] L'annulation d'un ticket avec acompte facturé crée un avoir de type `bon_achat`, expiration 60 jours
      conservée
- [ ] Ce bon d'achat respecte le plafond de la facture d'acompte (ticket 01) ; un refus est affiché, le ticket
      n'est pas annulé en silence
- [ ] Onglet « Avoirs » (ticket 04) : type « Bon d'achat » et date d'expiration affichés
- [ ] `CACHE_VERSION` du service worker incrémentée (dernier ticket d'écran du chantier)
- [ ] Réponses d'API déballées ; vitest vert, tsc ≤ 32 ; E2E vu rouge puis vert

## Coutures à tester
- **E2E** : ticket avec acompte facturé → annulation → avoir `bon_achat` visible dans l'onglet avec son
  expiration

## Notes
- Touche l'écran des tickets, pas celui des factures : peut avancer en parallèle de 05 et 06.
- Hors périmètre : utiliser le bon d'achat en caisse (état `utilise`), contrôle de l'expiration (`todo.md`).
