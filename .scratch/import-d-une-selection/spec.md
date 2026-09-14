---
chantier: import-d-une-selection
statut: ready-for-agent
date: 2026-09-14
---

# Spec — Import d'une sélection depuis la recherche fournisseur

Cadré le 2026-09-14 par `/grill-with-docs` (18 questions, 3 rounds) — décisions :
`project-docs/decisions.md` § « Import d'une sélection (chantier A) : cadrage » ; vocabulaire :
`CONTEXT.md` (import d'une sélection, import par génération, article fournisseur, produit importé,
stock initial). S'appuie sur le chantier `import-par-generation` (en production depuis le
2026-09-14), dont il réutilise la boucle d'import.

## Problem Statement

Au comptoir, l'opérateur du stock cherche des pièces chez le fournisseur connecté (« samsung S24 »
rend 2 662 articles) et n'en veut qu'une partie : quelques écrans, une batterie, deux films. Il ne
peut aujourd'hui les importer qu'un par un — chaque « Importer » ouvre la fiche du produit et ferme la
recherche, qu'il faut relancer et feuilleter à nouveau pour l'article suivant. L'import par
génération ne l'aide pas : il prend une génération entière, pas un choix d'articles précis, et la
recherche texte ratisse plus large que les séries.

## Solution

Dans les résultats de la recherche fournisseur, une case par article. L'opérateur coche ce qu'il
veut en feuilletant les pages, voit en permanence combien d'articles sont sélectionnés et en combien
de temps ils seront importés, puis lance « Importer la sélection ». iziGSM importe les articles un
par un, au même rythme et avec les mêmes protections que l'import par génération (pause sur quota,
arrêt sur panne, bilan), chaque article avec la quantité en rayon saisie sur sa ligne. L'opérateur
peut interrompre l'import à tout moment ; ce qui n'a pas été importé reste coché, prêt à être
relancé en un clic.

## User Stories

1. En tant qu'opérateur du stock, je veux une case à cocher sur chaque article des résultats de la
   recherche fournisseur, pour choisir plusieurs articles à importer en une fois.
2. En tant qu'opérateur du stock, je veux que ma sélection soit gardée quand je passe à la page de
   résultats suivante, pour cocher des articles sur plusieurs pages.
3. En tant qu'opérateur du stock, je veux retrouver mes cases cochées quand je reviens sur une page
   déjà vue, pour vérifier ce que j'ai choisi.
4. En tant qu'opérateur du stock, je veux que ma sélection soit vidée quand je lance une nouvelle
   recherche, pour ne pas importer par erreur des articles d'une recherche précédente.
5. En tant qu'opérateur du stock, je veux une case « Tout cocher » qui coche les articles de la page
   affichée, pour sélectionner rapidement une page entière.
6. En tant qu'opérateur du stock, je veux que « Tout cocher » ne coche que la page affichée, pour ne
   jamais lancer sans le vouloir l'import de milliers d'articles.
7. En tant qu'opérateur du stock, je veux décocher « Tout cocher » pour décocher la page affichée,
   pour revenir sur un choix de page.
8. En tant qu'opérateur du stock, je veux voir en permanence le nombre d'articles sélectionnés, pour
   savoir ce qui va entrer dans mon stock.
9. En tant qu'opérateur du stock, je veux voir la durée estimée de l'import de ma sélection, pour
   choisir le bon moment.
10. En tant qu'opérateur du stock, je veux un bouton « Vider la sélection », pour repartir de zéro
    sans décocher article par article sur plusieurs pages.
11. En tant qu'opérateur du stock, je veux que chaque article parte avec la « Qté en rayon » de sa
    ligne, pour déclarer en une fois les pièces que j'ai déjà en rayon.
12. En tant qu'opérateur du stock, je veux qu'une « Qté en rayon » laissée vide vaille mon stock
    initial par défaut, pour ne rien saisir dans le cas courant.
13. En tant qu'opérateur du stock, je veux que la quantité saisie sur une ligne cochée soit gardée
    quand je change de page, pour ne jamais perdre une saisie.
