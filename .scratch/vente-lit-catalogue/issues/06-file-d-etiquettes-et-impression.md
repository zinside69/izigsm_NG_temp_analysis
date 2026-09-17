# 06 — File d'étiquettes et impression

**What to build:** depuis la fiche d'un produit ou d'un service, l'opérateur ajoute des étiquettes à
la **file d'étiquettes** de la boutique (quantité 1 par défaut, libellé court prérempli et
modifiable, prix à afficher ou non). Un collègue imprime ensuite toute la file en une fois depuis le
navigateur, sur le rouleau thermique du comptoir : étiquettes de 35 × 25 mm à deux pistes, donc
imprimées **par paires**. La file se vide à l'impression.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 30 à 35 ; décision « File d'étiquettes ») ;
vocabulaire `CONTEXT.md` (File d'étiquettes).

**Blocked by:** 05 — Codes maison.

**Status:** ready-for-agent

- [ ] Nouvelle table de la file, par boutique : produit **ou** service, quantité, libellé, prix
      affiché ou non, auteur, date — migration testée contre un vrai SQLite
- [ ] Ajouter, modifier, retirer une entrée de la file ; routes par identifiant gardées par
      l'appartenance à la boutique (garde-fou statique d'isolation vert)
- [ ] La file est partagée par toute la boutique et invisible des autres boutiques
- [ ] Impression navigateur par le moteur d'impression existant : page de deux cellules de
      35 × 25 mm, nombre d'étiquettes **arrondi au pair** avec un avertissement
- [ ] Chaque étiquette porte le libellé, le code-barres (rendu JsBarcode, sans référence
      `/static/...` codée en dur dans un gabarit JS) et le prix seulement s'il est coché
- [ ] Un article sans code-barres ne peut pas être mis en file (message)
- [ ] La file est vidée après impression
- [ ] E2E : ajouter trois étiquettes, voir l'arrondi à quatre, déclencher l'impression, relire la
      file vide ; vus rouges d'abord
- [ ] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées
