---
id: 04
titre: Services du catalogue et prix par modèle en TTC
statut: ready-for-agent
bloque-par: [02]
migration: 0064
---

## Contexte
Spec stories 4-5, 44. Le prix d'un service et le prix spécifique d'un service pour un modèle deviennent
des TTC de référence, comme les pièces (ticket 01).

## Critères d'acceptation
- [ ] Migration `0064` : prix TTC sur les services et sur les prix par modèle ; reprise au centime ; colonnes HT intactes ; non-ronds comptés
- [ ] Catalogue services : saisie et affichage en TTC (service et prix par modèle), HT affiché en second
- [ ] Recherche du catalogue en caisse : un service proposé à son TTC (prix par modèle s'il existe)
- [ ] API : TTC accepté, HT converti en transition, TTC prioritaire
- [ ] vitest vert, tsc ≤ 32, E2E services et caisse verts

## Coutures à tester
- Migration sur vrai SQLite (`d1Sqlite`) : reprise, HT intact
- Routes services / prix par modèle : TTC écrit, HT converti
- E2E catalogue services (saisie TTC) et caisse (service ajouté à son TTC)

## Notes
`services.js` garde ses deux conventions de lecture d'enveloppe, délibérément (CLAUDE.md). La table des
prix par modèle a été reconstruite en `0038` : vérifier son schéma réel avant d'écrire la migration.
