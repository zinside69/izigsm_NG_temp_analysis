# 02 — Stock initial valorisé au coût moyen (création manuelle)

**What to build:** quand l'opérateur crée un produit à la main avec des pièces déjà en rayon, ces
pièces entrent par un mouvement « Stock initial » (déjà le cas) **et valent leur prix d'achat**
dans la valeur du stock au coût moyen — au lieu de 0 € jusqu'à la première réception d'un bon de
commande. Défaut antérieur, corrigé indépendamment de tout réglage. Spec : stories 16, 25, 26, 28.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Création d'un produit avec une quantité > 0 : coût moyen posé au prix d'achat HT saisi
- [ ] Quantité 0 : coût moyen laissé tel quel, aucun mouvement
- [ ] Le mouvement « Stock initial » reste présent dans l'historique du produit
- [ ] Les produits existants ne sont pas réécrits (aucune migration de rattrapage)
- [ ] E2E sur D1 locale (boutique neuve) : produit créé avec 2 pièces à 10 € → valeur du stock au
      coût moyen = 20 €, historique « Stock initial » — vu rouge avant le correctif
- [ ] `npx vitest run` vert (baseline), tsc ≤ 32
