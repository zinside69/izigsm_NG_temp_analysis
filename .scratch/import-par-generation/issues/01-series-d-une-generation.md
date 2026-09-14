# 01 — Mode « Par génération » : proposer les séries d'une génération

**What to build:** dans la recherche fournisseur de la page Stock, un mode « Par génération » :
l'opérateur tape un nom de base (« iPhone 17 ») et voit les séries correspondantes du fournisseur
connecté — 17, 17 Air, 17 Pro, 17 Pro Max —, toutes cochées. Aucun import encore : ce ticket
livre la reconnaissance d'une génération. Spec : `.scratch/import-par-generation/spec.md`
(stories 1-7, 30-32).

**Blocked by:** None — can start immediately.

**Status:** done (2026-09-14)

- [x] Séries retenues : nom **égal** au texte saisi ou **commençant par lui suivi d'un espace**,
      insensible à la casse et aux espaces superflus — « iPhone 17 » → 4 séries, « Galaxy S2 » ⊥
      S20–S25, « iPhone 1 » → aucune
- [x] Lecture du catalogue des séries du fournisseur (sans quota) dans le seul service qui lit les
      réponses brutes du fournisseur ; sortie normalisée `{ id, nom }`
- [x] Route de lecture : boutique du jeton de connexion seulement ; admin plateforme → 403 ;
      fournisseur connecté manquant → message nommé ; texte vide → 400 sans appel
- [x] Écran : mode « Par génération », séries cochées, message clair si aucune série
- [x] Tests du service (fournisseur simulé à sa frontière HTTP) et de la route — vus rouges
- [x] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert

**Livré (2026-09-14)** — `seriesDeGeneration()` (`mobilaxService.ts`), `GET /api/mobilax/series?q=`,
bascule « Par article / Par génération » dans la fenêtre Mobilax de `/stock`. Séries triées par nom
(`position` Mobilax non chronologique), une par identifiant — deux séries homonymes restent deux :
les articles communs se dédoublonnent à l'aperçu (ticket 02). Tests : 12 service + 5 route (vus
rouges) ; E2E `mobilax-generation.spec.ts` — 2 contre la vraie préproduction (catalogue seul, sauté
sans clé), 2 à réponses simulées (cases cochées et échappées ; réseau coupé → message, vu rouge :
« Recherche des séries… » restait figé, `api()` ne rattrape pas un rejet de `fetch`).
`CACHE_VERSION` inchangé : il s'incrémente au dernier ticket d'écran du chantier.

Relevés en revue, non traités (jugements, hors ticket) : le littéral `deps` Mobilax et la garde
admin plateforme sont désormais écrits 3 fois dans `routes/mobilax.ts` ; constantes SQL/`json()`/
`kvMemoire()` recopiées dans 5 fichiers de test Mobilax, `cleMobilaxPreprod()` et la création de la
fiche fournisseur dans 3 E2E ; `chercherMobilax()` (mode article) a le même `finally` sans `catch`
que celui corrigé ici.
