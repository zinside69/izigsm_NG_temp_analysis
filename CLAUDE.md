# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet

iziGSM — plateforme SaaS multi-tenant pour centres de réparation électronique
(gestion tickets SAV, clients, stock, facturation NF525, agenda/RDV, caisse POS,
vitrine publique). Repo de production : sert `https://repairdesk.fr`.

## Stack

- Backend : Hono (TypeScript) sur Cloudflare Workers/Pages Functions
- Base de données : Cloudflare D1 (SQLite edge) — 37 migrations dans `migrations/`
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

## Invariants isolation multi-tenant — routes par ID (depuis 2026-07-31)

Chantier `feat/isolation-routes-par-id` (36 routes gardées, voir `project-docs/bugs.md` et
`project-docs/audit-isolation-2026-07-31.md`). Règles issues de ce chantier, à respecter pour
toute route future :

- Toute route par ID doit vérifier l'appartenance de la ressource via
  `assertBoutiqueOwnership(user, resource, label)` (`src/lib/middleware.ts`).
- `tests/routes-isolation-conformite.test.ts` fait échouer la suite si une route par ID n'a ni
  garde ni exemption — c'est un garde-fou statique, analysé handler par handler (pas fichier par
  fichier, voir plus bas pourquoi ça compte). Une exemption exige un motif explicite dans
  `EXEMPTIONS` (`admin-only`, `referentiel-global`, `public`) — jamais un contournement silencieux.
- Le SQL de ces gardes vit dans les services (`getTicketBoutiqueId`, `getBonCommandeBoutiqueId`,
  `getCategorieBoutiqueId`, `getRdvBoutiqueId`), jamais dans un controller — cohérent avec la
  règle « 0 SQL inline » ci-dessus (§ Architecture).
- La clé primaire de `boutiques` reste `id` (convention PK = `id`, FK = `<table>_id`, appliquée à
  46 des 55 tables), mais **toute requête qui l'expose doit l'aliaser** : `SELECT b.id AS
  boutique_id` — décision du 2026-07-31.

Pourquoi « handler par handler » et pas « fichier par fichier » : l'audit statique initial de ce
chantier (`project-docs/audit-isolation-2026-07-31.md`) écartait une route dès que son *fichier*
contenait un signal d'isolation quelque part, sans vérifier que ce signal était dans *ce handler*
— faux négatif qui a laissé 23 routes invisibles jusqu'à l'écriture du garde-fou actuel. Ne jamais
réintroduire ce raccourci dans un futur audit ou script.

## Mémoire projet (context-guardian)

Lire avant toute modification non triviale :
- `project-docs/current-state.md` — état courant, derniers checkpoints (le plus récent en haut)
- `project-docs/todo.md` — backlog priorisé (🔴 = urgent)
- `project-docs/bugs.md` — bugs connus, corrigés ou non, avec root cause
- `project-docs/decisions.md` — décisions produit/techniques actées
- `docs/CDC_izigsm.docx` / `docs/GAP_ANALYSIS_ENRICHI.md` — cahier des charges, source de vérité produit

Convention : ces fichiers s'accumulent (nouvelle entrée en haut/en dessous selon le
fichier), jamais d'écrasement de l'historique.

## Agent skills

Config lue par les skills du plugin `mattpocock-skills` :
- `docs/agents/issue-tracker.md` — où vivent les tickets (markdown local `.scratch/`)
- `docs/agents/domain.md` — où vit le domaine (`CONTEXT.md` + `docs/adr/`)
- `docs/agents/triage-labels.md` — vocabulaire de statuts des tickets

Glossaire du domaine : `CONTEXT.md` (racine). Décisions dures à inverser : `docs/adr/`.

## Workflow de développement

Chantier feature non trivial → chaîne `mattpocock-skills`, prioritaire :
`/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement` (un ticket = un contexte
neuf). Tickets sous `.scratch/<feature>/issues/`. `/implement` pilote `tdd` puis
`code-review` avant commit.

Les étapes grilling → spec → tickets tiennent dans **une seule fenêtre de contexte** :
pas de `/compact` ni `/clear` avant `/to-tickets`. Si la fenêtre sature avant la fin,
`/handoff` vers une session neuve — ne pas continuer sur un contexte dégradé.

