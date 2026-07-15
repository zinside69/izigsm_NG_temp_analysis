# iziGSM — État courant (MàJ : 2026-07-15, checkpoint 14)

## Chantier Ports & Adapters — 16/20 services migrés (session du 2026-07-15)
- **phoneCatalogService.ts** (2026-07-15) — 5/5 fonctions migrées intégralement, aucune dépendance `auditLog`/`nextNumero`. **0 test existant avant** (seul service sans couverture) → `tests/phoneCatalogService.test.ts` créé (11 tests, `fetch` mocké). **Validé en local live** : sync-brands (126), sync-modeles fairphone (5/5), sync-selected cat (22/22), stats cohérentes.

## Chantier Ports & Adapters — 15/20 services migrés (session du 2026-07-15)
- **reconditionnementService.ts** (2026-07-15) — 12/13 fonctions migrées (tout sauf `createOrdre`, dépendant de `nextNumero()`). Aucun `auditLog()` dans ce fichier. `routes/reconditionnement.ts` : `Variables.db`/`dbPort` ajoutés de zéro (2 routers). Tests scindés (50/50 ✅). **Validé en local live** : cycle ordre complet (création→en_cours→terminer avec produit occasion créé) + cycle bon d'achat (créer→lister→vérifier→annuler), 10/11 ✅ (consommation bloquée par FK factures vide en local, attendu).

## Chantier Ports & Adapters — 14/20 services migrés (session du 2026-07-15)
- **ticketService.ts** (2026-07-15) — 6/11 fonctions migrées (`listTickets`, `getKanban`, `getTicketById`, `getTicketBoutiqueId`, `getTicketAvecClient` + `checkAndArchiveTickets`, cette dernière sans dépendance `auditLog`). Les 5 fonctions restantes (`createTicket`/`updateTicket`/`updateStatutTicket`/`deleteTicket`/`archiveTicket`) restent sur `D1Database`. Bonus sécurité : SQL interpolé (`boutique_id = ${boutiqueId}`) remplacé par un paramètre lié dans `checkAndArchiveTickets`. `lib/timezone.ts` appliqué au calcul `en_retard` de `getKanban()` (`parseUtcTimestamp` sur `date_promesse`). Tests scindés `mockDatabase`/`mockD1` (45/45 ✅, 3 nouveaux). **Validé en local live** : cycle complet création→statuts→hooks garantie/email→archivage, 6/6 ✅.

## Chantier Ports & Adapters — 13/20 services migrés (session du 2026-07-15)
- **servicesService.ts** (2026-07-15) — 8/22 fonctions migrées (toutes lecture pure : `listCategories`, `listServices`, `getService`, `getCatalogueArbre`, `listMarques`, `listModeles`, `getServicesByModele`, `getModeleWithServices`). Les 14 fonctions d'écriture (create/update/delete catégories/services/marques/modeles + link/unlink) restent sur `D1Database` — chacune appelle `auditLog()` directement. `routes/services.ts` : `Variables.db` ajouté. Tests scindés `mockDatabase`/`mockD1` (38/38 ✅, 7 nouveaux tests écrits pour des fonctions jusque-là non couvertes). **Bug préexistant corrigé** (Sprint 2.38, sans lien) : `GET /services/marques`/`GET /services/modeles` inaccessibles depuis toujours (collision de route avec `/services/:id`) — détail `bugs.md`. **Validé en local live** : 12/14 étapes du cycle catégorie→service→catalogue→marque→modèle→liaison ✅ (liaison INSERT bloquée par un artefact CLI wrangler local déjà connu, sans lien avec le code).


## Ce qui fonctionne en production (`https://repairdesk.fr`)
- Tout ce qui était opérationnel au checkpoint 4 (migration Cloudflare, auth, slug boutiques, chantier prise en charge, technicien_id, numérotation par boutique) — toujours en place, aucune régression.
- Checkpoint 5 (7 services Ports & Adapters + `lib/timezone.ts` + 2 bugs NF525) commité et déployé (commit `5bcea99`).
- Checkpoints 6/7/8/9 (`devisService.ts`, `authService.ts`, `stockService.ts`, `clientService.ts`, 11/20 services) commités et pushés (`485dd02`) — **pas encore déployés** au moment de cette mise à jour.
- **⚠ Le travail décrit ci-dessous (checkpoint 10, migration `fournisseursService.ts`) n'est PAS encore commité ni déployé** — développé, testé (unitaire + local live complet), pas encore buildé/déployé sur Cloudflare Pages ni poussé sur `origin/main`.

