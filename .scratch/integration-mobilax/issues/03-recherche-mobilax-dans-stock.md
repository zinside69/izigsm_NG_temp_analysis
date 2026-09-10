# 03 — Recherche Mobilax dans Stock (sans import)

**What to build:** un opérateur cherche une pièce Mobilax par nom ou référence depuis l'onglet
Stock, et voit des résultats réels (nom, prix, stock) — sans encore pouvoir les importer. Ce
ticket construit le service Mobilax lui-même (authentification, appel de recherche,
normalisation de la réponse, gestion du quota), seul point du dépôt qui manipule la forme brute
d'une réponse Mobilax. C'est le morceau le plus lourd de tout le chantier — tout ce qui suit en
dépend directement ou via le module partagé construit au ticket 06.

**Blocked by:** 01 — Identifiants Mobilax chiffrés par boutique

**Status:** ready-for-agent

- [ ] Le service Mobilax s'authentifie avec la clé déchiffrée de la boutique appelante — la
      durée de vie du jeton est lue dynamiquement à chaque réponse d'authentification, jamais
      codée en dur (elle varie selon l'environnement, mesuré)
- [ ] Une recherche par nom ou référence renvoie des résultats réels — nom, prix, stock — dans
      un format normalisé, identique quel que soit ce que Mobilax renvoie en interne
- [ ] Aucun appelant en dehors de ce service ne lit jamais un champ Mobilax brut non normalisé
- [ ] Une recherche sans résultat affiche un message explicite, distinct d'une erreur
- [ ] Mobilax indisponible ou quota atteint produit un message clair à l'opérateur — jamais de
      nouvelle tentative silencieuse à l'aveugle (quota mesuré : 10 authentifications/min,
      30 recherches/min, partagées par toute l'activité de la boutique)
- [ ] Tout libellé ou description Mobilax affiché est échappé (XSS) — donnée tierce comme une
      autre
- [ ] Tests du service : port `Database` simulé, `fetch` global simulé — jamais d'appel réseau
      réel en suite unitaire (précédent direct : `phoneCatalogService.test.ts`)
- [ ] Test Playwright : une recherche fait apparaître des résultats réels à l'écran
- [ ] Test vu rouge avant le correctif
