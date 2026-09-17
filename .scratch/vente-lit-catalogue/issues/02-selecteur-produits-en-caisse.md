# 02 — Sélecteur de produits en caisse

**What to build:** au comptoir, le vendeur cherche un produit par son nom, son SKU ou son
code-barres dans la caisse ; choisir un résultat ajoute une ligne remplie avec la désignation, le
prix et le taux de TVA du catalogue — ligne qui reste entièrement modifiable. La vente transmet
l'identifiant du produit : **le stock baisse enfin** quand on vend, avec un mouvement tracé. Un
produit dont le stock affiché est insuffisant se vend quand même, stock ramené à 0, avec un
avertissement ; une ligne à 0 € venue du catalogue bloque la validation tant qu'un prix n'est pas
saisi. La saisie libre d'une ligne reste possible.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 2, 4, 5, 6, 16, 17, 18, 19 ; décisions
« Recherche et scan », « Vente en caisse »).

**Blocked by:** None — can start immediately.

**Status:** done (2026-09-17)

- [x] Une route de recherche catalogue, limitée à la boutique consultée et plafonnée en nombre de
      résultats, trouve un produit par nom, SKU **et code-barres** (ce dernier n'est pas couvert
      aujourd'hui) ; refus sans jeton ; résultats typés `produit`
- [x] La caisse propose la recherche ; choisir un produit ajoute une ligne préremplie (désignation,
      prix, TVA) dont chaque champ reste modifiable
- [x] La vente transmet l'identifiant du produit ; le stock baisse d'autant, un mouvement « Vente
      POS » est écrit — prouvé sur la vraie base locale, pas sur une base simulée
- [x] Stock insuffisant : la vente passe, le stock est ramené à 0 (jamais négatif), la réponse
      signale la ligne concernée et l'écran affiche un avertissement
- [x] Ligne à 0 € venue du catalogue : le prix est mis en évidence et la validation est bloquée à
      l'écran tant qu'un prix n'est pas saisi ; le serveur garde sa règle (prix ≥ 0)
- [x] Une ligne saisie entièrement à la main reste possible et se vend comme avant
- [x] Données rendues échappées (un nom de produit est une saisie utilisateur) ; enveloppe de réponse
      déballée au point d'appel
- [x] E2E sur le vrai serveur local : chercher, ajouter, modifier le prix, encaisser, relire le stock ;
      chaque test vu rouge d'abord
- [x] Balayage du menu de gauche vert ; `npx vitest run` vert (hors les 2 échecs permanents) ;
      erreurs tsc inchangées
