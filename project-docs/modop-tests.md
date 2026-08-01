# Mode opératoire — vérifier sérieusement

> Écrit le 2026-08-01 après un échec de méthode : **176 tests verts, production cassée.**
> Ce document existe pour que la même erreur ne se rejoue pas. Il n'ajoute pas de
> cérémonie — il nomme trois pièges vécus et la parade de chacun.

## L'incident fondateur, en une page

Le chantier « résolveur de boutique » a été annoncé vérifié, déployé, puis constaté cassé
à l'écran par l'exploitant : la caisse et le SAV répondaient `boutique_id requis.` à un
admin plateforme, boutique pourtant sélectionnée.

La cause n'était pas dans le code écrit ce jour-là. `apiGet` (`app.js`) concaténait
`'?' + params` **sans regarder si l'URL portait déjà une query** :

```
apiGet('/api/garanties?page=1&limit=15')
  →  /api/garanties?page=1&limit=15?boutique_id=1
                                   ↑ deuxième « ? »
```

`limit` valait alors `"15?boutique_id=1"`, et **aucun** paramètre `boutique_id` n'existait.
Défaut antérieur au chantier, invisible pour un manager (le serveur retrouve sa boutique
dans le jeton), fatal pour l'admin plateforme — sur **toutes les listes paginées du dépôt**.

Trois erreurs de méthode l'ont laissé passer.

---

## Piège 1 — tester le mécanisme qu'on vient d'écrire

**Ce qui a été fait** : le correctif ajoutait `_avecBoutique()`, et le test assertait
« l'URL sortante porte `boutique_id` ». Le mécanisme marchait ; la page ne marchait pas.

**Parade** : formuler l'assertion dans les termes de l'exploitant, jamais dans ceux de
l'implémentation.

| ⊥ | ✔ |
|---|---|
| « l'URL porte `boutique_id` » | « la page affiche les garanties de la boutique » |
| « `_avecBoutique()` rend la bonne chaîne » | « enregistrer une vente répond 200 » |
| « la fonction est appelée » | « aucune exception JS n'est levée » |

Corollaire : un test qui ne peut échouer que si *ma* fonction est cassée ne prouve rien
sur le reste du chemin.

## Piège 2 — choisir un point d'observation commode

**Ce qui a été fait** : pour `caisse` et `sav`, l'assertion visait `/api/caisse/kpis` et
`/api/sav/kpis` — les deux **seuls** appels de ces pages **sans** query préexistante,
donc les deux seuls que le défaut épargnait. Échantillon de taille 1, choisi pour sa
commodité.

**Parade** : ne pas choisir. Balayer, et laisser la page dire ce qui casse.

C'est la raison d'être de `tests/e2e/resolveur-boutique-pages.spec.ts` §
« aucune page du menu de gauche ne casse pour un admin plateforme » : il visite les **20**
entrées de `buildSidebar()` et capte **deux** classes de défaut, parce que les deux se sont
produites le même jour.

```ts
page.on('response', r => { /* HTTP >= 400 sur /api/* */ })
page.on('pageerror', e => { /* exception JS qui tue la page avant tout appel */ })
```

Le second filet est indispensable : `reconditionnement.js` appelait `getCurrentBoutiqueId()`,
fonction définie nulle part. La page mourait **avant** d'émettre le moindre appel — aucun
test réseau, si exhaustif soit-il, ne l'aurait vue.

**Règle** : toute entrée ajoutée à `buildSidebar()` est ajoutée à `MENU_GAUCHE`. Une page
absente de cette liste n'est couverte par rien.

## Piège 3 — oublier ce que la config de test neutralise

`playwright.config.ts` déclare `serviceWorkers: 'block'` — pour de bonnes raisons
(`page.route()` ne voit pas les requêtes d'un service worker, les stubs deviennent des
courses non déterministes). Conséquence assumée : **la suite ne parcourt jamais le chemin
de requête réel de la production**.

**Parade** : le savoir, et ne jamais conclure « vérifié en production » depuis un test
local. Ce que la suite prouve : la logique applicative. Ce qu'elle ne prouve pas : le
comportement du service worker, le cache CDN, l'état réel de la base distante.

---

## La procédure

### Avant d'annoncer « vérifié »

