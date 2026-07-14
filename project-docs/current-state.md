# iziGSM — État courant (MàJ : 2026-07-13, checkpoint 6)

## Ce qui fonctionne en production (`https://repairdesk.fr`)
- Tout ce qui était opérationnel au checkpoint 4 (migration Cloudflare, auth, slug boutiques, chantier prise en charge, technicien_id, numérotation par boutique) — toujours en place, aucune régression.
- Checkpoint 5 (7 services Ports & Adapters + `lib/timezone.ts` + 2 bugs NF525) commité et déployé (commit `5bcea99`).
- **⚠ Le travail décrit ci-dessous (checkpoint 6, migration `devisService.ts`) n'est PAS encore commité ni déployé** au moment de cette mise à jour — développé, testé (unitaire + local live), pas encore buildé/déployé sur Cloudflare Pages ni poussé sur `origin/main`.

## Chantier Ports & Adapters — 8/20 services migrés (session du 2026-07-13)
Pattern établi : `src/ports/database.ts` (interface `Database`) + `src/adapters/cloudflare/d1Database.ts` (adaptateur D1). Ordre de migration complet dans `todo.md`. Fonctions dépendant d'`auditLog()`/`nextNumero()`/`enregistrerTransaction()`/`db.batch()` (encore sur `D1Database` brut) restent non migrées au sein de chaque service — migration partielle assumée, pas un blocage.

Services migrés (dans l'ordre, cumulatif) :
1. `photosService.ts` — partiel (3/5 fns)
2. `publicService.ts` — intégral (8/8)
3. `boutiqueService.ts` — intégral (8/8)
4. `rachatService.ts` — partiel (3/5), 0 test existant → 17 écrits
5. `personnelService.ts` — partiel (8/9)
6. `caisseService.ts` — partiel (7/8), tests 14→31
7. `factureService.ts` — partiel (6/9), tests restructurés (41/41)
8. `devisService.ts` — partiel (6/10 fns : `listDevis`, `getDevis`, `getDevisByToken`, `getStatsDevis`, `expireDevisPerimes`, `saveSignatureDevis`). `createDevis`/`updateDevis`/`updateStatutDevis`/`convertirDevis` restent sur `D1Database` (dépendent de `nextNumero()`/`upsertLignes()`-batch/`auditLog()`). Tests scindés `mockDatabase`/`mockD1` (58/58). Câblage `routes/facturation.ts` + `routes/public.ts`. **Validé en local live** : cycle complet devis (créer→lister→consulter→stats→modifier→envoyer→consultation+réponse publique par token avec signature→expire→conversion facture), 10/10 ✅, données de test nettoyées.

Chaque service : migré, testé unitairement (`mockDatabase` pour les fonctions migrées, `mockD1` pour les restantes), vérifié sans nouvelle erreur `tsc`, **et validé en local live réelle** (`wrangler d1 migrations apply --local` + `npm run dev` + requêtes HTTP réelles, données de test nettoyées après coup) — exigence explicite de l'utilisateur.

## Fuseau horaire France — `src/lib/timezone.ts` (créé aujourd'hui)
`parseUtcTimestamp()` + `todayParis()` + `currentMonthParis()` (DST auto via Intl/ICU). Appliqué à `personnelService.ts` (bug réel corrigé : heures travaillées gonflées de l'écart local/UTC) et `caisseService.ts` (`DATE('now')`/`strftime` → jour/mois français, critique pour clôture NF525). Vérifié sur `factureService.ts` : rien à corriger (horodatages déjà UTC-Z explicites). Principe à appliquer lors de la migration de `ticketService.ts`, `garantiesService.ts`, `agendaService.ts`, `statsService.ts` (détail exact dans `todo.md`).

## 2 bugs de production découverts et corrigés aujourd'hui (sans lien avec la migration, confirmés pré-existants via `git show HEAD`)
- **`GET /api/rachats/export` → 404 depuis toujours** — collision de route avec `/rachats/:id` (déclarée avant). Fixé en réordonnant, même pattern que `/kanban` dans `tickets.ts`.
- **🔴 Vente POS d'un produit en stock cassée à 100% + facture orpheline NF525** — `mouvements_stock` INSERT référençait des colonnes inexistantes (`raison`/`reference_id` au lieu de `motif`, `stock_avant`/`stock_apres` NOT NULL jamais fournies). Conséquence grave : facture déjà `payee` créée avant le crash, sans entrée `journal_nf525` correspondante (violation de conformité). Corrigé, testé, revalidé en live (flux complet vente→KPIs→journal→clôture→intégrité chaîne).

## Bugs connus non corrigés (détail complet dans `bugs.md`)
- Prise de RDV en ligne : table `boutique_creneaux` vide, aucune UI pour la configurer
- `www.repairdesk.fr` → Error 521 (Gandi, indépendant de nous)
- `/factures/:id/emettre` n'envoie aucun email
- 3 tests unitaires sensibles au fuseau horaire (non-bloquant, stable, `agendaService`/`statsService`)
- `populateTechniciens()` liste tous les rôles (admin/manager/technicien), pas juste les techniciens
- Pas de test dédié pour `D1DatabaseAdapter`

## Chantiers identifiés pour plus tard (voir `todo.md` pour le détail complet)
- Continuer la migration des 12 services restants vers le port `Database` (prochain : `authService.ts`)
- Appliquer `lib/timezone.ts` à `ticketService.ts`/`garantiesService.ts`/`agendaService.ts`/`statsService.ts` lors de leur migration
- Ports `Storage`/`Cache`, adaptateur Postgres, bascule VPS — hors scope tant que non engagé
- Purge RGPD automatique, multi-sites géré, multi-appareils par ticket, acompte structuré, UI créneaux bookables, rebranding "Mon Atelier"→"MyDesk" — toujours en attente

## Repo et déploiement
- Repo : `izigsm/webapp/` (racine git), remote `zinside69/izigsm_NG_temp_analysis`, branche `main`
- **Rien déployé depuis le checkpoint 5** (`5bcea99`) — le travail du checkpoint 6 (`devisService.ts`) est local, testé, non buildé/non poussé au moment de cette mise à jour
- Suite de tests : 746/749 (mêmes 3 échecs fuseau horaire pré-existants, sans lien avec `devisService.ts`)
- Git : working tree avec modifications non commitées au moment de cette mise à jour (`src/services/devisService.ts`, `src/routes/facturation.ts`, `src/routes/public.ts`, `tests/devisService.test.ts`, `project-docs/todo.md`, `project-docs/current-state.md`) — commit à proposer à l'utilisateur
