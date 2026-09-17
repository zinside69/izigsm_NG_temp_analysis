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

**Status:** ready-for-agent

- [ ] **La règle du 2026-09-12 reste vraie** : une pièce déjà en stock n'ajoute **jamais** sa
      quantité automatiquement — ni à l'import unitaire, ni dans un import en lot (où la « Qté en
      rayon » est préremplie : relancer un import ne doit rien gonfler)
- [ ] Import unitaire d'une pièce déjà en stock avec une quantité saisie > 0 : le message propose
      « Ajouter N au stock » ; le clic écrit **un** mouvement d'entrée (« Import fournisseur — déjà
      en stock ») et affiche l'ancien et le nouveau stock ; un second clic n'ajoute rien de plus
- [ ] Sans quantité saisie, aucun bouton
- [ ] Description du produit existant vide → reprise du fournisseur (texte brut, même nettoyage qu'à
      l'import) ; description non vide → inchangée
- [ ] Produit trouvé par code-barres ou SKU sans lien fournisseur → rattaché à la fiche et à la
      référence du fournisseur, **sauf** si cette référence est déjà portée par un autre produit
      (contrainte `0046`) ; l'import suivant répond « déjà en stock » **sans** appel au fournisseur
- [ ] Import en lot : une pièce déjà en stock reste comptée « déjà en stock », jamais en échec, sans
      bouton ni ajout
- [ ] Route d'ajout gardée par l'appartenance à la boutique, réservée manager et admin de boutique
      (comme l'import) ; garde-fou statique d'isolation vert
- [ ] E2E sur la vraie base locale : ajout en un clic et relecture du stock et du mouvement ;
      description vide reprise, non vide conservée ; rattachement puis second import sans appel ;
      import en lot sans ajout — vus rouges d'abord
- [ ] `CLAUDE.md` § Service Mobilax mis à jour (bouton d'ajout, description, rattachement)
- [ ] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées
