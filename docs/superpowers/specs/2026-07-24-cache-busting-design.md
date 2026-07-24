# Design — Cache-busting par hash de contenu des assets statiques

_Version 1.0 — 2026-07-24_

## Contexte

Incident du 2026-07-18 (`project-docs/bugs.md` § "Contenu déployé absent chez un
utilisateur malgré CACHE_VERSION à jour") : après un déploiement, un utilisateur a
reçu un contenu JS périmé bien que le Service Worker ait installé la bonne
`CACHE_VERSION`. Cause racine : `public/static/js/*.js` n'a pas de nom de fichier
hashé — pendant la fenêtre de propagation du CDN Cloudflare juste après un
déploiement, `cache.add()` (précache à l'`install` du Service Worker) peut légitimement
récupérer une version encore ancienne sous le même nom de fichier, et la figer dans
le nouveau `CACHE_VERSION`.

Le fix immédiat déployé le jour même (`public/sw.js`, commit `796be8d`,
`cache.add(new Request(url, { cache: 'reload' }))`) réduit le risque côté navigateur
mais ne l'élimine pas structurellement : il ne garantit rien sur ce que le edge CDN
sert au moment exact du fetch.

Ce chantier (`project-docs/todo.md` § "🔴 PRIORITÉ — Cache-busting par hash de
contenu", 6 sous-tâches) a été escaladé à plusieurs reprises par la loop-engineering
automatisée (classé architectural, non isolable en tâche atomique) sans qu'aucune
décision humaine ne soit actée depuis le 18/07 — ce document formalise cette décision.

## Constat technique de départ

`public/static/js/*.js` (20 fichiers) et `public/static/css/*.css` (2 fichiers) ne
sont **pas** dans le graphe de build Vite/Rollup aujourd'hui : `@hono/vite-build/cloudflare-pages`
ne bundle que le worker (`src/index.tsx` → `dist/_worker.js`) ; `public/` est copié
tel quel dans `dist/` par le mécanisme natif de Cloudflare Pages (confirmé :
`public/_routes.json` exclut `/static/*` du routage vers les Pages Functions — ces
fichiers sont servis comme assets statiques purs, jamais vus par le worker).

29 pages `public/*.html` référencent ces fichiers via des chemins en dur
(`<script src="/static/js/tickets.js">`), 83 occurrences au total. `public/sw.js`
maintient une liste statique `APP_SHELL` (9 pages, 2 CSS, 9 des 20 JS, 2 images,
`manifest.json`, `favicon.svg`, 1 URL CDN). Aucun fichier `_headers` Cloudflare Pages
n'existe actuellement — pas de politique de cache HTTP explicite en place.

## Objectif

Hasher le contenu de `public/static/js/*.js` et `public/static/css/*.css` dans leur
nom de fichier (`tickets.a3f8e1.js`) pour qu'une URL hashée ne puisse **jamais** être
servie périmée sous ce nom — élimine la classe de bug à la source, indépendamment du
timing de propagation CDN. **Hors scope** : `public/static/img/*` (11 fichiers,
icônes PWA/favicon) reste non hashé — une image périmée quelques minutes n'est pas un
bug fonctionnel, contrairement à un `.js` qui casse une feature.

## Approche retenue : script post-build isolé

Deux approches considérées :
1. **Intégration native Rollup** (`build.rollupOptions.input` multi-entrées +
   `build.manifest: true`) — plus « dans les clous » Vite, mais demande de
   reconfigurer le build du worker qui fonctionne bien aujourd'hui.
2. **Script post-build isolé** — opère uniquement sur `dist/` après `vite build`,
   sans toucher à la config du worker. **Retenu** : fonction pure et testable
   (`dist/` en entrée → `dist/` hashé en sortie), risque de régression minimal sur le
   build existant, plus simple à comprendre/déboguer/annuler isolément.

```json
// package.json
"build": "vite build && node scripts/build-hash-assets.mjs"
```

## Architecture

Le script (`scripts/build-hash-assets.mjs`) exécute, dans l'ordre, sur `dist/`
uniquement (jamais sur `public/` source — le code source garde des noms logiques
non hashés) :

1. **Hash + renommage** — pour chaque fichier de `dist/static/js/*.js` et
   `dist/static/css/*.css` : hash de contenu (SHA-256, 8 premiers caractères hex),
   renommage en place (`tickets.js` → `tickets.a3f8e1.js`), original supprimé.
2. **Manifest** — écrit `dist/static/manifest.json`, mapping plat
   `{ "static/js/tickets.js": "static/js/tickets.a3f8e1.js", ... }`.
3. **Réécriture HTML** — parcourt les 29 `dist/*.html`, remplace chaque référence
   `/static/js/...` ou `/static/css/...` trouvée dans le manifest par son équivalent
   hashé (83 occurrences).
4. **Régénération `APP_SHELL`** — réécrit le tableau existant dans `dist/sw.js` en
   résolvant chaque entrée déjà présente via le manifest (pas d'ajout/retrait
   d'entrées, uniquement résolution du nom hashé).
5. **`_headers`** — écrit `dist/_headers` (nouveau fichier) :
   - `/static/js/*` et `/static/css/*` → `Cache-Control: public, max-age=31536000, immutable`
   - `/sw.js` → `Cache-Control: no-cache`
   - `/*.html` → `Cache-Control: no-cache`

## Flux de données

```
vite build → dist/ (worker + public/ copié tel quel)
  → script lit dist/static/{js,css}
  → hash + renomme en place
  → écrit dist/static/manifest.json
  → réécrit les 29 dist/*.html
  → réécrit APP_SHELL dans dist/sw.js
  → écrit dist/_headers
→ npm run deploy (inchangé, déploie le dist/ maintenant hashé)
```

Le script repart toujours d'un `dist/` frais généré par `vite build` (jamais de
mutation incrémentale entre deux runs) — idempotent par construction, aucun état
résiduel possible entre deux builds.

## Gestion d'erreurs

Si une balise `<script src>`/`<link href>` référence un fichier `/static/js/` ou
`/static/css/` **absent du manifest** (typo, fichier supprimé, nouvelle page
référençant un chemin inexistant) → le script échoue bruyamment (exit non-zéro), le
build entier échoue. Choix délibéré : un build cassé détecté immédiatement en
local/CI est préférable à un déploiement silencieux en prod avec une référence à un
fichier hashé inexistant — exactement la classe de bug que ce chantier élimine.

## Limite résiduelle assumée (non éliminée, documentée)

Un onglet déjà ouvert avec un ancien Service Worker actif qui ferait un fetch
dynamique (hors précache) vers un ancien hash après un nouveau déploiement
recevrait un **404** plutôt qu'un contenu périmé — différent de l'incident du
18/07 (contenu silencieusement faux) mais pas totalement éliminé pour ce cas précis.
Fenêtre étroite : les fichiers déjà précachés restent servis depuis le cache local
tant que le Service Worker n'est pas mis à jour côté client.

## Tests

- **Nouveau test unitaire Vitest** (`tests/build-hash-assets.test.ts`) sur la
  logique pure du script : hash d'un buffer, réécriture d'une chaîne HTML à partir
  d'un manifest, détection d'une référence orpheline (cas d'erreur). Pas de mock D1
  nécessaire.
- **Validation manuelle locale** : `npm run build` → servir `dist/` (`server.mjs`
  existant ou `wrangler pages dev dist --local`) → vérifier via la console réseau
  que les pages chargent des URLs hashées et que `sw.js` précache les bons noms.
- **Gate Playwright existant** (10 tests auth/health/isolation) doit continuer de
  passer sans modification — le hashing est transparent au comportement
  fonctionnel, les tests naviguent par route, jamais par nom de fichier statique en
  dur.
- **Non couvert par ce chantier** : test automatisé de la fenêtre de propagation
  CDN elle-même (non simulable de façon fiable en local) — la garantie vient de la
  conception (hash de contenu = immutabilité), pas d'une vérification a posteriori.

## Note de vérification (auto-revue)

`public/static/css/*.css` ne référence aucune image locale via `url()` (vérifié :
seul `main.css` contient un `@import url()` vers Google Fonts, externe) — le hashing
des CSS n'entraîne donc aucune réécriture supplémentaire côté images, cohérent avec
la décision de laisser `public/static/img/*` non hashé.

## Hors scope de ce document

- Hashing de `public/static/img/*` (décision explicite : non retenu pour ce
  chantier).
- Purge/nettoyage des anciens fichiers hashés entre déploiements — géré nativement
  par le cycle de déploiement Cloudflare Pages, pas par ce script.
- Bump de `CACHE_VERSION` dans `sw.js` — reste une discipline développeur manuelle
  existante, non affectée par ce chantier.
