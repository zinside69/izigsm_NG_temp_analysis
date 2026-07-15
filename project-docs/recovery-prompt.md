# Recovery Prompt — iziGSM — 2026-07-15 (checkpoint 18 — chantier Ports & Adapters TERMINÉ)

## Vue d'ensemble
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant de gestion pour centres de réparation GSM. Repo : `izigsm/webapp/` (racine git), remote GitHub `zinside69/izigsm_NG_temp_analysis`, branche `main`. Objectif long terme : pouvoir sortir de Cloudflare (VPS + Postgres) sans changer le CDC fonctionnel — chantier Ports & Adapters démarré le 2026-07-12, **terminé le 2026-07-15**.

## Architecture actuelle
- Backend Hono/TypeScript sur Cloudflare Workers, pattern Controller (`routes/`) → Service (`services/`) → jamais de SQL inline dans une route
- **Pattern Ports & Adapters, chantier complet** : `src/ports/database.ts` (interface `Database` : `all/get/run`, SQL brut) + `src/adapters/cloudflare/d1Database.ts` (implémentation D1, seule active), injecté via middleware global (`src/index.tsx`, `c.set('db', new D1DatabaseAdapter(c.env.DB))`) et lu dans les routes via `c.get('db')`
- **20/20 services passés par le chantier** — chacun migré au moins partiellement. Règle de migration constante sur tout le chantier : toute fonction dépendant d'`auditLog()`, `nextNumero()`, `enregistrerTransaction()` ou `db.batch()` reste sur `D1Database` brut (`c.env.DB`), le reste passe par le port `Database` (`c.get('db')`). Certains services (emailService, agendaService, phoneCatalogService, garantiesService à 90%, reconditionnementService à 92%) n'avaient aucune dépendance bloquante et sont migrés **intégralement**.
- **`src/lib/timezone.ts`** (créé le 2026-07-12, complété le 2026-07-15) : `parseUtcTimestamp()`, `todayParis()`, `currentMonthParis()` — appliqués systématiquement partout où une borne "aujourd'hui"/"ce mois-ci" était déléguée à `DATE('now')`/`strftime(...,'now')` (UTC serveur D1) ou à `new Date()` local (ambigu hors Cloudflare Workers). Services traités : `personnelService.ts`, `caisseService.ts` (2026-07-12), `ticketService.ts` (`getKanban`), `garantiesService.ts` (vérifié, rien à corriger — comparaisons UTC↔UTC pures), `agendaService.ts` (`getKpisAgenda` + `getWeekStart`/`getWeekEnd` refaits en arithmétique UTC pure), `statsService.ts` (toutes les fonctions à borne temporelle, + 2 helpers locaux `addDaysParis`/`addMonthsParis`).

## Historique des 20 checkpoints (services migrés, dans l'ordre)
1-5. `photosService`, `publicService`, `boutiqueService`, `rachatService`, `personnelService` (2026-07-12)
6-8. `caisseService`, `factureService`, `devisService` (2026-07-12/13)
9-12. `authService`, `stockService`, `clientService`, `fournisseursService` (2026-07-14)
13. `servicesService.ts` — 8/22 fonctions (2026-07-15)
14. `ticketService.ts` — 6/11 fonctions, fix SQL injection `checkAndArchiveTickets` (2026-07-15)
15. `reconditionnementService.ts` — 12/13 fonctions (2026-07-15)
16. `phoneCatalogService.ts` — 5/5 intégral, 0→11 tests créés (2026-07-15)
17. `emailService.ts` — 13/13 intégral, fix `processRelancesDevis` colonne `montant_ttc` (2026-07-15)
18. `garantiesService.ts` — 9/10 fonctions (2026-07-15)
19. `agendaService.ts` — 12/12 intégral, fix `getWeekStart`/`getWeekEnd` UTC-safe (2026-07-15)
20. `statsService.ts` — 10/10 intégral, fix `mode_paiement` (2 endpoints cassés depuis toujours), **dernier service** (2026-07-15)

## Bugs préexistants découverts et corrigés pendant le chantier (détail complet : `bugs.md`)
- Route `/services/marques`+`/services/modeles` inaccessibles depuis Sprint 2.38 (collision avec `/services/:id`)
- SQL injection potentielle dans `checkAndArchiveTickets` (interpolation `boutique_id` non paramétrée)
- `processRelancesDevis()` — colonne `montant_ttc` inexistante (vraie colonne : `total_ttc`) — relance devis batch cassée depuis toujours
- `exportCsvCa()`/`getRapportComptable()` — colonne `mode_paiement` inexistante sur `factures` (vit sur `paiements`) — 2 endpoints cassés depuis toujours
- Test "1er du mois courant" (pré-existant non-bloquant depuis 2026-07-09) réparé par la migration timezone
- 2 bugs RGPD critiques (`clientService.ts`, checkpoint 11, 2026-07-14) — voir historique précédent

## Bugs préexistants non corrigés (hors périmètre migration, décision de conception requise)
- `routes/auth.ts:481` — `sendEmail()` appelée avec une arité incorrecte (5 args au lieu d'un objet) — email de réinitialisation mot de passe jamais envoyé. Nécessite de choisir entre adapter `sendEmail()` (boutique-scopé) ou créer un nouveau helper système (façon `sendOtpInscription`) pour ce cas hors-boutique.
- `computeFin()` (`agendaService.ts`) — `new Date(debut)` sans suffixe de fuseau, ambigu sur machine non-UTC (sans impact production, Workers = UTC). 2 tests unitaires non-bloquants documentés.
- `boutique_creneaux` vide, aucune UI de config → prise de RDV en ligne sans créneaux
- `www.repairdesk.fr` → 521 (Gandi, hors de notre contrôle)
- `/factures/:id/emettre` n'envoie aucun email

## Contraintes
- Ne jamais toucher aux records MX/SPF/webmail de `repairdesk.fr`
- Ne jamais faire transiter de secret en clair dans la conversation
- Commenter systématiquement le code ajouté (JSDoc backend expliquant le rôle architectural)
- Ne jamais ajouter `Co-Authored-By: Claude` dans les commits
- Toujours proposer avant modification/suppression de fichier existant
- Migrations de schéma touchant `factures`/`avoirs`/`journal_nf525` (NF525) → validation explicite obligatoire avant exécution
- Bandeaux `════` pour les regroupements logiques d'endpoints dans les fichiers routes

## État git au moment de ce checkpoint
Tous les checkpoints du chantier (13 à 20 de cette session, soit 8 commits) sont commités, rebasés et pushés sur `origin/main`. Working tree propre. Suite de tests : 791/793 (2 échecs pré-existants confirmés, `computeFin()` sensible au fuseau machine, sans impact production).

## Prochaines étapes recommandées
1. **Déploiement en production** — plusieurs checkpoints (depuis le 6, session du 2026-07-14) ne sont pas encore déployés sur `repairdesk.fr`. Un déploiement groupé complet du chantier est à planifier avec l'utilisateur (build → test → déploiement → validation).
2. Traiter les 2 bugs non corrigés listés ci-dessus (reset password, `computeFin`) si prioritaires.
3. Hors chantier Ports & Adapters : purge RGPD automatique, multi-sites géré, rebranding "Mon Atelier"→"MyDesk", programme de parrainage — voir `todo.md` pour le détail complet.
4. Si la bascule VPS/Postgres est engagée un jour : adaptateur `PostgresDatabase` implémentant `src/ports/database.ts`, + traduction des dialectes SQLite-only (`julianday()`, `datetime('now', ...)`, `||`, `INSERT ... RETURNING`) — documenté comme limite connue dans `bugs.md`.
