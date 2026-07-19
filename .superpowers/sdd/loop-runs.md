# Ledger de la loop d'ingénierie autonome (loop-engineering)

_Append-only. Une entrée par exécution du skill `.claude/skills/loop-engineering/SKILL.md`.
Jamais réécrit — nouvelle entrée ajoutée en dessous. Voir `project-docs/loop-policy.md`._

## Run 2026-07-19 (heure indisponible — session non-interactive) — tâche de tête : faille isolation `GET /api/tickets/:id`

- Tâche : « Corriger `GET /api/tickets/:id` (`src/routes/tickets.ts:160`) avec le patron `getBoutiqueId(...)` + `403` » — `project-docs/todo.md:5` (section 🔴 PRIORITÉ CRITIQUE). Tête de file selon l'ordre déterministe de `pick-task.mjs` (priorité 🔴 d'abord).
- Issue : **escaladé** — aucun commit, aucun worktree créé, aucune modification de code.
- Risque : **élevé** (isolation multi-tenant — `boutique_id` / `getBoutiqueId`). La tâche est elle-même documentée dans `todo.md` comme « classé risque élevé par `loop-policy.md` — escaladé, pas d'auto-fix ». `loop-policy.md` § Classification interdit l'auto-commit sur cette catégorie.
- Gates : vitest n·a · tsc n·a · build n·a · playwright n·a · browser-use n·a (aucun gate exécuté — voir Détail).
- Worktree : aucun (rien créé — arrêt avant l'étape 3).
- Détail / recommandation :
  1. **Blocage environnement (bloquant, indépendant du choix de tâche)** : cette session est non-interactive et l'exécution de `node`/`npm`/`npx` est soumise à approbation interactive impossible à accorder ici. `scripts/loop/check-quota.mjs` (Étape 0bis, gate quota obligatoire *avant tout le reste*) n'a pas pu être exécuté — testé via Bash et PowerShell, avec et sans sandbox, systématiquement refusé. Les gates de l'Étape 5 (`vitest`, `tsc --noEmit`, `npm run build`, Playwright) sont tous des invocations `node`/`npm` et sont donc également inexécutables. La machinerie de sûreté de la loop ne peut pas tourner → per garde-fou global « en cas de doute non couvert → escalader », arrêt sans implémentation.
  2. **Blocage classification (bloquant, indépendant du blocage environnement)** : la tâche de tête est à risque élevé (isolation multi-tenant) et déjà escaladée sans décision humaine actée depuis (aucune entrée `decisions.md` ni changement du texte de la tâche). `loop-policy.md` interdit l'auto-fix ; l'Étape 1 impose de ne jamais re-tenter en boucle une telle tâche.
  - Recommandation : (a) pour lever le blocage environnement, lancer la loop via `scripts/loop/run-loop.ps1` dans une session CLI locale normale (permissions node/npm accordées), pas dans une session non-interactive restreinte ; (b) pour la faille isolation elle-même, c'est une correction de sécurité qui nécessite une décision humaine explicite (voir `bugs.md` § faille `GET /api/tickets/:id`) — appliquer manuellement le patron `getBoutiqueId(user, queryBoutiqueId)` + `ticket.boutique_id !== boutiqueId → 403` déjà utilisé sur `/api/tickets/:id/photos`, puis auditer `PUT /:id`, `PUT /:id/statut`, `DELETE /:id`, `POST /:id/acompte`.

## Run 2026-07-19 (heure exacte indisponible — non-interactif) — sélecteur de tâches cassé (faux « backlog vide »)

- Tâche : **aucune tâche sélectionnée** — `pick-task.mjs` retourne `{"empty":true}` ET `--all` retourne `[]`, alors que `project-docs/todo.md` contient **54 tâches non cochées** (`grep -c '- [ ]'`), dont la section 🔴 PRIORITÉ CRITIQUE et plusieurs items 🔴.
- Issue : **escaladé** — aucun commit, aucun worktree, aucune modification de code. Le run n'a PAS traité de tâche produit, mais le résultat « empty » est un **faux positif** (bug d'outillage), pas un vrai backlog vide → ne pas appliquer la branche « empty → stop » du SKILL comme si le backlog était réellement épuisé.
- Risque : **faible** (le correctif proposé touche `scripts/loop/pick-task.mjs`, outillage de la loop — hors catégories de risque produit de `loop-policy.md` : ni auth, ni multi-tenant, ni NF525, ni RGPD, ni migration).
- Gates : vitest n·a · tsc n·a · build n·a · playwright n·a · browser-use n·a (aucun gate exécuté — arrêt à l'étape 1, sélection impossible).
- Worktree : aucun (arrêt avant l'étape 3).
- Détail / recommandation :
  1. **Cause racine confirmée** : `git ls-files --eol` montre le working tree en **CRLF** (`w/crlf`) pour `project-docs/todo.md`, `docs/TODO.md` ET `scripts/loop/pick-task.mjs` (checkout Windows, `core.autocrlf`, aucun `.gitattributes`). `pick-task.mjs:40` fait `readFileSync(relPath,'utf8').split('\n')` : chaque ligne conserve un `\r` traînant. Les regex `^(#{2,4})\s+(.*)$` (titres) et `^(\s*)-\s*\[ \]\s+(.*)$` (tâches) échouent car `.` ne consomme pas `\r` et `$` (sans flag `m`) ne matche pas avant `\r`. → 0 tâche parsée sur Windows, à chaque run. La loop se croit à vide et ne fait jamais rien.
  2. **Impact** : sur toute machine Windows (le poste principal de l'utilisateur, cf. CLAUDE.md), la loop-engineering est **silencieusement inopérante** — elle rapporte « backlog vide » alors que le backlog est plein (54 tâches, dont des 🔴). Un run précédent a d'ailleurs pu masquer cet état.
  3. **Correctif proposé (non appliqué — attente validation utilisateur, règle « proposer avant de modifier »)** : `pick-task.mjs:40` remplacer `.split('\n')` par `.split(/\r?\n/)`. Une ligne, robuste LF et CRLF. Vérification suggérée : `node scripts/loop/pick-task.mjs --all` doit alors lister les 54 tâches (tête de file = la 🔴 critique restante).
  4. Ce correctif étant un changement d'outillage à faible risque, il serait éligible à l'auto-commit de la loop une fois validé — mais il conditionne la loop elle-même, d'où l'escalade explicite plutôt qu'un auto-fix silencieux.
