# 05 — Import depuis un fournisseur connecté : « Qté en rayon » et seuil par défaut

**What to build:** dans la recherche fournisseur de la page Stock, chaque article fournisseur
porte un champ « Qté en rayon » à côté du bouton d'import, pré-rempli par le stock initial par
défaut de la boutique. Importer crée le produit importé avec cette quantité (0 = sans stock, un
clic comme aujourd'hui) et le seuil d'alerte par défaut de la boutique (au lieu de 0 codé en dur).
Une quantité > 0 entre par un mouvement « Stock initial », valorisée au prix d'achat relu chez le
fournisseur. Spec : stories 21-24, 27.

**Blocked by:** 01 — Onglet Réglages › Stock ; 02 — Stock initial valorisé au coût moyen

**Status:** ready-for-agent

- [ ] La requête d'import accepte une quantité en rayon facultative (entier ≥ 0) ; absente →
      stock initial par défaut ; invalide → 400 **sans appel au fournisseur**
- [ ] Produit importé : seuil = seuil par défaut de la boutique
- [ ] Quantité > 0 : mouvement « Stock initial » + coût moyen = prix d'achat du fournisseur
- [ ] Autres règles de l'import inchangées (fiche relue, doublon `deja_importe`, marge, famille)
- [ ] Champ « Qté en rayon » pré-rempli sur chaque ligne de résultat, transmis à l'import
- [ ] Tests du service d'import (fournisseur simulé à sa frontière HTTP) : quantité absente,
      fournie, invalide ; seuil par défaut — vus rouges avant le correctif
- [ ] E2E écran : champ présent et pré-rempli (sans brûler de quota au-delà de l'import réel
      existant)
- [ ] `CACHE_VERSION` incrémenté (dernière tâche d'écran du chantier)
- [ ] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert
