# 04 — Douchette en caisse

**What to build:** le vendeur scanne un article avec la douchette sans avoir à cliquer dans un champ :
un code-barres connu ajoute aussitôt sa ligne, un second scan du même article augmente la quantité,
et l'étiquette d'un lot fournisseur (« ×10 ») ajoute une seule unité. Un code inconnu est signalé,
avec la proposition de créer la fiche produit, code déjà rempli ; un code qui désignerait malgré tout
plusieurs produits fait apparaître la liste. Un scan pendant la saisie d'un champ n'est jamais
détourné vers la vente.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 8 à 15 ; décision « Recherche et scan »).

**Blocked by:** 02 — Sélecteur de produits en caisse.

**Status:** ready-for-agent

- [ ] Fonction pure de routage d'un scan : 13 chiffres → code-barres, 15 chiffres → IMEI, autre
      saisie → texte ; tests unitaires vus rouges
- [ ] Capture globale sur l'écran de caisse (la douchette tape comme un clavier puis Entrée),
      **neutralisée** quand le focus est dans un champ de saisie
- [ ] Code-barres connu → ligne ajoutée immédiatement ; même code rescanné → quantité + 1, pas de
      seconde ligne
- [ ] Un code de lot fournisseur ajoute une unité
- [ ] Code inconnu → message et proposition de créer la fiche produit, code-barres prérempli
- [ ] Code rendant plusieurs produits → liste proposée, aucun choix automatique
- [ ] Un 15 chiffres est routé vers la recherche par IMEI sans erreur, même tant que le ticket 07
      n'a pas branché la suite (message « aucun produit »)
- [ ] E2E : scan simulé par une frappe clavier rapide terminée par Entrée — ajout, double scan,
      code inconnu, scan pendant la saisie d'une désignation ; vus rouges d'abord
- [ ] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées
