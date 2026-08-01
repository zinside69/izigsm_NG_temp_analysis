---
id: 004
titre: Journal des actions de plateforme — middleware + table dédiée
statut: done
bloque-par: [002]
---

# 04 — Journal des actions de plateforme

**Blocked by :** 02 — sans sélection de boutique, on ne peut pas vérifier que la bonne boutique
visée est enregistrée.

## Contexte

Décision structurante : `docs/adr/0001-journal-separe-actions-plateforme.md` (statut *accepted*).
Les actions de l'admin plateforme sur une boutique cliente vont dans un journal **dédié**,
distinct de l'`audit_logs` de cette boutique, alimenté par un **middleware** — et non par les
77 appels dispersés à la journalisation existante, qui laisseraient des trous.

Motif : le client doit pouvoir savoir ce qui a été fait sur ses données, en particulier sur une
facture en cas de litige.

## What to build

Toute action d'écriture d'un admin plateforme sur une boutique cliente laisse une ligne dans un
journal dédié, **automatiquement**, sans que la route concernée ait à le prévoir — y compris
les routes écrites plus tard.

Une lecture n'écrit rien. Un manager agissant chez lui n'écrit rien. Une action dont la boutique
visée n'a pas pu être déterminée est enregistrée **quand même**, cible nulle.

Le journal n'est lu par aucune interface dans ce ticket : sa consultation appartient au
chantier 2.

## Critères d'acceptation

- [x] Une mutation (POST/PUT/PATCH/DELETE) d'un admin plateforme sur une boutique cliente écrit une ligne portant l'auteur, la boutique visée, la méthode, le chemin et le statut de la réponse
- [x] Une lecture (GET) n'écrit aucune ligne
- [x] Une mutation d'un manager sur sa propre boutique n'écrit aucune ligne
- [x] Une mutation d'admin plateforme dont la boutique visée n'est pas résolue écrit une ligne avec une cible nulle — jamais de ligne tue
- [x] Aucun secret n'apparaît dans la capture du corps de requête (mot de passe, jeton, code de déverrouillage, code SIM)
- [x] Un échec d'écriture du journal ne fait pas échouer la requête métier
- [x] La table ne porte aucune contrainte de clé étrangère, et une boutique désactivée laisse ses lignes intactes
- [x] Une route ajoutée après ce ticket est journalisée sans modification du middleware (vérifié sur une route existante non prévue au départ)
- [x] Le garde-fou `tests/routes-isolation-conformite.test.ts` reste vert
- [x] `npx vitest run` ≥ 873/875 · `npx tsc --noEmit` ≤ 32

## Livré le 2026-08-01

`migrations/0039_journal_actions_plateforme.sql` · `src/services/journalPlateformeService.ts` ·
`journalPlateformeMiddleware` + `isAdminPlateforme()` (`src/lib/middleware.ts`) · branchement
global `/api/*` (`src/index.tsx`) · `tests/journalPlateforme.test.ts` (16 tests).

Portes : `npx vitest run` **891/893** (2 échecs permanents de fuseau `agendaService`) ·
`npx tsc --noEmit` **32** · `npx playwright test` **167/167**. Vérifié en local sur
l'application réelle : ligne écrite avec `password` expurgé, lecture et manager sans trace.

Deux points relevés en revue et corrigés : la journalisation vivait **après** `next()` sans
`finally` — un handler qui lève (la majorité n'attrape rien) faisait perdre la ligne, soit
exactement le cas de litige de l'ADR ; et l'expurgation, faite par le middleware, pouvait être
oubliée par un futur appelant — elle est désormais dans le service, hors d'atteinte.

## Notes

- **Colonnes retenues** : auteur, boutique visée, méthode HTTP, chemin, statut HTTP, corps de
  requête tronqué et expurgé, adresse IP, horodatage. `entite_type` / `entite_id` /
  `donnees_avant` / `donnees_apres` sont **volontairement écartés** — un middleware ne les
  connaît pas, et les déduire du chemin produirait un registre faux.
- **Pas de clé étrangère** : un registre de supervision doit survivre à une boutique désactivée
  et à un compte supprimé. Le dépôt a déjà payé le prix d'une FK laissée pendante (migration
  `0031`, réparée par `0038`).
- Index sur (boutique visée, horodatage) et sur l'auteur — la consultation du chantier 2 lira
  par boutique et par date.
- **Complétude avant précision** : ne jamais taire une ligne faute de pouvoir la qualifier.
  C'est le trou exact que l'ADR reproche à une journalisation dispersée.
- Résolution de la boutique visée : paramètre de requête, puis corps de requête, sinon nulle.
- L'écriture ne doit ni faire échouer ni retarder visiblement la requête métier — reprendre le
  patron d'effet de bord différé déjà en place dans le dépôt.
- **Déploiement** : la migration doit être appliquée **à distance avant** le déploiement du
  Worker. Le jeton Cloudflare de session n'a pas les droits D1 distants (erreur 7403) — la
  commande est à faire lancer par l'utilisateur.
