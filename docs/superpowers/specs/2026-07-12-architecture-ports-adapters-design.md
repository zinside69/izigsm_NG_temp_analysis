# Design — Architecture Ports & Adapters (préparation sortie Cloudflare)

**Date** : 2026-07-12
**Statut** : validé par l'utilisateur, en attente de relecture finale avant plan d'implémentation

## Contexte et objectif

Objectif long terme de l'utilisateur : pouvoir héberger iziGSM sur son propre VPS avec sa propre base de données, sans dépendre de Cloudflare (Workers/D1/R2/D1KV). L'utilisateur avait initialement proposé une réécriture complète en "services indépendants communiquant via un router", inspirée du diagramme d'architecture du CDC_Manus (`docs/CDC_Manus.md` §2.1), avec passage envisagé vers un backend PHP/MariaDB.

Après cadrage (voir historique de session), le vrai besoin identifié est la **portabilité d'infrastructure**, pas un découpage en microservices ni un changement de langage. Le CDC_Manus décrit une architecture-cible générique/aspirationnelle (le document lui-même indique "Frontend : React probable" — une hypothèse, pas un audit du code réel), pas une contrainte technique à répliquer littéralement. Le CDC **fonctionnel** (§5.1 à §5.18, tous les modules/endpoints/règles métier) reste la source de vérité et n'est pas affecté par ce refactor.

## Constat de départ (vérifié dans le code)

- Les 18 services (`src/services/*.ts`) n'importent déjà jamais un autre service directement — pas de couplage service-à-service à corriger.
- Le vrai verrou Cloudflare est localisé : `c.env.DB` (D1Database), `c.env.PHOTOS` (R2Bucket), `lib/d1kv.ts` (KV maison sur D1).
- Hono (le framework backend) est portable nativement : tourne sur Cloudflare Workers, Node.js (`@hono/node-server`), Deno, Bun — aucune réécriture nécessaire pour changer de runtime de déploiement.
- Le frontend est HTML/JS vanilla statique, découplé du backend via REST/JSON — non affecté par ce refactor.

## Décision d'architecture

**Pattern retenu : Ports & Adapters (architecture hexagonale), monolithe Hono conservé.**

Les services métier dépendent d'interfaces abstraites (`Database`, `Storage`, `Cache`) au lieu des bindings Cloudflare en dur. Une seule implémentation concrète active à la fois. Aucun découpage en microservices/Workers séparés (rejeté — ajoute latence/coût/complexité sans bénéfice à l'échelle actuelle, et complique la sortie de Cloudflare au lieu de la faciliter). Aucun changement de langage backend (PHP rejeté — jetterait 18 services TypeScript déjà testés et validés en production pour une réécriture complète sans bénéfice net, alors que Hono tourne déjà sur Node.js).

### Vue d'ensemble

```
Frontend (HTML/JS vanilla, inchangé)
        │ REST/JSON (inchangé)
Hono routes/*.ts (Controllers, inchangé)
        │
Services (services/*.ts — logique métier)
        │ dépendent de PORTS, pas de D1/R2 directement
PORTS : Database · Storage · Cache  (src/ports/*.ts)
        │ implémentés par
   ┌────┴────┐
Adaptateurs Cloudflare (ACTIFS)     Adaptateurs VPS (futurs, à la bascule)
D1 / R2 / D1KV                       Postgres / disque local / Redis
```

### Structure de fichiers

```
src/ports/
  database.ts   ← interface Database
  storage.ts     ← interface Storage
  cache.ts        ← interface Cache

src/adapters/cloudflare/
  d1Database.ts   ← implémente Database via c.env.DB (Drizzle ORM, dialecte D1/SQLite)
  r2Storage.ts     ← implémente Storage via c.env.PHOTOS
  d1kvCache.ts      ← implémente Cache via lib/d1kv.ts existant (inchangé)
```

Injection dans `index.tsx` : les adaptateurs sont construits une fois à partir de `c.env` et injectés dans le contexte Hono, plutôt que chaque service allant chercher `c.env.DB` lui-même.

**Exemple de migration (`ticketService.ts`)** :
- Avant : `db.prepare('INSERT INTO tickets (...) VALUES (...)').bind(...).run()`
- Après : `db.insert('tickets', { ... })` via l'interface `Database`

Changement mécanique et localisé par service — signature `D1Database` → `Database`, logique métier inchangée.

## Choix techniques validés

| Décision | Choix retenu | Alternative écartée / raison |
|---|---|---|
| ORM / couche Database | **Drizzle ORM** | Adaptateurs 100% manuels écartés — Drizzle supporte D1 et Postgres nativement avec un seul schéma TS, génère les migrations pour les deux dialectes, réduit fortement le travail de traduction à la bascule |
| Base de données cible VPS | **PostgreSQL** | MariaDB écarté — le CDC_Manus utilise du JSONB natif à plusieurs endroits (`permissions`, `device_types`, `address`, `stats`), Postgres a un support JSONB indexable natif, MariaDB stocke en TEXT avec fonctions, moins performant |
| Clés primaires | **Garder INTEGER/SERIAL AUTOINCREMENT** | UUID (suggéré par CDC_Manus §4.2) écarté — toucherait toutes les FK des 33 migrations existantes pour un gain non nécessaire ; le CDC n'est pas un mandat technique strict |
| Storage cible VPS | **Disque local direct** (`fs` Node.js) | MinIO écarté — a retiré la console web et des fonctionnalités de son édition open-source (AGPL) en 2025, dégradation de l'expérience self-hosting. Garage (alternative FOSS S3-compatible) documenté comme option de repli si besoin futur de répartition multi-serveurs. Disque local retenu pour l'échelle actuelle (1 VPS, faible volume) |
| Cache/KV cible VPS | **Redis** | Remplace `D1KV` (bricolage maison créé à cause d'une limitation Genspark) — usage actuel : OTP (TTL 10min), refresh tokens (TTL 7j), sessions PIN (TTL 15min) |
| Séquencement | **Interface dès maintenant, D1 comme seule implémentation active** | Retrofit complet juste avant le VPS écarté — éviterait un gros refactor risqué en une fois ; à la place, chaque nouvelle fonctionnalité développée à partir de maintenant utilise directement les ports, testable en continu sur `repairdesk.fr` |

## Ce qui ne change PAS

- Le CDC fonctionnel (§5.1-§5.18 de `CDC_Manus.md`) : tous les endpoints, workflows, règles métier (NF525, CUMP, RGPD...) restent identiques au comportement près
- Le contrat API REST/JSON exposé au frontend
- `routes/*.ts` (Controllers)
- Le déploiement Cloudflare actuel (`wrangler pages deploy`, `repairdesk.fr`) — reste actif pendant tout le développement des fonctionnalités CDC restantes
- Le frontend HTML/JS vanilla

## Stratégie de tests

- Tests unitaires existants (Vitest, `*.test.ts`) : doivent rester verts à chaque service migré vers les ports — filet de sécurité principal
- Tests d'adaptateur : chaque implémentation (D1Database, futur PostgresDatabase) testée contre le même contrat d'interface `Database`
- Pas de nouveaux tests end-to-end requis pour ce refactor — le comportement API ne change pas ; validation manuelle habituelle (Claude in Chrome sur `repairdesk.fr`) suffit à confirmer l'absence de régression

## Plan de rollout

Migration **service par service**, jamais en bloc, chaque étape déployée et validée séparément sur `repairdesk.fr` avant de passer au suivant.

1. Introduire `src/ports/*.ts` + `src/adapters/cloudflare/*.ts` (squelette, D1 comme unique implémentation)
2. Premier cas d'usage concret : le chantier `populateTechniciens()` déjà en attente (`todo.md`), écrit directement avec les ports dès le départ — pas de retrofit
3. Migrer 2-3 services simples/isolés pour éprouver le pattern (candidat : `personnelService.ts`)
4. Étendre progressivement aux services restants, `ticketService.ts` (le plus gros/critique) en dernier une fois le pattern éprouvé
5. Toute nouvelle fonctionnalité CDC développée à partir de maintenant utilise directement les ports

**Hors scope de ce spec** (à traiter dans un plan dédié, au moment de la bascule VPS uniquement) :
- Écriture de l'adaptateur Postgres (Drizzle, dialecte Postgres)
- Écriture de l'adaptateur disque local (Storage) et Redis (Cache)
- Migration des données réelles (export D1 → transformation types → import Postgres → validation checksums)
- Déploiement Node.js sur le VPS (remplace `wrangler pages deploy`)

**Contrainte technique notée** : Cloudflare Workers ne supporte pas les connexions TCP brutes (pas de `pg`/`mysql2` direct sans Hyperdrive, produit payant) — l'adaptateur Postgres ne pourra donc être testé qu'en local/VPS, jamais en live sur `repairdesk.fr`/Workers. Attendu, pas un problème.

## Gestion des erreurs

Aucun changement de contrat : exceptions JS standard, catchées au niveau route comme aujourd'hui (`try/catch` par route, statuts HTTP ad hoc). Amélioration optionnelle notée mais non obligatoire pour ce refactor : centraliser via `app.onError()` dans `index.tsx` (absent aujourd'hui).

## Risques identifiés

- **Drift progressif** si le rollout service par service s'étale dans le temps : certains services sur D1 direct, d'autres déjà migrés vers les ports — acceptable tant que chaque service migré est entièrement cohérent en interne (pas de mélange direct/port dans un même fichier)
- **Disparité de comportement SQLite vs Postgres** non détectable avant la bascule réelle (ex : contraintes de types plus strictes en Postgres) — atténué par le choix Drizzle (même schéma déclaratif pour les deux dialectes) et par les tests d'adaptateur prévus en Section Tests

## Addendum — 2026-07-12 (revue finale de branche, chantier `userService.listUsers()`)

**Précision importante sur la portée réelle de la portabilité offerte par le port `Database`** : l'implémentation retenue (`all/get/run` en SQL brut, voir "Choix techniques validés") garantit une portabilité de **driver** (D1 → Postgres), pas de **dialecte SQL**. Le SQL déjà écrit dans les services (hors `userService.listUsers()`, seul migré à ce stade) contient des constructions SQLite-only qui ne fonctionneront pas telles quelles sous Postgres : `julianday()`, `datetime('now', '-N days')`, concaténation `||`, `INSERT ... RETURNING id` (syntaxe différente sous Postgres), booléens stockés en `0`/`1`. Ce n'est pas un défaut du code livré — c'est une conséquence assumée du choix "SQL brut plutôt que query-builder Drizzle" documenté plus haut, qui reste justifié pour ce chantier (mécanique, vérifiable, pas de réécriture forcée des sous-requêtes corrélées existantes).

**Comment appliquer** : au moment de la bascule VPS/Postgres, chaque service migré vers le port `Database` nécessitera une revue ligne à ligne de son SQL pour traduire les constructions SQLite-only — pas seulement un changement d'adaptateur de connexion. À anticiper dans le plan de bascule (déjà noté comme hors scope des tâches actuelles).
