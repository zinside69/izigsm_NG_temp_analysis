---
id: 04
titre: Services du catalogue et prix par modèle en TTC
statut: done
bloque-par: [02]
migration: 0064
---

## Contexte
Spec stories 4-5, 44. Le prix d'un service et le prix spécifique d'un service pour un modèle deviennent
des TTC de référence, comme les pièces (ticket 01).

## Critères d'acceptation
- [x] Migration `0064` : prix TTC sur les services et sur les prix par modèle ; reprise au centime ; colonnes HT intactes ; non-ronds comptés
- [x] Catalogue services : saisie et affichage en TTC (service et prix par modèle), HT affiché en second
- [x] Recherche du catalogue en caisse : un service proposé à son TTC (prix par modèle s'il existe)
- [x] API : TTC accepté, HT converti en transition, TTC prioritaire
- [x] vitest vert, tsc ≤ 32, E2E services et caisse verts

## Coutures à tester
- Migration sur vrai SQLite (`d1Sqlite`) : reprise, HT intact
- Routes services / prix par modèle : TTC écrit, HT converti
- E2E catalogue services (saisie TTC) et caisse (service ajouté à son TTC)

## Notes
`services.js` garde ses deux conventions de lecture d'enveloppe, délibérément (CLAUDE.md). La table des
prix par modèle a été reconstruite en `0038` : vérifier son schéma réel avant d'écrire la migration.

## Réalisation et revue du 2026-10-06
Fait : migration `0064` (`services.prix_ttc`, `service_modeles.prix_ttc_specifique`, repris au centime au
taux du service, HT intacts) + requête des non-ronds `scripts/sql/prix-ttc-non-ronds-services.sql` (à jouer
en production AVANT `0064`) ; `createService()` / `updateService()` / `linkServiceModele()` : TTC prioritaire,
HT converti ; lectures sur le TTC stocké (catalogue, prix par modèle, recherche et favoris de la caisse,
vitrine publique) ; écran : service et prix par modèle saisis en TTC, HT affiché en second.
Caisse : un service y est proposé à **son** TTC — la recherche ne connaît aucun modèle d'appareil ; le prix
par modèle s'applique là où un modèle est choisi (ticket, ticket 05).

**Décision de l'exploitant (2026-10-06, revue)** : Q20 s'applique au formulaire — taux changé et TTC renvoyé
à l'identique = prix non touché : HT fixe, TTC recalculé, prix par modèle compris. Portée par
`prixDeVenteAModifier()` (TTC actuel transmis) : corrige aussi le formulaire produit du ticket 01.

Revue — corrigé : taux 0 % enregistré et rechargé à 20 % (`|| 20`) ; taux en texte concaténé (« 10010 ») ;
recalcul des prix par modèle en SQL (second calcul) → `prixTtcDepuisHt()` ; prix vide lu différemment par la
validation et la route ; règle « TTC prioritaire » recopiée → `prixDeVenteACreer()`, `estUnNombreFini()`
exporté ; relecture en base à chaque modification ; prix spécifique à 0 € devenu « aucun prix » ; JSDoc périmées.

Reporté : `seed.sql` crée ses services en HT seul (après `0064` : TTC à 0 en local, comme les pièces) ; une
copie de plus du calcul HT depuis TTC à l'écran (`htDeduitDuTtc()`, `services.js`).
