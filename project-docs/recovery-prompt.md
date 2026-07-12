# Recovery Prompt — iziGSM — 2026-07-12 (checkpoint 4)

## Vue d'ensemble
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant de gestion pour centres de réparation GSM. Repo : `izigsm/webapp/` (racine git), remote GitHub `zinside69/izigsm_NG_temp_analysis`, branche `main`. Objectif long terme confirmé cette session : pouvoir héberger sur un VPS avec sa propre base de données (Postgres), sans dépendre de Cloudflare — chantier engagé aujourd'hui (voir ci-dessous), pas terminé.

## Architecture actuelle
- Backend Hono/TypeScript sur Cloudflare Workers, pattern Controller (`routes/`) → Service (`services/`, tout le SQL) → jamais de SQL inline dans une route
- **Nouveau depuis aujourd'hui** : pattern Ports & Adapters en cours d'introduction — `src/ports/database.ts` (interface `Database` : `all/get/run`, SQL brut) + `src/adapters/cloudflare/d1Database.ts` (implémentation D1, seule active). Un seul service migré à ce stade : `userService.listUsers()`. Les 17 autres services restent sur `D1Database` direct — migration prévue service par service, pas en bloc.
- Frontend HTML/CSS/JS vanilla, `ApiService` centralisé dans `app.js`
- Isolation multi-tenant par ligne (`boutique_id` sur toutes les tables métier), une seule base D1 partagée

## Ce qui s'est passé aujourd'hui (2026-07-12)

1. **Brainstorming architecture** (session longue) — l'utilisateur a proposé une réécriture complète en microservices + BFF PHP, inspirée d'un CDC reverse-engineered (`CDC_Manus.md`) et d'un fichier `docs/ARCHITECTURAL_PRINCIPLES.md` découvert en cours de route (daté 16 février 2026, jamais respecté par le code réel — jugé obsolète/aspirationnel par l'utilisateur, décision explicite de ne pas s'y conformer). Après cadrage, le vrai besoin identifié : portabilité VPS/Postgres, pas un découpage microservices ni un changement de langage (Hono tourne déjà nativement sur Node.js).
2. **Spec approuvé** : `docs/superpowers/specs/2026-07-12-architecture-ports-adapters-design.md` — Ports & Adapters, monolithe Hono conservé, Drizzle ORM pour le schéma/migrations futures, Postgres ciblé (pas MariaDB — JSONB natif), clés INTEGER conservées (pas UUID), disque local pour le storage VPS futur (MinIO écarté — dégradation FOSS 2025), Redis pour le cache futur.
3. **Plan exécuté en mode subagent-driven** (6 tâches, `docs/superpowers/plans/2026-07-12-ports-adapters-technicien-assignment.md`) : port `Database` + adaptateur D1 + mock de test + migration `userService.listUsers()` + injection Hono + `populateTechniciens()` (fonctionnalité demandée à l'origine : le select technicien à la création de ticket avait 3 noms en dur, jamais branché sur `technicien_id`). Toutes les tâches approuvées en revue individuelle + revue finale de branche ("Ready to merge: Yes").
4. **2 corrections appliquées après la revue finale** (déployées et validées en prod) :
   - `technicien_id` n'était jamais vérifié contre le `boutique_id` du ticket (faille d'isolation multi-tenant, pré-existante mais devenue exploitable avec `populateTechniciens()`) — corrigé, testé (5 nouveaux tests), validé en live (rejet 422 cross-boutique confirmé, création réussie same-boutique confirmée).
   - `editTicket()` ne présélectionnait plus le technicien assigné (régression du jour, cosmétique, zéro perte de données grâce à `COALESCE`) — corrigé.
