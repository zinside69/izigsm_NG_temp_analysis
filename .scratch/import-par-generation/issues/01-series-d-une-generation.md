# 01 — Mode « Par génération » : proposer les séries d'une génération

**What to build:** dans la recherche fournisseur de la page Stock, un mode « Par génération » :
l'opérateur tape un nom de base (« iPhone 17 ») et voit les séries correspondantes du fournisseur
connecté — 17, 17 Air, 17 Pro, 17 Pro Max —, toutes cochées. Aucun import encore : ce ticket
livre la reconnaissance d'une génération. Spec : `.scratch/import-par-generation/spec.md`
(stories 1-7, 30-32).

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Séries retenues : nom **égal** au texte saisi ou **commençant par lui suivi d'un espace**,
      insensible à la casse et aux espaces superflus — « iPhone 17 » → 4 séries, « Galaxy S2 » ⊥
      S20–S25, « iPhone 1 » → aucune
- [ ] Lecture du catalogue des séries du fournisseur (sans quota) dans le seul service qui lit les
      réponses brutes du fournisseur ; sortie normalisée `{ id, nom }`
- [ ] Route de lecture : boutique du jeton de connexion seulement ; admin plateforme → 403 ;
      fournisseur connecté manquant → message nommé ; texte vide → 400 sans appel
- [ ] Écran : mode « Par génération », séries cochées, message clair si aucune série
- [ ] Tests du service (fournisseur simulé à sa frontière HTTP) et de la route — vus rouges
- [ ] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert
