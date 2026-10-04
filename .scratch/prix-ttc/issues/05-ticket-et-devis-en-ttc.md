---
id: 05
titre: Ticket et devis en TTC — prix estimé, prix final, lignes, devis public
statut: ready-for-agent
bloque-par: [03, 04]
migration: aucune
---

## Contexte
Spec stories 11-17. Prix estimé et prix final d'un ticket = TTC (Q12) ; lignes de devis en TTC ; brouillons
existants inchangés (Q19).

## Critères d'acceptation
- [ ] Prise en charge : « Prix estimé TTC » ; fiche ticket : « Prix final TTC »
- [ ] Devis : lignes saisies en prix unitaire TTC (pièce et service proposés à leur TTC), calcul en mode TTC
- [ ] Devis public (lien client) : prix TTC, total = Σ prix × quantité
- [ ] Devis brouillon antérieur : montants inchangés
- [ ] Acompte de ticket : montant TTC, TVA déduite du taux de la boutique
- [ ] vitest vert, tsc ≤ 32, E2E tickets et devis verts

## Coutures à tester
- Routes devis et ticket sur vrai SQLite : total devis = Σ prix TTC × quantité
- E2E prise en charge (prix estimé), devis (création, devis public)

## Notes
Fichiers partagés avec le lot 2 (`tickets.js`, `routes/tickets.ts`, `devis.js`) : vérifier qu'aucun
ticket du lot 2 n'est en cours au socle sur ces fichiers avant de commencer.
