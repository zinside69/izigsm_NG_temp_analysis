# 18 — Pièce déjà en stock à l'import : ajout de quantité en un clic, description complétée

**What to build:** quand une pièce importée du fournisseur est **déjà en stock** — même pièce
fournisseur, même code-barres ou même SKU — le message qui nomme le produit propose un bouton
**« Ajouter N au stock »** si une quantité était saisie sur la ligne : un clic ajoute la quantité par
une **entrée de stock tracée**, rien ne se fait sans ce clic. La **description** du produit existant
est reprise du fournisseur **seulement si elle est vide** — les notes saisies à la main ne sont
jamais écrasées. Enfin, un produit reconnu par son seul code-barres ou SKU est **rattaché à la fiche
fournisseur**, pour que les imports suivants le reconnaissent sans rappeler le fournisseur.
Décisions de l'exploitant du 2026-09-17 (revue du ticket 01).

**Blocked by:** 01 — Doublon de code-barres ou de SKU signalé clairement.

**Status:** done (2026-09-25)

- [x] **La règle du 2026-09-12 reste vraie** : une pièce déjà en stock n'ajoute **jamais** sa
      quantité automatiquement — ni à l'import unitaire, ni dans un import en lot (où la « Qté en
      rayon » est préremplie : relancer un import ne doit rien gonfler)
- [x] Import unitaire d'une pièce déjà en stock avec une quantité saisie > 0 : le message propose
      « Ajouter N au stock » ; le clic écrit **un** mouvement d'entrée (« Import fournisseur — déjà
      en stock ») et affiche l'ancien et le nouveau stock ; un second clic n'ajoute rien de plus
- [x] Sans quantité saisie, aucun bouton
- [x] Description du produit existant vide → reprise du fournisseur (texte brut, même nettoyage qu'à
      l'import) ; description non vide → inchangée
- [x] Produit trouvé par code-barres ou SKU sans lien fournisseur → rattaché à la fiche et à la
      référence du fournisseur, **sauf** si cette référence est déjà portée par un autre produit
      (contrainte `0046`) ; l'import suivant répond « déjà en stock » **sans** appel au fournisseur
- [x] Import en lot : une pièce déjà en stock reste comptée « déjà en stock », jamais en échec, sans
      bouton ni ajout
- [x] Route d'ajout gardée par l'appartenance à la boutique, réservée manager et admin de boutique
      (comme l'import) ; garde-fou statique d'isolation vert
- [x] E2E sur la vraie base locale : ajout en un clic et relecture du stock et du mouvement ;
      description vide reprise, non vide conservée ; rattachement puis second import sans appel ;
      import en lot sans ajout — vus rouges d'abord
- [x] `CLAUDE.md` § Service Mobilax mis à jour (bouton d'ajout, description, rattachement)
- [x] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées

**Amendement (2026-09-24, décision de l'exploitant, `decisions.md`)** : « sans appel au
fournisseur » = **zéro appel Mobilax** — ni `/products/:id/full`, ni aucun autre. La référence
Mobilax n'étant que sur la fiche complète, la reconnaissance doit passer par une donnée locale
(`mobilax_id` rattaché, ce qui demande une migration — décision humaine) ou envoyée par l'écran :
**mécanisme à trancher avant de reprendre ce ticket**. Un premier essai par le socle d'orchestration
(bac à sable `~/bac-a-sable/izigsm-t18`, branche `agent/T-001`) a gardé l'appel et redéfini
l'exigence dans `CLAUDE.md` : non reporté ; le reste de son travail (bouton d'ajout tracé,
description reprise si vide, rattachement, route gardée) est réutilisable après relecture.

**Amendement 2 (2026-09-24, décision de l'exploitant, `decisions.md`)** — mécanisme tranché :
**`mobilax_id` stocké sur `produits`** (colonne nullable + index unique partiel par boutique, produits
actifs, `mobilax_id` non nul). Un import reconnaît d'abord la pièce par `mobilax_id` **avant tout
appel Mobilax** ; le rattachement (produit trouvé par code-barres ou SKU) pose aussi `mobilax_id`.
La migration est un fichier critique pour un agent (ADR 0002 du socle) : elle se **soumet en
demande d'écriture** (diff exact), approuvée puis appliquée par le harnais — de même que la mise à
jour de `CLAUDE.md` § Service Mobilax. En production, la migration part **avant** le code, comme
toujours (`CLAUDE.md` § Déploiement).

**Amendement 3 (2026-09-25, relecture du checkpoint 127, `decisions.md`)** — « un second clic
n'ajoute rien de plus » est désormais tenu **par le serveur** : clé d'ajout par offre, réservée dans
`ajouts_stock_import` (migration `0051`) avant le mouvement, jamais libérée sur échec.
`rattacherProduitMobilax()` ne rattrape que la violation de `produits.mobilax_id`. `0050` et `0051`
testées contre un vrai SQLite. Fusionné dans `main` le 2026-09-25 (`854e673`, `dc6853a`) ; vitest
1222/1224, tsc 32, E2E complets 322/322 sur la vraie base locale.
