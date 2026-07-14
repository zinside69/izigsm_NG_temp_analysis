# Recovery Prompt — iziGSM — 2026-07-14 (checkpoint 9)

## Vue d'ensemble
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant de gestion pour centres de réparation GSM. Repo : `izigsm/webapp/` (racine git), remote GitHub `zinside69/izigsm_NG_temp_analysis`, branche `main`. Objectif long terme : sortir de Cloudflare (VPS + Postgres) sans changer le CDC fonctionnel — chantier Ports & Adapters en cours depuis le 2026-07-12, engagé mais loin d'être terminé.

## Architecture actuelle
- Backend Hono/TypeScript sur Cloudflare Workers, pattern Controller (`routes/`) → Service (`services/`) → jamais de SQL inline dans une route
- **Pattern Ports & Adapters** : `src/ports/database.ts` (interface `Database` : `all/get/run`, SQL brut) + `src/adapters/cloudflare/d1Database.ts` (implémentation D1, seule active), injecté via middleware global (`src/index.tsx`, `c.set('db', new D1DatabaseAdapter(c.env.DB))`) et lu dans les routes via `c.get('db')`
- **11/20 services migrés** (voir `todo.md` pour la liste complète et l'ordre) : `userService`, `photosService`, `publicService`, `boutiqueService`, `rachatService`, `personnelService`, `caisseService`, `factureService`, `devisService`, `authService`, `stockService`, `clientService` (2026-07-14)
- **Règle de migration établie** : toute fonction dépendant d'`auditLog()`, `nextNumero()`, `enregistrerTransaction()` (lib/nf525.ts) ou `db.batch()` reste sur `D1Database` brut. `clientService.ts` est quasi intégral (11/12, seule `purgeClient` bloquée) — même profil qu'`authService.ts`/`publicService.ts`/`boutiqueService.ts`.
- **Pattern routes mixtes (`dbPort`/`db`)** : particularité découverte avec `clientService.ts` — certaines routes appellent `auditLog()` **directement dans le controller** (pas dans le service), donc même un service migré à 100% peut nécessiter que sa route garde `db` (D1Database) en plus de `dbPort`, simplement pour ces appels d'audit locaux. Vu dans `routes/clients.ts` (4 endpoints : create/update/delete/import-csv).
- **`src/lib/timezone.ts`** (2026-07-12) : `parseUtcTimestamp()`, `todayParis()`, `currentMonthParis()`. Appliqué à `personnelService.ts`/`caisseService.ts`. Sans objet pour `authService.ts`/`stockService.ts`/`clientService.ts`.

## Méthodologie de migration (à répéter pour chaque service restant)
1. Lire le service + son fichier de test + les routes qui l'appellent (attention : un service peut être appelé depuis plusieurs fichiers routes — `clientService.ts` l'était depuis 3 : `clients.ts`, `sav.ts`, `tickets.ts`)
2. Identifier les fonctions bloquées par `auditLog`/`nextNumero`/`enregistrerTransaction`/`batch` **dans le service** → restent sur `D1Database`. Vérifier aussi si la **route elle-même** appelle `auditLog()` directement (cas `clientService.ts`) — dans ce cas garder `db` en plus de `dbPort` dans le handler concerné, même si la fonction service appelée est migrée
3. Migrer les autres vers `Database` (`db.prepare().bind().first()` → `db.get()`, `.all()` → `db.all()`, `.run()` → `db.run()`)
4. Si une fonction migrée est appelée en interne par une autre fonction migrée du même service (ex. `exportClientRgpd()` appelle `getClientById()`), les deux doivent accepter le même type `Database` — cohérent si migrées ensemble
5. Mettre à jour toutes les routes concernées (`c.env.DB` → `c.get('db')` uniquement pour les appels aux fonctions migrées) — si une route n'a pas encore de typage `Variables.db`, l'ajouter (`type Variables = { ...; db: Database }`)
6. Mettre à jour les tests (`mockD1` → `mockDatabase` par describe-block ; les blocs qui testent une fonction restée sur D1 gardent `mockD1`)
7. `npx vitest run tests/` (zéro régression) + `npx tsc --noEmit` (comparer via `git stash` — les diffs attendus sont de simples décalages de ligne ; un diff qui *supprime* une erreur sans en ajouter est un bonus, pas un problème)
8. **Validation live obligatoire** : `npm run dev` (port 5173/5174) + requêtes HTTP réelles via `mcp__plugin_context-mode_context-mode__ctx_execute` (python, `urllib.request`) + compte seedé `admin@izigsm.fr`/`Admin@2026!`. **Tester aussi les points d'intégration externes au service** (ex. hooks email dans d'autres routes qui appellent une fonction tout juste migrée) — c'est souvent là que se cachent les bugs, pas dans le CRUD principal déjà bien testé unitairement
9. Nettoyer les données de test après coup (accès direct SQLite local `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` via `ctx_execute` python) — inclure les entités "invisibles" après une opération (ex. un client anonymisé par RGPD n'apparaît plus dans un `LIKE '%TestClient%'`, chercher aussi par le nouveau nom `RGPD-{id}`)
10. Mettre à jour `todo.md` (service coché) et `bugs.md` (si bug découvert)

## Leçon du checkpoint 9 : la couverture de tests unitaires ne garantit rien contre un schéma invalide
`exportClientRgpd()`/`purgeClient()` avaient 10 tests unitaires dédiés (Sprint 2.41-D) et étaient **100% cassés en production** (table + colonne inexistantes) sans qu'aucun test ne le détecte — les mocks (`mockD1`/`mockDatabase`) matchent le SQL par chaîne de caractères, ils ne valident jamais contre un schéma réel. **Seule la validation live (étape 8) a révélé ces bugs.** Ne jamais considérer un service "sûr" sur la seule base de tests unitaires verts — la validation live n'est pas une formalité, c'est le seul filet qui attrape ce type de bug.

## Bandeaux de section (convention établie le 2026-07-13)
Pour les fichiers `routes/*.ts` : bandeaux `════` (pas `───`) pour grouper les endpoints par logique métier. Les fichiers `services/*.ts` gardent leur convention existante (`───` par fonction).

## Fichiers importants
- `src/lib/timezone.ts`, `src/ports/database.ts`, `src/adapters/cloudflare/d1Database.ts`, `tests/helpers/mockDatabase.ts`
- `src/services/clientService.ts` — migration 2026-07-14, 11/12, + 2 bugs RGPD corrigés (table/colonne invalides)
- `src/routes/clients.ts`, `src/routes/sav.ts`, `src/routes/tickets.ts` — les 3 routeurs mis à jour pour cette migration
- `project-docs/todo.md` — ordre de migration des 9 services restants
- `project-docs/bugs.md` — détail des bugs RGPD découverts et corrigés

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
Checkpoints 6/7/8 (`devisService.ts`, `authService.ts`, `stockService.ts`, 10/20) commités et pushés (`897ff1c`), **pas encore déployés**. Checkpoint 9 (`clientService.ts`, 11/20) : `src/services/clientService.ts`, `src/routes/clients.ts`, `src/routes/sav.ts`, `src/routes/tickets.ts`, `tests/clientService.test.ts` + docs `project-docs/`, **pas encore commité**.

## Prochaines étapes recommandées
1. Commit du travail de ce checkpoint (proposé, en attente de confirmation utilisateur)
2. Continuer la migration : `fournisseursService.ts` (candidat #12, 25 requêtes) ou `servicesService.ts` (#13, 22 fonctions, le plus large en surface)
3. Poursuivre l'ordre établi dans `todo.md` jusqu'aux 9 services restants
4. Appliquer `lib/timezone.ts` à `ticketService.ts`/`garantiesService.ts`/`agendaService.ts`/`statsService.ts` lors de leur migration
5. Envisager un déploiement groupé — 4 checkpoints non déployés à ce stade (6, 7, 8, 9)
