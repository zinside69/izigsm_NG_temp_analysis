# Recovery Prompt — iziGSM — 2026-07-14 (checkpoint 10)

## Vue d'ensemble
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant de gestion pour centres de réparation GSM. Repo : `izigsm/webapp/` (racine git), remote GitHub `zinside69/izigsm_NG_temp_analysis`, branche `main`. Objectif long terme : sortir de Cloudflare (VPS + Postgres) sans changer le CDC fonctionnel — chantier Ports & Adapters en cours depuis le 2026-07-12.

## Architecture actuelle
- Backend Hono/TypeScript sur Cloudflare Workers, pattern Controller (`routes/`) → Service (`services/`) → jamais de SQL inline dans une route
- **Pattern Ports & Adapters** : `src/ports/database.ts` (interface `Database` : `all/get/run`, SQL brut) + `src/adapters/cloudflare/d1Database.ts` (implémentation D1, seule active), injecté via middleware global (`src/index.tsx`, `c.set('db', new D1DatabaseAdapter(c.env.DB))`) et lu dans les routes via `c.get('db')`
- **12/20 services migrés** (voir `todo.md`) : `userService`, `photosService`, `publicService`, `boutiqueService`, `rachatService`, `personnelService`, `caisseService`, `factureService`, `devisService`, `authService`, `stockService`, `clientService`, `fournisseursService` (2026-07-14)
- **Règle de migration établie** : toute fonction dépendant d'`auditLog()`, `nextNumero()`, `enregistrerTransaction()` ou `db.batch()` reste sur `D1Database` brut. Note pour `fournisseursService.ts` : la numérotation `BC-AAAA-NNNNN` de `createBonCommande()` est calculée par `MAX(seq)` directement (pas via `nextNumero()`), mais la fonction reste non migrée quand même à cause de son `auditLog()` final — la règle de blocage s'applique à `auditLog`/`nextNumero`/`enregistrerTransaction`/`batch` indifféremment, peu importe le mécanisme de numérotation utilisé.
- **Pattern routes mixtes (`dbPort`/`db`)** : `routes/fournisseurs.ts` n'avait aucun typage `Variables.db` avant ce checkpoint (contrairement à la plupart des autres routeurs déjà migrés au moins une fois) — ajouté de zéro. Pas de helper `ctx()` dans ce fichier (chaque handler lit `c.get('user')`/`c.env.DB`/`c.get('db')` directement) — cohérent avec le style existant du fichier, pas de refactor introduit pour l'occasion.
- **`src/lib/timezone.ts`** (2026-07-12) : sans objet pour `fournisseursService.ts` (aucun horodatage métier comparé à "aujourd'hui").

## Méthodologie de migration (à répéter pour chaque service restant)
1. Lire le service + son fichier de test + les routes qui l'appellent
2. Identifier les fonctions bloquées par `auditLog`/`nextNumero`/`enregistrerTransaction`/`batch` → restent sur `D1Database` — peu importe si la fonction a par ailleurs sa propre logique de numérotation custom (cas `createBonCommande`)
3. Migrer les autres vers `Database` (`db.prepare().bind().first()` → `db.get()`, `.all()` → `db.all()`, `.run()` → `db.run()`) — utiliser des génériques `db.get<T>()`/`db.all<T>()` plutôt que des casts `as T` non sûrs après coup (corrige au passage d'éventuelles erreurs `tsc` préexistantes, comme vu sur `fournisseursService.ts`/`clientService.ts`)
4. Mettre à jour les routes (`c.env.DB` → `c.get('db')` uniquement pour les fonctions migrées). Si le fichier n'a pas encore de `Variables.db`, l'ajouter (`type Variables = { user: any; db: Database }`) même s'il n'y a pas de helper `ctx()` centralisé — chaque handler peut appeler `c.get('db')` directement
5. Mettre à jour les tests (`mockD1` → `mockDatabase` par describe-block ; les blocs qui testent une fonction restée sur D1 gardent `mockD1`)
6. `npx vitest run tests/` (zéro régression) + `npx tsc --noEmit` (comparer via `git stash` — chercher aussi les erreurs qui *disparaissent*, souvent des bonus de typage plus strict)
7. **Validation live obligatoire** : `npm run dev` (port 5173/5174) + requêtes HTTP réelles via `mcp__plugin_context-mode_context-mode__ctx_execute` (python, `urllib.request`) + compte seedé `admin@izigsm.fr`/`Admin@2026!`. Tester le cycle complet quand une fonction migrée est un maillon d'un flux plus large partagé avec des fonctions non migrées (ex. `getBonCommande` migrée doit rendre correctement les données écrites par `createBonCommande`/`receptionnerBonCommande` non migrées — c'est le point d'intégration le plus susceptible de révéler un bug de câblage)
8. Nettoyer les données de test après coup (accès direct SQLite local via `ctx_execute` python)
9. Mettre à jour `todo.md` (service coché) et `bugs.md` (si bug découvert)

## Fichiers importants
- `src/lib/timezone.ts`, `src/ports/database.ts`, `src/adapters/cloudflare/d1Database.ts`, `tests/helpers/mockDatabase.ts`
- `src/services/fournisseursService.ts` — migration 2026-07-14, 6/12
- `src/routes/fournisseurs.ts` — premier ajout de `Variables.db` dans ce fichier
- `project-docs/todo.md` — ordre de migration des 8 services restants
- `project-docs/bugs.md` — bugs RGPD `clientService.ts` corrigés au checkpoint 9

## Bugs connus (détail complet dans `bugs.md`)
- `boutique_creneaux` vide, aucune UI de config → prise de RDV en ligne sans créneaux
- `www.repairdesk.fr` → 521 (Gandi, hors de notre contrôle)
- `/factures/:id/emettre` n'envoie aucun email
- 3 tests unitaires sensibles au fuseau horaire (non-bloquant)

## Contraintes
- Ne jamais toucher aux records MX/SPF/webmail de `repairdesk.fr`
- Ne jamais faire transiter de secret en clair dans la conversation
- Commenter systématiquement le code ajouté (JSDoc backend expliquant le rôle architectural)
- Ne jamais ajouter `Co-Authored-By: Claude` dans les commits
- Toujours proposer avant modification/suppression de fichier existant
- Migrations de schéma touchant `factures`/`avoirs`/`journal_nf525` (NF525) → validation explicite obligatoire avant exécution
- Bandeaux `════` pour les regroupements logiques d'endpoints dans les fichiers routes

## État git au moment de ce checkpoint
Checkpoints 6/7/8/9 (11/20) commités et pushés (`485dd02`), **pas encore déployés**. Checkpoint 10 (`fournisseursService.ts`, 12/20) : `src/services/fournisseursService.ts`, `src/routes/fournisseurs.ts`, `tests/fournisseursService.test.ts` + docs `project-docs/`, **pas encore commité**.

## Prochaines étapes recommandées
1. Commit du travail de ce checkpoint (proposé, en attente de confirmation utilisateur)
2. Continuer la migration : `servicesService.ts` (candidat #13, 22 fonctions, le plus large en surface) ou `ticketService.ts` (#14, `||` ×9, calcul d'âge julianday/datetime — 1er candidat nécessitant `lib/timezone.ts`)
3. Poursuivre l'ordre établi dans `todo.md` jusqu'aux 8 services restants
4. Appliquer `lib/timezone.ts` à `ticketService.ts`/`garantiesService.ts`/`agendaService.ts`/`statsService.ts` lors de leur migration
5. Envisager un déploiement groupé — 5 checkpoints non déployés à ce stade (6, 7, 8, 9, 10)