Bug coriace, flake ou régression → `/diagnosing-bugs` (exige une boucle de feedback
déjà rouge sur ce bug avant toute théorie), pas `superpowers:systematic-debugging`.

`superpowers` en appoint uniquement, pour ce que mattpocock ne couvre pas :
`subagent-driven-development`, `using-git-worktrees`, `finishing-a-development-branch`.
Les plans et specs existants sous `docs/superpowers/` restent valides — ne pas migrer.

`context-guardian` inchangé : checkpoints et recovery multi-sessions (voir § Mémoire
projet).

Règles de vérification — s'appliquent quel que soit le toolkit :
- Chaque tâche backend se termine par `npx vitest run` vert avant la suivante
- Chaque tâche frontend se valide en local live (`wrangler pages dev` + vraies données),
  pas juste par relecture de code
- `CACHE_VERSION` dans `public/sw.js` : à incrémenter sur la dernière tâche frontend
  d'un chantier qui touche `public/static/js/*` ou `public/*.html`

## DNS `repairdesk.fr` — records à ne jamais toucher (depuis 2026-07-09)

Mail Gandi actif sur ce domaine, indépendant de l'hébergement Cloudflare de l'app :
MX (`spool.mail.gandi.net`/`fb.mail.gandi.net`), SPF (`TXT`, `include:_mailcust.gandi.net`),
CNAME `webmail.repairdesk.fr`. Seul le record A/CNAME racine (pointant vers Cloudflare
Pages) doit être manipulé. Toute mutation DNS sur ce domaine nécessite confirmation
explicite utilisateur avant exécution (pas seulement pour ces records — pour tout
enregistrement).

## Rebranding produit « Mon Atelier » → « MyDesk » — EN COURS depuis 2026-07-23 (`decisions.md`)

Le nom d'affichage par défaut (fallback boutique sans nom configuré) est en cours de remplacement. Déjà fait : `register.js`, `app.js`, `login.html`, `register.html`. **Reste "Mon Atelier"** dans `auth.ts` (JSDoc) et les pages internes non auditées (`dashboard.html`/`settings.html`/etc.) — toute nouvelle référence à ce nom par défaut doit utiliser "MyDesk", pas "Mon Atelier".

## Fonctionnalités entièrement hors service (trouvé 2026-07-30, `audit-persistance-2026-07-30.md`) — les 2 sont CORRIGÉES

- **`personnel.html`** — corrigé le 2026-07-30 (`385c171`) : `app.js` n'était chargé sur aucun script de cette page + pattern `r.success`/`r.data`.
- **`factures.html` — création manuelle de facture** — corrigé le 2026-07-30 (checkpoint 64) : `POST /api/factures` n'existait pas, le modal postait dans le vide depuis sa création.

Voir `project-docs/todo.md` § "🔴 P1 — Audit persistance des champs" pour ce qui reste (8 cas de perte silencieuse de données + 4 fichiers avec le pattern `r.success`/`r.data` cassé).

## Factures — invariants (depuis 2026-07-30, checkpoint 64)

- **Une facture émise est figée, y compris son identité.** `emettreFacture()` écrit `vendeur_snapshot` et `acheteur_snapshot` (JSON) : le document réimprimé doit refléter ce qui était vrai à l'émission, jamais les fiches client/boutique du jour. C'est le point de passage **unique** des trois chemins de création (manuelle, conversion de devis, acompte) — n'ajoute jamais de figeage ailleurs, et ne réécris jamais ces colonnes. Une facture en brouillon n'a volontairement pas de snapshot et lit les fiches vivantes.
- **Toute validation précède `nextNumero()`.** Un numéro de séquence de boutique est consommé définitivement : le brûler sur une saisie invalide est irréparable.
- **`ajouterPaiement()` refuse une facture `locked = 1`** (`factureService.ts`). Conséquence actuelle : une facture ne peut être encaissée que tant qu'elle est brouillon, d'où l'ordre paiement→émission de l'acompte et de « Émettre & encaisser ». Décision prise de lever cette garde (`todo.md`), **pas encore implémentée** — ne pas supposer qu'un paiement différé fonctionne.
- **Statuts réels** : `brouillon` | `en_attente` | `partiellement_payee` | `payee` | `annulee`. La valeur `'emise'` n'est écrite par aucun `INSERT` du dépôt — elle survit dans le `DEFAULT` du schéma et dans `statsService.ts`, où elle fausse silencieusement les KPI. `en_attente` s'affiche « Émise » et non « Envoyée » : aucun envoi d'email de facture n'existe.
- **Le régime de franchise TVA se déduit de `boutique_settings.tva_taux_defaut === 0`**, et le texte de la mention vient de `boutique_settings.mention_facture` — pas de colonne dédiée, le paramétrage est déjà multi-tenant.
- **Aucune numérotation côté client.** Le fallback localStorage qui fabriquait des `FAC-2026-…` dans le navigateur a été supprimé ; ne jamais le réintroduire sous une autre forme.

