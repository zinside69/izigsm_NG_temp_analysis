# 04 — Import CSV : réglages appliqués et stock valorisé

**What to build:** quand l'opérateur importe un fichier CSV de produits, une ligne dont la colonne
seuil est vide prend le seuil d'alerte par défaut de la boutique (au lieu de 5 codé en dur), une
ligne dont la quantité est vide crée un produit à 0, et une quantité > 0 est valorisée au prix
d'achat de la ligne au coût moyen. Une colonne remplie l'emporte toujours sur le réglage.
Spec : stories 18-20, 26.

**Blocked by:** 01 — Onglet Réglages › Stock ; 03 — Seuil par défaut à la création manuelle +
rappel (le rappel doit exister avant ce second changement de comportement)

**Status:** ready-for-agent

- [ ] Colonne seuil vide → seuil par défaut de la boutique ; remplie → sa valeur
- [ ] Colonne quantité vide → 0, aucun mouvement
- [ ] Quantité > 0 → mouvement d'entrée existant conservé + coût moyen = prix d'achat de la ligne
- [ ] Mise à jour d'un produit existant par le CSV : comportement inchangé (hors périmètre)
- [ ] E2E sur D1 locale : import d'un fichier mêlant seuil vide/rempli et quantité vide/remplie,
      relecture des produits et de la valeur du stock — vu rouge avant le correctif
- [ ] `npx vitest run` vert (baseline), tsc ≤ 32