14. En tant qu'opérateur du stock, je veux retrouver la quantité saisie en revenant sur la page,
    pour voir ce qui partira vraiment.
15. En tant qu'opérateur du stock, je veux que l'import refuse de partir si une ligne cochée porte
    une quantité invalide, et me montre laquelle, pour corriger avant de perdre du temps.
16. En tant qu'opérateur du stock, je veux lancer « Importer la sélection » et suivre une barre de
    progression et un journal ligne par ligne, pour savoir où en est l'import.
17. En tant qu'opérateur du stock, je veux une confirmation renforcée au-delà de 200 articles
    sélectionnés, pour ne pas lancer par mégarde un import très long.
18. En tant que collègue au comptoir, je veux pouvoir chercher une pièce chez le fournisseur pendant
    un import d'une sélection, pour servir un client sans attendre la fin.
19. En tant qu'opérateur du stock, je veux que l'import d'une sélection se mette en pause tout seul
    quand le quota du fournisseur est atteint, avec un compte à rebours, puis reprenne, pour qu'il
    aille au bout sans moi.
20. En tant qu'opérateur du stock, je veux que l'import s'arrête avec un bilan quand le fournisseur
    ne répond plus, quand le quota est atteint sans délai annoncé ou quand la connexion est perdue,
    pour savoir où il en est resté.
21. En tant qu'opérateur du stock, je veux qu'un article en échec n'arrête pas les suivants, pour
    qu'une erreur isolée ne bloque pas toute ma sélection.
22. En tant qu'opérateur du stock, je veux qu'un article déjà dans mon stock soit compté « déjà en
    stock » et jamais en double, pour ne pas créer de doublon en important deux fois.
23. En tant qu'opérateur du stock, je veux que chaque produit importé soit rempli comme par l'import
    unitaire (nom, référence, EAN en SKU, famille, catégorie, marque, prix d'achat, prix de vente
    selon ma marge, seuil d'alerte par défaut), pour ne rien avoir à corriger ensuite.
24. En tant qu'opérateur du stock, je veux un bilan final (importés, déjà en stock, échecs nommés
    avec leur motif, répartition par famille, lien vers le stock de ce fournisseur), pour savoir ce
    que l'import a produit.
25. En tant qu'opérateur du stock, je veux un bouton « Interrompre » pendant l'import, pour arrêter
    un import que je ne veux plus.
26. En tant qu'opérateur du stock, je veux que « Interrompre » laisse finir l'article en cours, pour
    qu'aucun article ne soit coupé en plein import.
27. En tant qu'opérateur du stock, je veux que « Interrompre » pendant une pause de quota arrête tout
    de suite, pour ne pas attendre la fin d'un compte à rebours inutile.
28. En tant qu'opérateur du stock, je veux un bilan « Import interrompu » distinct d'« Import
    arrêté », pour savoir si c'est moi ou un incident qui a arrêté l'import.
29. En tant qu'opérateur du stock, je veux le même bouton « Interrompre » pendant un import par
    génération, pour arrêter aussi un import de génération trop long.
30. En tant qu'opérateur du stock, je veux qu'après l'import restent cochés les articles en échec et
    ceux qui n'ont pas été importés, pour relancer exactement ce qui manque en un clic.
31. En tant qu'opérateur du stock, je veux que les articles importés ou déjà en stock soient décochés
    après l'import, pour ne pas les relancer inutilement.
32. En tant qu'opérateur du stock, je veux que mes cases soient figées pendant l'import, pour que ce
    qui part reste ce que j'ai confirmé.
33. En tant qu'opérateur du stock, je veux ne pas pouvoir commencer une autre sélection ou une autre
    génération pendant un import, pour qu'un seul import tourne à la fois.
34. En tant qu'opérateur du stock, je veux que les boutons « Importer » des lignes soient désactivés
    pendant un import, pour que la fenêtre ne se ferme pas sous mes yeux et que le rythme reste
    respecté.
35. En tant qu'opérateur du stock, je veux garder le bouton « Importer » de chaque ligne en dehors
    d'un import, pour importer une seule pièce et ajuster aussitôt son prix dans sa fiche.