## Docs obsolètes — ne pas suivre comme référence technique

- `docs/ARCHITECTURAL_PRINCIPLES.md` (depuis 2026-07-12) : mandate PHP (BFF) +
  microservices Node.js + communication API stricte entre modules. **Ne reflète pas le
  code réel** (monolithe Hono/TypeScript, 0% PHP, services qui lisent D1 directement)
  et n'a jamais été suivi. Jugé aspirationnel/obsolète par l'utilisateur (décision
  explicite, `decisions.md` 2026-07-12) — l'architecture réelle et à respecter est
  Ports & Adapters, voir § Architecture ci-dessus.
- `docs/ARCHITECTURE_MODULES.md` §2 (tableau des migrations) : obsolète, voir `bugs.md`.

## Port `Database` — portabilité driver uniquement, pas dialecte SQL

Le port `Database` (SQL brut, `all/get/run`) abstrait le driver de connexion (D1 →
Postgres à terme) mais **pas le dialecte SQL**. Le SQL existant contient des
constructions SQLite-only (`julianday()`, `datetime('now', '-N days')`, `||`,
`INSERT ... RETURNING`, booléens 0/1) qui devront être traduites service par service
au moment d'une bascule VPS/Postgres — pas juste un changement d'adaptateur de
connexion. Précision ajoutée en revue le 2026-07-12, pas un bug actuel.

## Documents imprimables (tickets, factures, devis) — invariants (depuis 2026-07-25)

- **Jamais de référence `/static/js|css/...` codée en dur** dans un template JS
  (`_buildXxxHTML()` etc.) — `scripts/build-hash-assets.mjs` ne réécrit que les pages
  `.html` et `sw.js`, jamais les chaînes à l'intérieur d'un `.js`. Utiliser
  `_resolveStaticHref('static/css/print.css')` (`app.js`, résout via
  `dist/static/manifest.json` au runtime). Incident réel : les fiches imprimées sont
  restées sans aucun style plusieurs jours après le chantier cache-busting (checkpoint
  53) à cause d'une référence en dur, voir `bugs.md`.
- **Garantie 1 page A4 obligatoire** : tout document construit avec `_triggerPrint()`
  (`app.js`, partagé tickets/factures/devis) bénéficie déjà d'un garde-fou automatique
  — mesure de la hauteur réelle avant impression, bascule en classe CSS
  `.print-compact` (`print.css`) si le contenu dépasse ~290mm. Ne jamais contourner ce
  mécanisme ni le dupliquer par document ; l'étendre dans `print.css`/`_triggerPrint()`
  si un nouveau document a des sections spécifiques à compacter.
- Mesurer une hauteur de rendu impression **hors** appel réel de `window.print()`
  (ex. pour du debug) donne un `box-sizing: content-box` par défaut — le reset
  `@media print { * { box-sizing: border-box } }` de `print.css` ne s'applique qu'en
  contexte d'impression réel. Toujours répliquer ce reset explicitement pour une
  mesure fiable, sinon les chiffres sont trompeurs (incident vécu, voir `bugs.md`).

## Loop engineering (automatisation)

