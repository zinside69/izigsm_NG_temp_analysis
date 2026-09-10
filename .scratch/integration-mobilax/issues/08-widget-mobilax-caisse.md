# 08 — Même widget de recherche Mobilax sur Caisse

**What to build:** le module de recherche construit au ticket 06 est rechargé sur l'écran de
vente en caisse (`/caisse`, déjà indépendante d'une prise en charge). Sélectionner un résultat
insère une ligne marginée dans la vente en cours, modifiable.

**Blocked by:** 06 — Recherche Mobilax + ligne marginée dans un devis

**Status:** ready-for-agent

- [ ] Le module de recherche Mobilax (déjà construit) est chargé sur l'écran caisse, sans code
      dupliqué
- [ ] Sélectionner un résultat insère une ligne pré-remplie au prix marginé dans la vente en
      cours
- [ ] L'opérateur peut modifier le prix inséré avant d'encaisser
- [ ] Test Playwright équivalent à celui du ticket 06, sur l'écran caisse
- [ ] Test vu rouge avant le correctif
