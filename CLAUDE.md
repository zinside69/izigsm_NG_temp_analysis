# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet

iziGSM — plateforme SaaS multi-tenant pour centres de réparation électronique
(gestion tickets SAV, clients, stock, facturation NF525, agenda/RDV, caisse POS,
vitrine publique). Repo de production : sert `https://repairdesk.fr`.

## Stack

- Backend : Hono (TypeScript) sur Cloudflare Workers/Pages Functions
- Base de données : Cloudflare D1 (SQLite edge) — 36 migrations dans `migrations/`
- Frontend : HTML/CSS/JS vanilla (`public/`) + Tailwind CDN, pas de framework JS
- Build : Vite + `@hono/vite-build/cloudflare-pages`
- Tests unitaires : Vitest (826 tests, 22 suites) — `tests/`, mocks D1 dans `tests/helpers/`
- Tests E2E : Playwright (`tests/e2e/`) — gate de non-régression, voir § Loop engineering
- Stockage fichiers : Cloudflare R2 (photos tickets)

## Commandes

```bash
npm run dev                 # Vite dev server (pas de bindings Cloudflare réels)
npm run build                # build production → dist/
npm test                     # vitest run (unitaire)
npm run test:coverage        # vitest avec couverture
npm run test:e2e             # Playwright — nécessite le serveur local démarré (voir ci-dessous)
npx tsc --noEmit             # vérification de types (des erreurs pré-existantes subsistent
                              # sur d'anciens fichiers de test, ne pas les confondre avec une
                              # régression introduite par un changement en cours)
```

### Lancer le serveur local complet (D1 + build)

```bash
npx wrangler d1 migrations apply DB --local     # applique les migrations en local
npx wrangler d1 execute DB --local --file=seed.sql   # données de démo (optionnel)
npm run build
npx wrangler pages dev dist --local --port 3000
```

**Ne jamais ajouter `--d1=DB` à `wrangler pages dev`** : ce flag crée une base D1
locale distincte de celle utilisée par `wrangler d1 migrations`/`execute` (persistance
indexée différemment) — symptôme classique : `no such table: users` alors que les
migrations viennent d'être appliquées avec succès. `wrangler.jsonc` déclare déjà le
binding `DB`, `wrangler pages dev` le lit automatiquement. Détail complet dans
`docs/INSTALLATION.md`.

Compte de démo (seed.sql) : `admin@izigsm.fr` / `Admin@2026!` (boutique 1, "iziGSM Paris 11").

## Architecture

```
src/routes/*.ts      Controllers Hono — 0 SQL inline, un fichier par domaine métier
src/services/*.ts    Model layer — toute la logique métier + SQL
src/ports/database.ts        Interface Database (abstraction SQL)
src/adapters/cloudflare/     Adaptateur D1Database → Database (migration Ports & Adapters
                              en cours, terminée sur 20/20 services au moins partiellement —
                              voir project-docs/current-state.md pour le détail par service ;
                              tout ce qui dépend de auditLog()/nextNumero()/db.batch() reste
                              volontairement sur D1Database brut)
src/lib/middleware.ts         authMiddleware, requireRole, requirePin
src/lib/timezone.ts           todayParis()/parseUtcTimestamp() — fuseau horaire France (DST)
src/lib/nf525.ts               chaînage SHA-256 factures/avoirs/caisse (conformité NF525)
public/*.html + static/js/    frontend vanilla, un fichier JS par page, apiGet/apiPost partagés
                              (app.js) — piège connu : `r.success`/`r.data` (au lieu de
                              `r.data.success`/`r.data.data`) casse silencieusement une page,
                              classe de bug déjà rencontrée plusieurs fois (voir bugs.md)
```

Isolation multi-tenant : `boutique_id` sur (quasi) toutes les tables, dérivé du JWT
(`getBoutiqueId(user, queryBoutiqueId)`). **Historique de failles réelles sur ce point**
(voir `project-docs/bugs.md`) — toute route qui lit/écrit une ressource par ID doit
vérifier explicitement l'appartenance à la boutique de l'appelant, ne jamais supposer
qu'un filtre en amont suffit.

## Mémoire projet (context-guardian)

Lire avant toute modification non triviale :
- `project-docs/current-state.md` — état courant, derniers checkpoints (le plus récent en haut)
- `project-docs/todo.md` — backlog priorisé (🔴 = urgent)
- `project-docs/bugs.md` — bugs connus, corrigés ou non, avec root cause
- `project-docs/decisions.md` — décisions produit/techniques actées
- `docs/CDC_izigsm.docx` / `docs/GAP_ANALYSIS_ENRICHI.md` — cahier des charges, source de vérité produit

Convention : ces fichiers s'accumulent (nouvelle entrée en haut/en dessous selon le
fichier), jamais d'écrasement de l'historique.

## Workflow de développement (superpowers)

Chantiers non triviaux : `superpowers:brainstorming` (design, hard-gate — pas de code
avant spec approuvée) → `superpowers:writing-plans` (plan dans `docs/superpowers/plans/`)
→ `superpowers:subagent-driven-development` (un sous-agent implémenteur + un sous-agent
reviewer par tâche) ou `superpowers:executing-plans` (exécution inline). Specs dans
`docs/superpowers/specs/`.

Règles déjà établies sur ce repo, à respecter :
- Chaque tâche backend se termine par `npx vitest run` vert avant la suivante
- Chaque tâche frontend se valide en local live (`wrangler pages dev` + vraies données),
  pas juste par relecture de code
- `CACHE_VERSION` dans `public/sw.js` : à incrémenter sur la dernière tâche frontend
  d'un chantier qui touche `public/static/js/*` ou `public/*.html`

## Loop engineering (automatisation)

`.claude/skills/loop-engineering/SKILL.md` — exécution autonome d'une tâche du backlog
(pick → plan via superpowers → implémentation en worktree isolé → gates vitest/tsc/build/
Playwright/browser-use → auto-commit si sûr, sinon escalade). Gouvernée par
`project-docs/loop-policy.md` (niveau d'autonomie L2, classification du risque,
garde-fous). Lancement : Routine planifiée (Claude Code Remote) ou
`scripts/loop/run-loop.sh` (Mac/Linux) / `scripts/loop/run-loop.ps1` (Windows).

Deux gardes-fous transversaux : quota du plan Claude vérifié en premier
(`scripts/loop/check-quota.mjs`, via `ccusage` — pause + désactivation du Routine
au-delà de 80 %, réactivation manuelle uniquement) et surveillance du context window
(protocole context-guardian, checkpoint `project-docs/current-state.md` +
`recovery-prompt.md` à 80 %). Détail complet dans `loop-policy.md` et `SKILL.md`.
Pour une visibilité live pendant un run local (`run-loop.sh`), installer
[claude-hud](https://github.com/jarrodwatts/claude-hud) sur ce poste (statusline
terminal, purement local, complémentaire au gate quota programmatique — ne fonctionne
pas pour le Routine cloud, qui n'a pas de terminal).

## Déploiement

**Jamais automatique.** `npm run build && wrangler pages deploy dist --project-name
izigsm` — toujours sur confirmation explicite de l'utilisateur, y compris pour la loop
d'automatisation (voir `loop-policy.md`).
