---
id: 001
titre: Résolution de la boutique visée par la garde d'isolation
statut: ready-for-agent
bloque-par: []
---

## Contexte

`journalPlateformeMiddleware` résout la boutique visée par `?boutique_id=` puis par le
corps. ∴ ∀ route `/:id` (`PUT /api/factures/9`, `DELETE /api/clients/20`) → cible NULL.
Constaté en prod dès la 2ᵉ ligne écrite (`todo.md` § 🟠 P2).

Conséquence : les lignes qui comptent le plus — factures, cas de litige de l'ADR 0001 —
ne disent pas chez qui l'action a eu lieu. Bloquant pour la vue manager (ticket 003) :
un registre à trous qui a l'air complet est pire qu'⊥ registre.

Mécanisme retenu (spec § Implementation Decisions) : `assertBoutiqueOwnership()` reçoit
déjà la ressource & son `boutique_id`, sur 36 routes par ID. Elle dépose la cible dans le
contexte de requête ; le middleware la lit en **dernier recours**.

⊥ carte des routes dans le middleware — écartée par ADR 0001.
⊥ SQL supplémentaire — la ressource est déjà chargée par la garde.

## Critères d'acceptation

- [ ] ~~Ordre de résolution : query → corps → cible déposée par la garde. Les deux premiers niveaux gardent la priorité (⊥ régression sur les 3 tests existants)~~ — **inversé le 2026-09-30** (relecture de conception du socle, P15, constat 1, vérifié dans le code) : pour un admin plateforme, le frontend pose **toujours** `?boutique_id=<boutique consultée>` sur les écritures (`_avecBoutique()`, `app.js`), et la garde le laisse passer quelle que soit la boutique de la ressource. Un onglet resté ouvert sur la boutique 5 alors que la sélection est passée à 3 envoie `PUT …/20?boutique_id=3` sur une ressource de 5 : la valeur **déclarée** l'emportait sur la valeur **lue en base**, et le journal attribuait l'action à la mauvaise boutique.
- [ ] Ordre de résolution : **cible posée par la garde** → query → corps → nulle. Query et corps ne servent que de repli, pour les routes où aucune garde n'a posé de cible. Les tests existants « paramètre de requête » et « corps » restent verts : leurs routes n'appellent pas la garde
- [ ] Route `/:id` avec garde d'isolation, mutée par un admin plateforme → ligne portant la boutique de la ressource
- [ ] **Route gardée appelée avec `?boutique_id=X` sur une ressource de la boutique Y → la ligne porte Y**, pas X. Test vu rouge contre l'ancien ordre, dans le harnais **et** dans la couture « application réelle »
- [ ] Route `/:id` **sans** garde (exemption `admin-only` | `referentiel-global` | `public`) → ligne écrite quand même, cible nulle (« complétude avant précision »)
- [ ] ~~Une garde qui **refuse** (403) journalise la cible refusée, ⊥ NULL — c'est l'accès qu'un client voudra voir~~ — **sans objet, relu dans le code le 2026-09-30** : `assertBoutiqueOwnership()` laisse passer tout rôle `admin`, donc elle ne refuse **jamais** un admin plateforme, seul appelant journalisé. Remplacé par les deux critères suivants.
- [ ] Ressource **absente** (la garde répond 404) → ligne écrite, cible nulle
- [ ] Handler qui **lève après** la garde (statut 500 journalisé) → la ligne porte quand même la boutique de la ressource
- [ ] ~~Deux requêtes successives de la même application ne se partagent pas leur cible : la seconde, sans garde, reste à cible nulle~~ — **précisé le 2026-09-30** (P15, constat 2) : le ticket ne disait pas quand effacer la cible, et le harnais passe le **même objet** utilisateur à toutes les requêtes d'une application — un test pouvait passer ou échouer selon l'ordre, ou rester vert pour une mauvaise raison.
- [ ] La cible est **effacée dans le `finally` du middleware, pour toute requête** — lecture, mutation, appelant journalisé ou non, handler qui a levé. Test : un `GET` gardé, puis une mutation **sans** garde, avec le **même objet** utilisateur → la ligne de la mutation porte une cible nulle
- [ ] Tests dans le harnais existant `tests/journalPlateforme.test.ts` § résolution de la boutique visée. ⊥ nouveau seam
- [ ] ∀ test vu rouge avant correctif
- [ ] ~~`npx vitest run` → 893 verts (2 échecs permanents de fuseau `agendaService` tolérés)~~ — chiffre périmé : `npx vitest run` sans **aucun nouvel échec** par rapport à la baseline mesurée avant le ticket
- [ ] ~~`npx tsc --noEmit` ≤ 32~~ — idem : nombre d'erreurs tsc ≤ baseline mesurée avant le ticket (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] ⊥ rattrapage rétroactif des lignes existantes — information disparue, ⊥ tenter