1. `npx tsc --noEmit` → **32 erreurs**, la baseline. Un écart = régression.
2. `npx vitest run` → **891/893**. Les 2 échecs `agendaService` sont antérieurs.
3. `npx playwright test` → **tout vert**, balayage du menu compris.
4. Le test qui couvre le défaut corrigé a été **vu rouge avant** le correctif. Sinon il ne
   prouve rien : écrire le test après, c'est écrire un test qui décrit le code.

### Avant d'annoncer « vérifié en production »

Les tests locaux ne suffisent pas — piège 3. Il faut une observation réelle :

1. Vérifier que le serveur sert bien le nouveau code — l'asset **hashé**, pas
   `/static/js/app.js` qui renvoie le catch-all HTML en 200 et trompe :
   ```js
   const m = JSON.parse(fs.readFileSync('dist/static/manifest.json'))
   await fetch('https://repairdesk.fr/' + m['static/js/app.js'])   // doit contenir le correctif
   ```
   Contrôler `cf-cache-status` au passage (`bugs.md`, incident du 2026-07-30).
2. Faire **le geste métier** dans un vrai navigateur, pas un appel d'API : le chemin
   complet inclut le service worker, le cache et l'interface.
3. Si le geste échoue, **ne pas conclure au cache avant preuve**. Le hash de l'`app.<hash>.js`
   réellement chargé tranche en dix secondes (onglet Réseau, ou `document.scripts`).

### Quand l'exploitant signale un écart

Il a raison jusqu'à preuve du contraire — un test vert n'est pas une preuve, c'est le sujet
de ce document. Ordre de diagnostic, du moins cher au plus cher :

1. **Instrumenter la vraie page**, sans rien supposer :
   ```js
   const traces = []; const of = window.fetch;
   window.fetch = function (...a) { traces.push(typeof a[0] === 'string' ? a[0] : a[0].url); return of.apply(this, a) };
   await maFonctionSuspecte(); window.fetch = of; traces
   ```
2. **Rejouer les appels un par un** et lire le statut de chacun. C'est ce qui a isolé le
   défaut : `kpis` → 200, `garanties?page=…` → 400. La différence entre les deux *était*
   la réponse.
3. Seulement ensuite, formuler une théorie.

> Le filtre de sécurité de Claude in Chrome masque les query strings (`[BLOCKED]`).
> Contournement : ne pas restituer l'URL, en **dériver** ce qu'on cherche — compter les
> `?`, tester une expression régulière, lire un `searchParams.get()`.

---

## Ce que le gate ne voit pas — l'échec silencieux

Découvert le jour même de son écriture, en pilotant le navigateur : le balayage capte les
`>= 400` et les exceptions JS, mais **pas une page qui se charge sans rien afficher**.

`caisse.js` et `fournisseurs.js` lisent `r.success` sur le résultat d'`apiGet()`, alors que
l'enveloppe est `{ ok, status, data, error }` et que le corps de l'API vit sous `r.data`.
`r.success` vaut `undefined`, la fonction sort par un `return` — HTTP 200, aucune exception,
page vide. Le gate est vert, la caisse POS n'affiche rien, et n'a jamais rien affiché.

**Leçon** : « la page n'a pas planté » n'est pas « la page fonctionne ». Un gate de charge
prouve l'absence de deux classes de défaut, pas la présence du service rendu.

Parade retenue pour cette classe (non implémentée, voir `todo.md`) : un garde-fou
**statique**, sur le modèle de `tests/routes-isolation-conformite.test.ts` — faire échouer la
suite dès qu'un fichier de `public/static/js/` lit `.success` directement sur le résultat
d'un `api*()`. Déterministe, contrairement à toute détection de « page vide » au runtime.

## Ce qui reste non couvert, sciemment

- **Le service worker** (piège 3). Un second projet Playwright l'autorisant a été envisagé
  et écarté : risque de flakes documenté dans `playwright.config.ts:26-32`.
- **Les mutations réelles** (vente en caisse, expiration de garanties) : le balayage se
  limite au chargement des pages, il n'exécute aucune écriture — il tourne sur la base
  locale et ne doit pas la remplir. Les écritures sont couvertes par des tests dédiés, un
  témoin par famille.
- **Les 400 légitimes** : le balayage refuse tout `>= 400` sur `/api/*`. Si une page doit
  légitimement en produire un, l'exempter **explicitement** dans le test, avec le motif —
  jamais en assouplissant le seuil.

_Version 1.0 — 2026-08-01 — écrit après l'incident « 176 tests verts, production cassée » (checkpoint 74)_
