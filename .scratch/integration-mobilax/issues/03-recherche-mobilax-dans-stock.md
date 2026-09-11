# 03 — Recherche Mobilax dans Stock (sans import)

**What to build:** un opérateur cherche une pièce Mobilax par nom ou référence depuis l'onglet
Stock, et voit des résultats réels (nom, prix, stock) — sans encore pouvoir les importer. Ce
ticket construit le service Mobilax lui-même (authentification, appel de recherche,
normalisation de la réponse, gestion du quota), seul point du dépôt qui manipule la forme brute
d'une réponse Mobilax. C'est le morceau le plus lourd de tout le chantier — tout ce qui suit en
dépend directement ou via le module partagé construit au ticket 06.

**Blocked by:** 01 — Identifiants Mobilax chiffrés par boutique

**Status:** done (2026-09-11)

- [x] Le service Mobilax s'authentifie avec la clé déchiffrée de la boutique appelante — la
      durée de vie du jeton est lue dynamiquement à chaque réponse d'authentification, jamais
      codée en dur (elle varie selon l'environnement, mesuré)
- [x] Une recherche par nom ou référence renvoie des résultats réels — nom, prix, stock — dans
      un format normalisé, identique quel que soit ce que Mobilax renvoie en interne
- [x] Aucun appelant en dehors de ce service ne lit jamais un champ Mobilax brut non normalisé
- [x] Une recherche sans résultat affiche un message explicite, distinct d'une erreur
- [x] Mobilax indisponible ou quota atteint produit un message clair à l'opérateur — jamais de
      nouvelle tentative silencieuse à l'aveugle (quota mesuré : 10 authentifications/min,
      30 recherches/min, partagées par toute l'activité de la boutique)
- [x] Tout libellé ou description Mobilax affiché est échappé (XSS) — donnée tierce comme une
      autre
- [x] Tests du service : port `Database` simulé, `fetch` global simulé — jamais d'appel réseau
      réel en suite unitaire (précédent direct : `phoneCatalogService.test.ts`)
- [x] Test Playwright : une recherche fait apparaître des résultats réels à l'écran
- [x] Test vu rouge avant le correctif

## Notes d'implémentation (2026-09-11)

- **Aucun champ `reference` n'existe chez Mobilax** (mesuré en préproduction : liste et détail
  léger ne portent que `id, ean13, name, short_name, quantity, price, updated_at, main_image`).
  « Chercher par référence » = par **EAN13** (la recherche le trouve) ; le lien stable vers une
  pièce est l'**identifiant Mobilax** (`mobilax_id`) — à retenir pour `reference_fournisseur`
  au ticket 04.
- **Quel fournisseur est Mobilax** : colonne `fournisseurs.api_plateforme` (migration `0045`),
  cochée dans la fiche — décision de l'exploitant, plutôt qu'un nom deviné. Aucune fiche,
  fiche sans clé et plusieurs fiches donnent chacun un message distinct, sans appel à Mobilax.
- **Le module frontend partagé reste au ticket 06** : la fenêtre de recherche vit dans
  `stock.js` (`chercherMobilax()`), à extraire alors sans la réécrire.