36. En tant qu'opérateur du stock, je veux être prévenu si je ferme l'onglet pendant un import d'une
    sélection, pour ne pas l'interrompre sans le vouloir.
37. En tant que manager ou admin de boutique, je veux les cases et le bouton « Importer la
    sélection », pour équiper ma boutique.
38. En tant que technicien, je ne dois voir ni les cases ni les boutons d'import, parce que je n'ai
    pas le droit d'importer et qu'un geste proposé ne doit pas échouer à coup sûr.
39. En tant qu'admin plateforme, je ne dois pas pouvoir importer dans une boutique cliente, parce que
    la plateforme ne fait pas de commerce et que la clé fournisseur appartient à la boutique.
40. En tant que boutique, je veux que l'import n'utilise que ma propre clé fournisseur et n'écrive que
    dans mon stock, pour que les stocks restent étanches.

## Implementation Decisions

- **Aucune route d'import nouvelle, aucune migration.** Chaque article passe par l'import unitaire
  existant du fournisseur connecté, qui relit la fiche chez le fournisseur, applique famille,
  catégorie, marque, marge, SKU = EAN, seuil d'alerte par défaut, et rend `deja_importe` sur un
  doublon (anti-doublon de la migration `0046`) — règles inchangées.
- **Quantité envoyée** : la « Qté en rayon » de la ligne, en nombre, seulement si elle a été
  renseignée ; vide → non envoyée, le serveur applique le stock initial par défaut (comme l'import
  unitaire aujourd'hui). Validation avant lancement côté écran : entier ≥ 0 ou vide ; toute ligne
  cochée invalide empêche le lancement et est signalée. Le serveur garde son propre contrôle
  (`quantite_invalide`).
- **Recherche fournisseur** : sa réponse porte en plus la fiche fournisseur de la boutique
  (`fournisseur_id`), pour le lien du bilan — champ ajouté, comme l'aperçu d'une génération. Rien
  d'autre ne change côté serveur ; la liste de recherche ne porte pas la référence, « déjà en stock »
  n'est donc connu qu'à l'import (aucun contrôle préalable, aucun quota en plus).
- **Sélection** tenue par l'écran pour la recherche en cours : identifiant fournisseur de l'article →
  nom et quantité retenue (dernière valeur vue sur sa ligne). Réappliquée à chaque affichage de page
  (cases cochées, quantités) ; vidée à toute nouvelle recherche, et par « Vider la sélection ». « Tout
  cocher » agit sur les lignes de la page affichée.
- **Barre de sélection** au-dessus des résultats : nombre sélectionné, durée estimée (articles ×
  3 s, arrondie à la minute, même règle que l'import par génération), « Importer la sélection »,
  « Vider la sélection ». Masquée tant que rien n'est coché.
- **Une seule boucle d'import pour les deux imports.** La boucle de l'import par génération est
  rendue générique : elle reçoit une liste d'articles à importer (identifiant, nom, quantité
  éventuelle), la fiche fournisseur du bilan et le « déjà en stock » connu d'avance (aperçu d'une
  génération ; zéro pour une sélection). Comportement identique : un import à la fois, départs
  espacés d'au moins 3 s, pause + compte à rebours + reprise du même article sur quota avec délai,
  arrêt sur quota sans délai / fournisseur indisponible / connexion perdue, échec isolé qui n'arrête
  pas les suivants, confirmation renforcée au-delà de 200, avertissement à la fermeture de l'onglet,
  bilan identique (importés, déjà en stock, échecs nommés, répartition par famille, lien vers le
  stock filtré sur le fournisseur).
- **Zone d'import commune** (progression, journal, pause, confirmation, bilan) visible dans les deux
  modes de la fenêtre fournisseur, puisqu'un seul import tourne à la fois.