`.claude/skills/loop-engineering/SKILL.md` — exécution autonome d'une tâche du backlog
(pick → plan via superpowers → implémentation en worktree isolé → gates vitest/tsc/build/
Playwright/browser-use → auto-commit si sûr, sinon escalade). Gouvernée par
`project-docs/loop-policy.md` (niveau d'autonomie L2, classification du risque,
garde-fous). Lancement : `scripts/loop/run-loop.sh` (Mac/Linux) /
`scripts/loop/run-loop.ps1` (Windows), à programmer via `cron`/`launchd` (Mac) ou le
Planificateur de tâches (Windows) — CLI Claude Code locale normale, pas de Routine
Claude Code Remote (essayé le 2026-07-19, abandonné : ne correspond pas à un usage en
CLI locale, voir `loop-policy.md` pour le détail).

Deux gardes-fous transversaux : quota du plan Claude vérifié en premier
(`scripts/loop/check-quota.mjs`, via `ccusage` — le script de lancement s'arrête avant
même de démarrer Claude si le seuil de 80 % est dépassé, retente au cycle planifié
suivant) et surveillance du context window (protocole context-guardian, checkpoint
`project-docs/current-state.md` + `recovery-prompt.md` à 80 %). Détail complet dans
`loop-policy.md` et `SKILL.md`. Pour une visibilité live pendant un run, installer
[claude-hud](https://github.com/jarrodwatts/claude-hud) sur ce poste (statusline
terminal, purement local, complémentaire au gate quota programmatique).

## Déploiement

**Jamais automatique.** Toujours sur confirmation explicite de l'utilisateur, y compris
pour la loop d'automatisation (voir `loop-policy.md`).

**Obligation d'ordonnancement — migrations avant déploiement.** Si une tâche en cours a
ajouté une migration D1 (`migrations/00NN_*.sql`) sur laquelle du code déployé s'appuie
(nouvelle colonne lue/écrite par une route ou un service), cette migration **doit** être
appliquée à distance **avant** `npm run deploy`, jamais après :

```bash
npx wrangler d1 migrations apply DB --remote
npm run deploy
```

Déployer le Worker avant d'avoir appliqué la migration distante fait échouer en
production toute requête qui touche la colonne manquante (`no such column`), sans
avertissement préalable — constaté avec la migration `0037` (`date_execution`,
`vendeur_snapshot`, `acheteur_snapshot` sur `factures`) : sans elle appliquée à distance,
`POST /factures/:id/emettre`, `POST /api/factures` (actions `emettre`/`emettre_encaisser`,
et création en brouillon), ainsi que la conversion de devis en facture, lèvent tous une
erreur SQL en prod.

**Commande à utiliser : `npm run deploy`** (= `npm run build && wrangler pages deploy`,
script défini dans `package.json`). Constaté le 2026-07-24 : l'appel direct `npx
wrangler pages deploy dist --project-name izigsm` est bloqué par une règle de
permission (`deny`) dont la source exacte n'a pas été localisée dans les fichiers
`settings.json` accessibles (probablement une politique gérée à un niveau non
inspectable). Vérifié en prod après déploiement via cette commande : `GET
/api/health` 200, `sw.js` `CACHE_VERSION` à jour, contenu réellement changé.

**Constaté le 2026-07-30** : en session avec mode auto, même `npm run deploy` peut être
bloqué par le classificateur automatique (action jugée à risque), y compris après
confirmation explicite de l'utilisateur en chat — dans ce cas, demander à l'utilisateur
de lancer la commande lui-même plutôt que de chercher un contournement.

**Piège cache CDN après déploiement d'un asset hashé (`bugs.md`, incident 2026-07-30)** :
un edge Cloudflare peut caché une mauvaise réponse (200+HTML du catch-all SPA au lieu
du JS) pendant la fenêtre de propagation juste après le déploiement — comme les assets
hashés sont `immutable`, cette mauvaise réponse reste figée indéfiniment sur cet edge.
Après un déploiement touchant des assets `public/static/js|css/*`, si un comportement
semble cassé malgré un déploiement "réussi" : comparer une requête avec et sans
paramètre de cache-busting (`?_=timestamp`) et vérifier l'en-tête `cf-cache-status`
avant de conclure à un bug de code. Purge cache API non disponible dans cet environnement
(permission "Cache Purge" manquante sur le token Cloudflare) — le fix qui marche est de
forcer un nouveau hash de fichier (modification triviale du contenu) et redéployer.