## Chantier Ports & Adapters — 12/20 services migrés (session du 2026-07-14)
- **fournisseursService.ts** (2026-07-14) — 6/12 fonctions migrées (`listFournisseurs`, `getFournisseur`, `listBonsCommande`, `getBonCommande`, `getKpisFournisseurs`, `getProduitsACommander`). `createFournisseur`/`updateFournisseur`/`deleteFournisseur`/`createBonCommande`/`updateStatutBonCommande`/`receptionnerBonCommande` restent sur `D1Database` (dépendent d'`auditLog`). `routes/fournisseurs.ts` n'avait aucun pattern `dbPort`/`db` avant cette migration — ajouté de zéro (`Variables.db`). Tests scindés `mockDatabase`/`mockD1` (65/65 ✅). Bonus : 5 erreurs TypeScript préexistantes corrigées en passant (casts non-sûrs remplacés par des génériques correctement typés). **Validé en local live** : CRUD fournisseur, CRUD bon de commande, cycle complet réception avec recalcul CUMP (stock 5→8, `prix_achat_cump` mis à jour, statut→`received`), KPIs, vue "à commander" — 12/12 fonctions couvertes, données de test nettoyées.

## Chantier Ports & Adapters — 11/20 services migrés (session du 2026-07-14)
- **clientService.ts** (2026-07-14) — 11/12 fonctions migrées (toutes sauf `purgeClient`, dépendante d'`auditLog`). Câblage `routes/clients.ts` (`dbPort`/`db` mixte), `routes/sav.ts` (nouveau `Variables.db`), `routes/tickets.ts` (`dbPort` ajouté à `POST /`). Tests scindés `mockDatabase`/`mockD1` (48/48 ✅). **2 bugs RGPD critiques découverts et corrigés en live** : `exportClientRgpd()`/`purgeClient()` cassés depuis toujours (table `appareils_client` inexistante + colonne `imei` inexistante sur `tickets`) — droit d'accès (Art. 15) et droit à l'effacement (Art. 17) RGPD n'avaient jamais fonctionné en production malgré 48 tests unitaires verts. Détail complet `bugs.md`. **Validé en local live** : CRUD client, appareils, historique CRM, import CSV, export RGPD, purge RGPD (+ idempotence), hooks email tickets/SAV — 11/12 fonctions couvertes, données de test nettoyées.

## Chantier Ports & Adapters — 10/20 services migrés (session du 2026-07-14)
- **stockService.ts** (2026-07-14) — 6/10 fonctions migrées (`listProduits`, `getProduitById`, `enregistrerMouvement`, `listCategories`, `createCategorie`, `getKpisStock`). `createProduit`/`updateProduit`/`deleteProduit`/`importCatalogueCsv` restent sur `D1Database` (dépendent d'`auditLog`). `routes/stocks.ts` : helper `ctx()` étendu avec `dbPort` en plus de `db`. Tests scindés `mockDatabase`/`mockD1` (56/56 ✅). **Validé en local live** : les 10 fonctions couvertes (create/list catégorie, create/get/list produit, KPIs, mouvement stock, update/delete produit, import CSV), données de test nettoyées.

## Chantier Ports & Adapters — 9/20 services migrés (session du 2026-07-14)
- **authService.ts** (2026-07-14) — 13/13 fonctions migrées **intégralement** (aucune dépendance `auditLog`/`nextNumero`/`batch`), 1er service sensible sécurité du chantier. `routes/auth.ts` câblé sur `c.get('db')` pour les 13 fonctions ; `auditLog`/`sendEmail` (non migrés) restent sur `c.env.DB`. Tests → `mockDatabase`, 25/25 ✅. **Validé en local live** : login, /me, refresh, register→verify-otp (avec/sans boutique), resend-otp, complete-onboarding (+ idempotence testée), reset-password-request→reset-password (mdp admin restauré après test), logout — 12/13 fonctions couvertes en conditions réelles (Google OAuth exclu, nécessite un vrai token externe). Détail complet dans `todo.md`.

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