- **« Interrompre »** : visible pendant tout import (sélection ou génération). Demande l'arrêt ;
  l'article en cours finit, puis la boucle s'arrête ; pendant une pause de quota, l'arrêt est
  immédiat. Bilan « Import interrompu » avec les restants (distinct d'« Import arrêté »).
- **Pendant un import** : recherche et navigation entre les pages libres ; cases et « Tout cocher »
  figés ; « Importer la sélection », boutons « Importer » des lignes et nouvelle génération
  désactivés. **Après** : les articles importés et déjà en stock sont décochés ; restent cochés les
  échecs et les restants (arrêt ou interruption), la barre de sélection relance exactement ce qui
  manque.
- **Rôles** : cases, « Tout cocher », barre de sélection et boutons « Importer » des lignes affichés
  seulement pour un manager ou un admin de boutique (mêmes droits que l'import côté serveur, qui
  garde son refus). L'admin plateforme reste refusé par le serveur dès la recherche.
- **Service worker** : version de cache incrémentée sur la dernière tâche d'écran du chantier.

## Testing Decisions

- **Un bon test observe le comportement par l'extérieur** — ce que voit l'opérateur, ce que reçoit la
  route d'import — jamais une fonction interne ni la forme d'une requête. Chaque test est vu rouge
  avant son correctif.
- **Couture 1 — l'écran, sous Playwright, avec les réponses de l'API d'iziGSM simulées
  (`page.route()`) et l'horloge simulée (`page.clock`)** : coche sur plusieurs pages et retour
  (cases et quantités réaffichées), nouvelle recherche qui vide, « Tout cocher » limité à la page,
  « Vider la sélection », compteur et durée, quantité de ligne envoyée (vide → non envoyée), quantité
  invalide qui bloque le lancement, rythme et progression, bilan (déjà en stock, échec isolé, lien),
  « Interrompre » (article en cours fini, arrêt immédiat en pause), restants restés cochés et relance,
  cases et boutons figés pendant l'import, rôles (technicien sans cases). `serviceWorkers: 'block'`
  est déjà posé (sinon `page.route()` ne voit pas les requêtes).
- **Couture 2 — la route de recherche** (existante) : la réponse porte la fiche fournisseur de la
  boutique du jeton.
- **Non-régression** : les E2E de l'import par génération (la boucle devient commune) et de l'import
  unitaire restent verts ; « Interrompre » y est ajouté pour l'import par génération.
- **Aucun appel réel au fournisseur** : aucun chemin fournisseur nouveau — la recherche et l'import
  unitaire sont déjà couverts contre la vraie préproduction.
- **Prior art** : `mobilax-generation.spec.ts` (réponses et horloge simulées, pause de quota,
  arrêts, relance), `mobilax-recherche-stock.spec.ts` (recherche et import unitaire),
  `mobilax-route.test.ts` (gardes et enveloppe de la recherche), `resolveur-boutique-pages.spec.ts`
  (balayage du menu). Fenêtres `.modal-overlay` : assertions d'opacité, jamais de visibilité.
- **Gates** : vitest complet (baseline), tsc ≤ 32, E2E du chantier + import par génération + balayage
  du menu.

## Out of Scope

- « Tout cocher » sur l'ensemble des résultats d'une recherche (plusieurs pages chargées d'un coup) :
  c'est l'import en masse écarté le 2026-09-12 ; pour une génération entière, l'import par génération
  existe.
- Un contrôle « déjà en stock » avant l'import (un appel de quota par article).
- Une sélection gardée d'une recherche à l'autre ou d'une visite à l'autre.
- Un import qui continue onglet fermé, et toute notification par email.
- La modification en masse des prix ou des quantités des produits importés.
- Tout autre fournisseur que celui connecté aujourd'hui.

## Further Notes

- **Aucune dépendance de déploiement** : tout ce que ce chantier réutilise est en production
  (import par génération, `izigsm-v3.04` ; stock initial par défaut à l'import depuis le
  2026-09-12). Déploiement en un bloc à la fin du chantier, sans migration.
- **Quota** : l'import d'une sélection partage les 30 appels par minute du fournisseur avec la
  recherche du comptoir ; le rythme de 20 imports par minute en laisse 10 aux recherches.
- Le bouton « Interrompre » répond aussi au 🟡 P3 du `todo.md` relevé en revue de l'import par
  génération.
