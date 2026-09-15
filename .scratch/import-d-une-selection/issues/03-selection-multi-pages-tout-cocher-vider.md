# 03 — Sélection sur plusieurs pages, « Tout cocher », « Vider »

**What to build:** l'opérateur coche des articles en feuilletant les pages de résultats : sa sélection
est gardée d'une page à l'autre, et en revenant sur une page il retrouve ses cases cochées et les
quantités qu'il avait saisies. Une nouvelle recherche vide la sélection. Une case « Tout cocher »
coche ou décoche les articles de la page affichée, et un bouton « Vider la sélection » repart de zéro.
Dernier ticket d'écran du chantier : la version de cache du service worker est incrémentée. Spec :
`.scratch/import-d-une-selection/spec.md` (stories 2-7, 10, 13-14).

**Blocked by:** 02 — Cocher et importer une sélection sur la page affichée.

**Status:** done (2026-09-15)

- [x] Sélection gardée d'une page de résultats à l'autre ; compteur et durée de la barre sur toute la
      sélection
- [x] Retour sur une page : cases cochées et quantités retenues réaffichées ; quantité retenue =
      dernière valeur vue sur la ligne (mise à jour tant que la ligne est visible)
- [x] Nouvelle recherche → sélection vidée
- [x] « Tout cocher » : coche / décoche les articles de la page affichée seulement ; figé pendant un
      import
- [x] « Vider la sélection » dans la barre
- [x] L'import envoie les articles cochés sur toutes les pages, avec leurs quantités retenues
- [x] Confirmation renforcée au-delà de 200 articles sélectionnés (story 17) — **reportée du ticket
      02** (2026-09-15) : une page compte au plus 100 articles, le seuil n'y était pas atteignable ; la
      confirmation de `#mobilax-zone-import` est aujourd'hui câblée sur la seule génération
      (`btn-generation-lancer`/`-annuler`) — à rendre commune ; E2E > 200 sur plusieurs pages
- [x] `CACHE_VERSION` incrémenté (dernière tâche d'écran du chantier)
- [x] E2E écran (réponses simulées) : coche sur deux pages et retour, quantité retenue après changement
      de page, nouvelle recherche qui vide, « Tout cocher » limité à la page, « Vider », import d'une
      sélection répartie sur deux pages — vus rouges
- [x] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert

Notes de réalisation :
- Sélection tenue par l'écran : `selectionMobilax` (identifiant → nom, quantité retenue, `illisible`),
  réappliquée à chaque rendu ; une nouvelle recherche **et un changement de mode** l'oublient
  (`oublierSelection()`, `numeroRecherche`), Précédente / Suivante la gardent. Une quantité saisie sur
  une ligne non cochée est prise au moment de la coche.
- Texte non numérique retenu : `value` ne peut le réafficher — la ligne revient **en erreur** (bordure
  rouge, `aria-invalid`), jamais comme un champ vide valide (vu en revue).
- Confirmation renforcée **commune** : `importAConfirmer` = l'import qu'ouvre « Lancer l'import »
  (boutons renommés `btn-import-lancer`/`-annuler`) ; `suivreConfirmation(lancer, n)` — chacun ne la
  touche que s'il l'a ouverte. « Vider » la referme par la barre (0 article, sous le seuil) ; une
  quantité invalide au lancement la referme aussi.
- Un seul écrivain de l'état de « Tout cocher » et de la barre : `majAffichageSelection()` (appelé
  aussi par `basculerSaisieImport()`), qui lit `importEnCours`.
- `CACHE_VERSION` `izigsm-v3.05`.
- Vus rouges : les 6 E2E du ticket avant le code (sélection perdue à la navigation, « Tout cocher »
  absent, import « 1 / 1 »), puis les 5 ajoutés en revue — état mixte, « Vider » figé, changement de
  mode, « Vider » qui referme la confirmation (par mutation), bordure au retour (avant le correctif).
  Une mutation neutralisant la fermeture explicite dans `viderSelection()` laissait le test vert : la
  ligne faisait double emploi avec la barre, elle a été retirée.

⚠ Déploiement du chantier **en un bloc** après ce ticket (tickets 01-03), sans migration.
