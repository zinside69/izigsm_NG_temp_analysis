---
id: 001
titre: Un jeton admin qui porte une boutique est refusé à l'entrée
statut: ready-for-agent
bloque-par: []
---

# 001 — Un jeton admin qui porte une boutique est refusé à l'entrée

## Contexte

Relevé le 2026-09-17 par la revue du ticket 02 `vente-lit-catalogue` (`todo.md` 🟠 P2 « Résolveur de
boutique ») : `getBoutiqueId()` (`src/lib/middleware.ts`) honore `?boutique_id=` dès que
`role === 'admin'`, sans distinguer l'admin plateforme (`boutique_id` NULL) d'un admin rattaché à une
boutique. Décision de l'exploitant du 2026-09-17 : corriger le résolveur commun, dans un chantier à
part.

**Ni caisse ni NF525 → confié au socle. Aucune migration.**

### Constats du cadrage (2026-10-01)

- **La faille est plus large que le résolveur.** 23 sites testent `role === 'admin'` /
  `role !== 'admin'` sans regarder `boutique_id` : `getBoutiqueId()` et
  `assertBoutiqueOwnership()` (`middleware.ts` — donc les **36 gardes par ID**), `listUsers()` et deux
  gardes de `userService.ts`, 9 gardes de `routes/boutiques.ts`, `canAccessClient()`
  (`routes/clients.ts`), 8 gardes de `routes/tickets.ts`. Et **15 routes** en `requireRole('admin')`
  seul (purge d'un client, création de boutique, référentiel global marques / modèles, suppression
  d'un employé…). Un admin rattaché à une boutique les traverserait toutes — **sans** être journalisé,
  puisque `journalPlateformeMiddleware` utilise, lui, `isAdminPlateforme()`.
- **La faille est latente** — mesuré le 2026-10-01 : production **1** admin, sans boutique (l'admin
  plateforme) ; **0** admin avec boutique ; 5 managers, 2 techniciens. Base locale : idem (0 admin avec
  boutique). **Aucun chemin du code n'en crée** : l'inscription (mot de passe et Google) pose
  `role_id = 2` (manager), et rien ne change un rôle ensuite. La sécurité tient donc à l'**absence**
  d'un type de compte — que la documentation évoque pourtant (« manager et admin de boutique »,
  règles Mobilax de `CLAUDE.md`).
- **Un seul point de validation du jeton d'accès** : `authMiddleware` (`validateAccessToken()` n'a pas
  d'autre appelant), monté sur tous les routeurs `/api` hors `/api/public`.
- `isAdminPlateforme(user)` existe côté serveur (`middleware.ts`) : `role === 'admin'` **et**
  `!boutique_id`. C'est la seule définition opérationnelle (ADR 0001).
- **Trois fichiers de test fabriquent un admin avec boutique** (`role: 'admin', boutique_id: 1…`) :
  `tests/boutiques-marges-route.test.ts`, `tests/factures-immuabilite-conformite.test.ts`,
  `tests/mobilax-route.test.ts`. Ils décrivent un compte qui n'existe pas et qui sera refusé.

### Décision de l'exploitant du 2026-10-01

**Un admin rattaché à une boutique ne doit pas exister.** `admin` = admin plateforme, toujours sans
boutique. Un jeton `admin` qui porte un `boutique_id` est **refusé à l'entrée** (fermé par défaut) :
un seul point ferme d'un coup les 23 sites et les 15 routes, sans les toucher. En défense en
profondeur, `getBoutiqueId()` et `assertBoutiqueOwnership()` passent par `isAdminPlateforme()`.
Priorité ramenée de P2 à **P3** (latente). Option écartée : faire de l'« admin de boutique » un vrai
rôle cantonné à sa boutique (23 sites + 15 routes à reprendre, conflits avec 08b, 08c, 09, 11 sur
`tickets.ts`).

### Relecture de conception (2026-10-01)

- **Refus dans `authMiddleware`**, après `validateAccessToken()` et avant `c.set('user', …)` :
  `role === 'admin'` et `boutique_id` non nul → **403** `{ success: false, error: 'Compte
  incohérent : un compte administrateur ne peut pas être rattaché à une boutique. Contactez le
  support.', code: 'compte_incoherent' }`, et une ligne `console.error` (identifiant du compte, jamais
  le jeton). ⊥ 401 : le jeton est valide, c'est le compte qui est refusé — le front ne doit pas
  boucler sur un rafraîchissement.
