# Recovery Prompt — iziGSM — 2026-07-14 (checkpoint 8)

## Vue d'ensemble
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant de gestion pour centres de réparation GSM. Repo : `izigsm/webapp/` (racine git), remote GitHub `zinside69/izigsm_NG_temp_analysis`, branche `main`. Objectif long terme : sortir de Cloudflare (VPS + Postgres) sans changer le CDC fonctionnel — chantier Ports & Adapters en cours depuis le 2026-07-12, engagé mais loin d'être terminé.

## Architecture actuelle
- Backend Hono/TypeScript sur Cloudflare Workers, pattern Controller (`routes/`) → Service (`services/`) → jamais de SQL inline dans une route
- **Pattern Ports & Adapters** : `src/ports/database.ts` (interface `Database` : `all/get/run`, SQL brut) + `src/adapters/cloudflare/d1Database.ts` (implémentation D1, seule active), injecté via middleware global (`src/index.tsx`, `c.set('db', new D1DatabaseAdapter(c.env.DB))`) et lu dans les routes via `c.get('db')`
- **10/20 services migrés** (voir `todo.md` pour la liste complète et l'ordre) : `userService`, `photosService`, `publicService`, `boutiqueService`, `rachatService`, `personnelService`, `caisseService`, `factureService`, `devisService`, `authService`, `stockService` (2026-07-14)
- **Règle de migration établie** : toute fonction dépendant d'`auditLog()`, `nextNumero()`, `enregistrerTransaction()` (lib/nf525.ts) ou `db.batch()` reste sur `D1Database` brut (ces helpers ne sont pas eux-mêmes portés) — migration **partielle** par service, assumée et documentée dans le JSDoc de chaque fonction non migrée. `stockService.ts` suit ce pattern partiel classique (6/10) — contrairement à `authService.ts`/`publicService.ts`/`boutiqueService.ts` qui sont migrés intégralement.
- **`src/lib/timezone.ts`** (2026-07-12) : `parseUtcTimestamp()`, `todayParis()`, `currentMonthParis()` — France Europe/Paris, DST automatique (Intl/ICU). Appliqué à `personnelService.ts` et `caisseService.ts`. À appliquer à `ticketService.ts`/`garantiesService.ts`/`agendaService.ts`/`statsService.ts` lors de leur migration (détail exact des lignes dans `todo.md`). Sans objet pour `authService.ts`/`stockService.ts` (aucun horodatage métier comparé à "aujourd'hui").
- **Pattern routes mixtes (`dbPort`/`db`)** : quand un service est migré partiellement, le helper `ctx(c)` de la route correspondante expose les deux — `dbPort` (`c.get('db')`, port `Database`) pour les fonctions migrées, `db` (`c.env.DB`, `D1Database` brut) pour les autres. Précédent établi par `routes/tickets.ts` (photosService), repris par `routes/stocks.ts` (stockService).

## Méthodologie de migration (à répéter pour chaque service restant)
1. Lire le service + son fichier de test + les routes qui l'appellent
2. Identifier les fonctions bloquées par `auditLog`/`nextNumero`/`enregistrerTransaction`/`batch` → elles restent sur `D1Database`
3. Migrer les autres vers `Database` (`db.prepare().bind().first()` → `db.get()`, `.all()` → `db.all()`, `.run()` → `db.run()`)
4. Si une fonction migrée est appelée en interne par une fonction non migrée : dupliquer la requête (courte) plutôt que de coupler le non-migré à l'adaptateur concret (précédent : `photosService.deletePhoto`, `caisseService.createVente`)
5. Mettre à jour les routes (`c.env.DB` → `c.get('db')` pour les fonctions migrées uniquement, pattern `dbPort`/`db` si migration partielle)
6. Mettre à jour les tests (`mockD1` → `mockDatabase` pour les fonctions migrées, scinder en deux variables `db`/`dbD1` dans le même fichier si migration partielle ; écrire les tests manquants si le service en manque)
7. `npx vitest run tests/` (zéro régression) + `npx tsc --noEmit` (comparer via `git stash`/`git show HEAD` si doute sur une erreur pré-existante — les diffs sont généralement de simples décalages de numéro de ligne dus aux imports ajoutés)
8. **Validation live obligatoire** : `npx wrangler d1 migrations apply izigsm-production --local` (déjà appliqué, à refaire si besoin) + `npm run dev` (port 5173/5174 si le premier est occupé) + requêtes HTTP réelles via `mcp__plugin_context-mode_context-mode__ctx_execute` (python, `urllib.request` — `curl`/`fetch` direct sont interceptés par context-mode) + compte seedé `admin@izigsm.fr`/`Admin@2026!`
9. Nettoyer les données de test après coup — accès direct au fichier SQLite local (`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`) via `sqlite3` Python dans le sandbox `ctx_execute` (KV émulée en D1 aussi, table `kv_store`)
10. Mettre à jour `todo.md` (service coché) et `bugs.md` (si bug découvert)

## Bandeaux de section (convention établie le 2026-07-13)
Pour les fichiers `routes/*.ts` : bandeaux `════` (pas `───`) pour grouper les endpoints par logique métier — voir [[feedback_section_banners]] en mémoire. Les fichiers `services/*.ts` gardent leur convention existante (`───` par fonction), ne pas la changer.

## Décisions/observations du checkpoint 8 (2026-07-14)
- `stockService.ts` : migration partielle classique 6/10 (contraste avec `authService.ts` la veille, migré intégralement) — `createProduit`/`updateProduit`/`deleteProduit`/`importCatalogueCsv` tous bloqués par `auditLog()`
- `enregistrerMouvement()` est migrée alors qu'elle fait 2 écritures (UPDATE stock + INSERT mouvement) — aucune dépendance `auditLog`, contrairement à `createVente()` (`caisseService.ts`) qui elle est restée non migrée pour la même raison de séquence multi-écriture mais couplée à `nextNumero()`
- Pattern `dbPort`/`db` dans `routes/stocks.ts` : 6 endpoints (`/produits/kpis`, `/produits` GET, `/produits/:id` GET, `/produits/:id/mouvement`, `/categories` GET/POST) sur `dbPort` ; 4 endpoints (`/produits` POST, `/produits/import-csv`, `/produits/:id` PUT/DELETE) sur `db`
- `importCatalogueCsv` validé en live avec `text/csv` (Content-Type) plutôt que JSON `{csvContent}` — les deux chemins existent dans la route, seul le premier testé cette session

## Fichiers importants
- `src/lib/timezone.ts` — utilitaire fuseau horaire France
- `src/ports/database.ts`, `src/adapters/cloudflare/d1Database.ts` — pattern Ports & Adapters
- `tests/helpers/mockDatabase.ts` — mock du port Database
- `src/services/stockService.ts` — migration 2026-07-14, partielle (6/10)
- `src/routes/stocks.ts` — pattern `dbPort`/`db` mixte
- `project-docs/todo.md` — ordre de migration complet des 10 services restants + items fuseau horaire
- `project-docs/bugs.md` — détail des bugs découverts et corrigés

## Bugs connus (détail complet dans `bugs.md`)
- `boutique_creneaux` vide, aucune UI de config → prise de RDV en ligne sans créneaux
- `www.repairdesk.fr` → 521 (Gandi, hors de notre contrôle)
- `/factures/:id/emettre` n'envoie aucun email
- 3 tests unitaires sensibles au fuseau horaire (`agendaService`/`statsService`, non-bloquant, sans lien avec `lib/timezone.ts`)

## Contraintes
- Ne jamais toucher aux records MX/SPF/webmail de `repairdesk.fr`
- Ne jamais faire transiter de secret en clair dans la conversation
- Commenter systématiquement le code ajouté (JSDoc backend expliquant le rôle architectural)
- Ne jamais ajouter `Co-Authored-By: Claude` dans les commits
- Toujours proposer avant modification/suppression de fichier existant
- Migrations de schéma touchant `factures`/`avoirs`/`journal_nf525` (NF525) → validation explicite obligatoire avant exécution
- Bandeaux `════` pour les regroupements logiques d'endpoints dans les fichiers routes (tous projets, pas seulement iziGSM)

## État git au moment de ce checkpoint
Checkpoints 6 et 7 (`devisService.ts`, `authService.ts`) commités et pushés (`f69e7a1`), **pas encore déployés**. Checkpoint 8 (`stockService.ts`, 10/20) : `src/services/stockService.ts`, `src/routes/stocks.ts`, `tests/stockService.test.ts` + docs `project-docs/`, **pas encore commité**.

## Prochaines étapes recommandées
1. Commit du travail de ce checkpoint (proposé, en attente de confirmation utilisateur)
2. Continuer la migration : `clientService.ts` (candidat #11, 22 requêtes) ou `fournisseursService.ts` (#12, 25 requêtes)
3. Poursuivre l'ordre établi dans `todo.md` jusqu'aux 10 services restants
4. Appliquer `lib/timezone.ts` à `ticketService.ts`/`garantiesService.ts`/`agendaService.ts`/`statsService.ts` à leur tour
5. Envisager un déploiement groupé une fois plusieurs services supplémentaires migrés (checkpoints 6, 7 et 8 tous non déployés à ce stade — 3 checkpoints en attente)
