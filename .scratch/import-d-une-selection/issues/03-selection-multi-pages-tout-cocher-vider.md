# 03 — Sélection sur plusieurs pages, « Tout cocher », « Vider »

**What to build:** l'opérateur coche des articles en feuilletant les pages de résultats : sa sélection
est gardée d'une page à l'autre, et en revenant sur une page il retrouve ses cases cochées et les
quantités qu'il avait saisies. Une nouvelle recherche vide la sélection. Une case « Tout cocher »
coche ou décoche les articles de la page affichée, et un bouton « Vider la sélection » repart de zéro.
Dernier ticket d'écran du chantier : la version de cache du service worker est incrémentée. Spec :
`.scratch/import-d-une-selection/spec.md` (stories 2-7, 10, 13-14).

**Blocked by:** 02 — Cocher et importer une sélection sur la page affichée.

**Status:** ready-for-agent

- [ ] Sélection gardée d'une page de résultats à l'autre ; compteur et durée de la barre sur toute la
      sélection
- [ ] Retour sur une page : cases cochées et quantités retenues réaffichées ; quantité retenue =
      dernière valeur vue sur la ligne (mise à jour tant que la ligne est visible)
- [ ] Nouvelle recherche → sélection vidée
- [ ] « Tout cocher » : coche / décoche les articles de la page affichée seulement ; figé pendant un
      import
- [ ] « Vider la sélection » dans la barre
- [ ] L'import envoie les articles cochés sur toutes les pages, avec leurs quantités retenues
- [ ] Confirmation renforcée au-delà de 200 articles sélectionnés (story 17) — **reportée du ticket
      02** (2026-09-15) : une page compte au plus 100 articles, le seuil n'y était pas atteignable ; la
      confirmation de `#mobilax-zone-import` est aujourd'hui câblée sur la seule génération
      (`btn-generation-lancer`/`-annuler`) — à rendre commune ; E2E > 200 sur plusieurs pages
- [ ] `CACHE_VERSION` incrémenté (dernière tâche d'écran du chantier)
- [ ] E2E écran (réponses simulées) : coche sur deux pages et retour, quantité retenue après changement
      de page, nouvelle recherche qui vide, « Tout cocher » limité à la page, « Vider », import d'une
      sélection répartie sur deux pages — vus rouges
- [ ] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert

⚠ Déploiement du chantier **en un bloc** après ce ticket (tickets 01-03), sans migration.