5. **Bug prod découvert, investigué et CORRIGÉ** : `POST /api/tickets` → 500 sur Desk1 (boutique_id=3). Root cause : `numero` avait une contrainte `UNIQUE` **globale** sur 5 tables (tickets/factures/devis/avoirs/rachats) alors que les compteurs `sequences` sont calculés indépendamment par boutique — collision garantie dès que deux boutiques partagent le même préfixe par défaut (le cas partout). Pas isolé à Desk1 : SOTELI (boutique 2) aurait heurté le même mur à sa première création de document. **Fix appliqué le même jour** (migration `migrations/0034_numero_unique_par_boutique.sql`, `UNIQUE(boutique_id, numero)` sur les 5 tables, recréation de table SQLite) — découverte favorable : `factures`/`devis`/`avoirs`/`rachats` étaient vides en prod (0 ligne), risque NF525 sur données existantes finalement nul. Testé en local avant application prod, puis validé en live : création de ticket Desk1 → 201 (`TKT-2026-00007`, exactement le numero qui collisionnait avant).

## Décisions prises aujourd'hui (détail complet dans `decisions.md` — à mettre à jour si besoin de plus de détail)
- Ports & Adapters plutôt que microservices ou réécriture PHP — voir spec §Décision d'architecture
- `userService.listUsers()` comme premier service migré plutôt que `personnelService.ts` (exemple du spec) — zéro test préexistant à risquer
- Port `Database` en SQL brut plutôt que query-builder Drizzle — évite de forcer la réécriture de requêtes SQLite complexes (sous-requêtes corrélées) dès maintenant
- `docs/ARCHITECTURAL_PRINCIPLES.md` jugé obsolète/aspirationnel, pas appliqué
- Migration numérotation (5 tables) décidée mais différée à une session dédiée — risque NF525

## Fichiers importants
- `docs/superpowers/specs/2026-07-12-architecture-ports-adapters-design.md` — spec architecture (avec addendum portabilité dialecte SQL)
- `docs/superpowers/plans/2026-07-12-ports-adapters-technicien-assignment.md` — plan d'implémentation (6 tâches, toutes complétées)
- `.superpowers/sdd/progress.md` — ledger détaillé de l'exécution subagent-driven (tâche par tâche, revues, correctifs)
- `src/ports/database.ts`, `src/adapters/cloudflare/d1Database.ts` — nouveau pattern Ports & Adapters
- `project-docs/bugs.md` — root cause complète du bug numérotation (preuves DB incluses)
- `project-docs/todo.md` — chantier Ports & Adapters + bug numérotation, tâches restantes détaillées

## Bugs connus (détail complet dans `bugs.md`)
- **Numérotation documents non isolée par boutique** (nouveau, root cause confirmée aujourd'hui) — Desk1 bloquée, SOTELI latente. Fix décidé, non exécuté.
- `boutique_creneaux` vide, aucune UI de config → prise de RDV en ligne sans créneaux
- `www.repairdesk.fr` → 521 (Gandi, hors de notre contrôle)
- `/factures/:id/emettre` n'envoie aucun email
- 3 tests unitaires sensibles au fuseau horaire (non-bloquant, toujours présents : 712/715 puis stable)
- `populateTechniciens()` liste tous les rôles (admin/manager/technicien), pas juste les techniciens — fonctionnel mais sémantiquement flou
- Pas de test dédié pour `D1DatabaseAdapter`

## Contraintes
- Ne jamais toucher aux records MX/SPF/webmail de `repairdesk.fr`
- Ne jamais faire transiter de secret en clair dans la conversation
- Commenter systématiquement le code ajouté (JSDoc backend expliquant le rôle architectural, pas juste la signature)
- Ne jamais ajouter `Co-Authored-By: Claude` dans les commits
- Toujours proposer avant modification/suppression de fichier existant
- Migrations de schéma touchant `factures`/`avoirs` (NF525) → validation explicite obligatoire avant exécution, jamais en fin de session

## Prochaines étapes recommandées
1. Continuer la migration des 17 services restants vers le port `Database` (rollout service par service, un candidat simple à la fois)
2. `populateTechniciens()` : envisager un filtre par rôle ou un endpoint dédié accessible aux techniciens (actuellement admin/manager only)
3. Reprendre les chantiers déjà identifiés avant aujourd'hui : multi-appareils/ticket, acompte structuré, purge RGPD auto, UI créneaux bookables (voir `todo.md` pour le détail complet)
