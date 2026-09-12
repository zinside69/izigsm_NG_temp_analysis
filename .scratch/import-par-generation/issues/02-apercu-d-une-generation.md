# 02 — Aperçu chiffré d'une génération

**What to build:** une fois les séries proposées, l'opérateur voit avant de confirmer : le nombre
d'articles fournisseur par série, combien sont déjà dans son stock, combien restent à importer et
la durée estimée. Décocher une série recalcule l'aperçu ; au-delà de 200 articles, une
confirmation renforcée (« environ N min, gardez cet onglet ouvert »). Spec : stories 8-12.

**Blocked by:** 01 — Mode « Par génération » : proposer les séries d'une génération

**Status:** ready-for-agent

- [ ] Aperçu : articles de chaque série lus par la recherche par série (100 par page, toutes les
      pages — liste sous `data.products`), dédoublonnés entre séries
- [ ] « Déjà dans le stock » = référence portée par un produit actif de la boutique pour cette
      fiche fournisseur (même clé que l'anti-doublon de l'import), **sans appel de fiche**
- [ ] Durée estimée = articles à importer × 3 s, arrondie à la minute ; aucun plafond
- [ ] Route de lecture : mêmes gardes que le ticket 01 ; liste de séries invalide → 400 sans appel
- [ ] Quota atteint / fournisseur indisponible pendant l'aperçu : message clair, délai affiché
- [ ] Tests du service (pagination multi-pages, dédoublonnage, déjà-en-stock) et de la route —
      vus rouges
- [ ] E2E écran (API d'iziGSM simulée) : décochage qui recalcule, confirmation > 200
- [ ] **E2E réel en préproduction, aperçu seulement** (« iPhone 17 » → séries puis aperçu chiffré,
      aucun import) ; sauté sans clé, jamais faussement vert
- [ ] `npx vitest run` vert (baseline), tsc ≤ 32
