---
statut: needs-triage
date: 2026-09-12
bloque-par: aucun
---

# 01 — Connexion bloquée juste après un déploiement (« landingPageFor is not defined »)

**Origine** : vécu en production par l'exploitant le 2026-09-12, quelques minutes après le
déploiement `izigsm-v3.02` ; deuxième occurrence du même symptôme (première : 2026-07-18,
commentaire de `NETWORK_ONLY_PATHS` dans `public/sw.js`). Détail et mesures : `project-docs/bugs.md`
§ « Connexion bloquée juste après un déploiement ».

**Ce qu'il faut obtenir** : qu'aucun utilisateur ne reste bloqué sur la page de connexion après
un déploiement, sans avoir à forcer un rechargement ; et que ses identifiants ne puissent jamais
partir dans l'adresse.

**Pourquoi `needs-triage` et pas `ready-for-agent`** : la cause n'est **pas établie**. Les deux
hypothèses naturelles sont écartées par mesure (vieille page `/login` en cache ; asset d'un
déploiement précédent en 404). Corriger `sw.js` à l'aveugle déplacerait le problème sans le
prouver. Règle du projet : un défaut coriace passe par `/mattpocock-skills:diagnosing-bugs`, qui
exige une boucle de retour **rouge** sur ce défaut avant toute théorie.

## Étapes

- [ ] **Reproduire** l'incident en local (`wrangler pages dev`) : un navigateur contrôlé par un
      service worker d'une version N, puis un déploiement N+1, puis la connexion — sans
      `serviceWorkers: 'block'` (qui neutraliserait précisément le chemin en cause, `CLAUDE.md`
      § Mode opératoire de vérification). Observer quel `app.js` est servi, et par quel cache.
- [ ] **Établir la cause** — piste restante : un très ancien `app.js` servi par un cache du
      navigateur (App Shell du service worker, stratégie Cache First des assets locaux,
      `sw.js` § 3 et `cacheFirst()`). Consigner la cause prouvée dans `bugs.md`.
- [ ] **Corriger à la cause**, puis revoir la stratégie de cache des pages et des scripts si la
      cause la met en jeu (piste envisagée le 2026-09-12 : pages réseau d'abord, cache seulement
      hors ligne ; assets hashés inchangés, leur nom change à chaque version).
- [ ] **Test vu rouge avant le correctif**, sur le chemin réel du service worker.
- [ ] `CACHE_VERSION` incrémenté si `sw.js` ou une page change ; déploiement sur accord.

## Hors de ce ticket

Le formulaire de connexion sans `method="post"` (`public/login.html`) — défaut certain,
indépendant de la cause, proposé en correctif court et séparé (en attente de l'accord de
l'exploitant).

**Mise à jour du 2026-09-12** : fait, sur accord. La fuite des identifiants dans l'URL avait sa
propre cause, **prouvée** : une course au chargement (envoi natif avant que le script de la page
ne soit attaché, derrière le téléchargement bloquant d'app.js) — `bugs.md`. Corrigée
(`onsubmit="return false"` + `method="post"`), test `connexion-formulaire-post.spec.ts` vu rouge.
**Ce ticket garde son objet** : l'origine de « landingPageFor is not defined », toujours non établie.
