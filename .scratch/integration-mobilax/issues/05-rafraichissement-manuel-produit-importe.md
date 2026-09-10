# 05 — Rafraîchissement manuel d'un produit importé

**What to build:** sur la fiche d'un produit importé de Mobilax, un bouton « Actualiser »
revalide le prix et le stock auprès de Mobilax via le lien conservé à l'import, et met à jour le
produit local.

**Blocked by:** 04 — Import d'une pièce trouvée dans l'inventaire (Stock)

**Status:** ready-for-agent

- [ ] Un bouton « Actualiser » apparaît sur la fiche d'un produit importé (porteur de
      `reference_fournisseur` vers Mobilax) — absent sur un produit non importé
- [ ] Cliquer dessus revalide prix et stock auprès de Mobilax via le lien conservé
- [ ] Le produit local est mis à jour avec la valeur revalidée
- [ ] Mobilax indisponible ou quota atteint lors d'un rafraîchissement produit un message clair,
      sans casser l'affichage de la valeur locale existante
- [ ] Test Playwright : actualiser change une valeur affichée sur la fiche produit
- [ ] Test vu rouge avant le correctif