## Coutures à tester

- `journalPlateformeMiddleware` (middleware Hono public) — harnais existant de `tests/journalPlateforme.test.ts` : routes fabriquées qui appellent la vraie `assertBoutiqueOwnership()`, ligne écrite lue dans le mock D1.
- ~~Application réelle (`src/index.tsx`) — § « application réelle » du même fichier : une vraie route par ID gardée (ex. `PUT /api/clients/:id`), mutée par un admin plateforme, ligne portant la boutique du client.~~ — exemple faux, relevé le 2026-09-30 : `PUT /api/clients/:id` est gardée par `canAccessClient()` (`clients.ts`), pas par `assertBoutiqueOwnership()`, elle ne poserait aucune cible.
- Application réelle (`src/index.tsx`) — § « application réelle » du même fichier : **`PUT /api/fournisseurs/:id`** (gardée par `assertBoutiqueOwnership()`, `fournisseurs.ts`), mutée par un admin plateforme **avec `?boutique_id=` d'une autre boutique** → ligne portant la boutique du fournisseur.
- ⊥ tester le mécanisme de dépôt lui-même (structure interne) : seule la ligne écrite fait foi.

## Notes

- ~~Point de passage unique déjà tenu par `tests/routes-isolation-conformite.test.ts` : une route par ID sans garde ni exemption fait rouge la suite. ∴ une route future hérite de la résolution sans y penser.~~ — **inexact, relevé le 2026-09-30** : le garde-fou de conformité accepte d'autres gardes que `assertBoutiqueOwnership()` (`canAccessClient()` sur les 8 routes de `clients.ts`, filtres SQL `boutique_id = ?` des services). Seules les routes qui passent par `assertBoutiqueOwnership()` posent une cible ; les autres restent au repli query → corps, donc **exposées à la même erreur d'attribution** qu'au constat 1. Limite connue de ce ticket, **hors périmètre** : ⊥ modifier les routes ici. À noter dans `todo.md` au moment du report.
- Piège ticket 04 : ⊥ lire `c.res` quand le handler a levé — Hono fabrique un 404 au passage.
- Le middleware journalise dans un `finally`, ⊥ après un simple `await next()`. ⊥ y revenir.
- Vocabulaire (`CONTEXT.md`) : « admin plateforme » | « manager », ⊥ « admin » seul.
- **Relu le 2026-09-30 — « dépose la cible dans le contexte » ne se fait pas tel quel** :
  `assertBoutiqueOwnership(user, resource, label)` ne reçoit **pas** le contexte Hono `c`, seulement
  le payload du jeton — le même objet que `c.get('user')` lit dans le middleware. Mécanisme retenu :
  un `WeakMap<JwtPayload, number>` de module dans `middleware.ts`, rempli par la garde quand la
  ressource porte un `boutique_id`, lu par `resoudreBoutiqueVisee()` en dernier recours. Signature
  inchangée, **aucun** des 44 points d'appel touché. ⊥ changer la signature pour passer `c`.
  **Amendé le même jour** (relecture de conception du socle, P15) : la cible posée par la garde est
  lue **en premier**, pas en dernier recours (constat 1) ; l'entrée du `WeakMap` est **effacée dans le
  `finally`** du middleware pour toute requête, y compris celles qui ne sont pas journalisées — un
  `GET` passe aussi par la garde et poserait sinon une cible que la requête suivante hériterait si
  elle reçoit le même objet (constat 2). En production chaque requête décode un payload neuf
  (`validateAccessToken()`), mais la règle ne doit pas dépendre de ce détail.
- Périmètre : `src/lib/middleware.ts`, `tests/journalPlateforme.test.ts`. Aucun fichier de route,
  aucune migration, aucun écran.