- **`getBoutiqueId()`** : `?boutique_id=` honoré **seulement** si `isAdminPlateforme(user)` ; sinon
  `user.boutique_id`. **`assertBoutiqueOwnership()`** : traverse seulement si
  `isAdminPlateforme(user)`. Ces deux changements sont sans effet tant que le refus d'entrée tient —
  ils protègent le jour où il serait contourné.
- **Les 23 autres sites et les 15 routes ne sont pas modifiés** (décision) : ⊥ élargir le périmètre.
- Aucun changement de connexion ni de contenu du jeton : un compte incohérent se connecte, puis chaque
  appel `/api` répond 403 avec le motif.
- Front : une réponse `compte_incoherent` n'a pas besoin d'écran dédié (aucun compte réel) ; ⊥ la
  traiter comme une expiration de session.

## Critères d'acceptation

- [ ] `authMiddleware` : jeton `admin` + `boutique_id` non nul → 403 `compte_incoherent` (forme
      ci-dessus), handler jamais atteint ; jeton `admin` sans boutique, `manager`, `technicien` →
      inchangés
- [ ] `getBoutiqueId()` : `?boutique_id=` ignoré pour tout appelant qui n'est pas admin plateforme
      (via `isAdminPlateforme()`)
- [ ] `assertBoutiqueOwnership()` : seul l'admin plateforme traverse (via `isAdminPlateforme()`)
- [ ] Les trois fichiers de test qui fabriquent un admin avec boutique sont réécrits avec le compte
      que le test veut vraiment décrire (**manager** de la boutique, ou admin plateforme), chaque
      cas gardant son intention ; aucun test supprimé sans remplacement
- [ ] Console plateforme, sélection de boutique et balayage du menu verts
      (`tests/e2e/resolveur-boutique-pages.spec.ts`)
- [ ] `tests/routes-isolation-conformite.test.ts` vert
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket
      (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] ⊥ migration ; ⊥ caisse ; ⊥ NF525 ; ⊥ modification des 23 sites et 15 routes recensés

## Coutures à tester

- **`authMiddleware`** — vitest par `app.request()` avec un jeton **réellement signé**
  (`JWT_SECRET` de test) : admin avec boutique → 403 `compte_incoherent` sur une route de liste
  (`GET /api/clients`), une route par ID (`GET /api/tickets/:id`) et une route `requireRole('admin')`
  (`DELETE /api/clients/:id/purge`) — **aucune** écriture en base, handler non appelé ; admin plateforme
  → passe ; manager → passe.
- **Défense en profondeur** — vitest des fonctions pures : `getBoutiqueId({ role: 'admin',
  boutique_id: 2 }, '1')` → 2 ; `getBoutiqueId({ role: 'admin', boutique_id: null }, '1')` → 1 ;
  `assertBoutiqueOwnership()` refuse une ressource d'une autre boutique à un admin avec boutique.
- **Écrans** — E2E existants rejoués : `resolveur-boutique-pages.spec.ts` (admin plateforme, console,
  sélection, menu de gauche). Pas de nouvel E2E : aucun compte réel n'est concerné. L'E2E est joué par
  le socle dans le bac à sable (contrôle e2e de gates.json) ; un E2E hors de sa portée se demande dans
  le compte rendu (P16).

## Notes

- Périmètre : `src/lib/middleware.ts`, tests correspondants, les trois fichiers de test cités.
- Fichier partagé : `src/lib/middleware.ts` porte aussi `journalPlateformeMiddleware` — vérifier
  qu'aucune tâche du socle en cours n'y écrit (chantier `journal-plateforme-lecture`).
- Documentation (geste humain à la relecture, `CLAUDE.md` n'est jamais dans le périmètre d'un agent) :
  `CLAUDE.md` § checkpoint 73 (« un admin *de boutique* voit son `?boutique_id=` honoré ») et les
  mentions « admin de boutique » des règles Mobilax et import d'une sélection ; `todo.md` P2 →
  clos par ce ticket.
- Comptage des comptes en production (lecture seule, 2026-10-01) :
  `SELECT r.nom, u.boutique_id IS NULL, COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id GROUP BY 1, 2`.
