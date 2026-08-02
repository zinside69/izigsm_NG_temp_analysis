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

- [ ] Ordre de résolution : query → corps → cible déposée par la garde. Les deux premiers niveaux gardent la priorité (⊥ régression sur les 3 tests existants)
- [ ] Route `/:id` avec garde d'isolation, mutée par un admin plateforme → ligne portant la boutique de la ressource
- [ ] Route `/:id` **sans** garde (exemption `admin-only` | `referentiel-global` | `public`) → ligne écrite quand même, cible nulle (« complétude avant précision »)
- [ ] Une garde qui **refuse** (403) journalise la cible refusée, ⊥ NULL — c'est l'accès qu'un client voudra voir
- [ ] Tests dans le harnais existant `tests/journalPlateforme.test.ts` § résolution de la boutique visée. ⊥ nouveau seam
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` → 893 verts (2 échecs permanents de fuseau `agendaService` tolérés)
- [ ] `npx tsc --noEmit` ≤ 32
- [ ] ⊥ rattrapage rétroactif des lignes existantes — information disparue, ⊥ tenter

## Notes

- Point de passage unique déjà tenu par `tests/routes-isolation-conformite.test.ts` : une route par ID sans garde ni exemption fait rouge la suite. ∴ une route future hérite de la résolution sans y penser.
- Piège ticket 04 : ⊥ lire `c.res` quand le handler a levé — Hono fabrique un 404 au passage.
- Le middleware journalise dans un `finally`, ⊥ après un simple `await next()`. ⊥ y revenir.
- Vocabulaire (`CONTEXT.md`) : « admin plateforme » | « manager », ⊥ « admin » seul.
