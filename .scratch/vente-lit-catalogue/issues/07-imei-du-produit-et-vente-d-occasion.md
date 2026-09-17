# 07 — IMEI du produit et vente d'occasion

**What to build:** un téléphone d'occasion en vente porte son **IMEI** dans sa fiche produit. Le
vendeur le retrouve en scannant cet IMEI en caisse, et le ticket de caisse remis au client porte
l'identité de l'appareil — marque, modèle, IMEI — **figée** au moment de la vente, pour la garantie
légale. Un appareil racheté puis revendu sans passer par un reconditionnement est trouvable lui aussi.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 21 à 23 ; décisions « IMEI du produit »,
« Vente en caisse ») ; vocabulaire `CONTEXT.md` (Appareil).

**Blocked by:** 04 — Douchette en caisse.

**Status:** ready-for-agent

- [ ] Nouvelle colonne IMEI sur les produits, index unique partiel par boutique sur les produits
      actifs — migration testée contre un vrai SQLite
- [ ] L'IMEI se saisit dans la fiche produit ; un doublon est refusé avec un message nommant le
      produit existant
- [ ] Un scan de 15 chiffres correspondant à un produit en vente ajoute sa ligne en caisse
- [ ] Nouvelle colonne d'instantané de l'appareil sur les factures (JSON), migration testée
- [ ] La vente d'un produit porteur d'un IMEI **fige** l'identité de l'appareil au site de figeage
      existant de la vente, **après** l'écriture au journal NF525 ; aucun troisième site de figeage
- [ ] Le ticket de caisse imprimé affiche cette identité ; corriger ensuite la fiche produit ne
      change pas le document émis — prouvé sur la vraie base locale
- [ ] Tests NF525 existants (`nf525-*`, immuabilité des factures) verts
- [ ] E2E : saisir un IMEI, le scanner, vendre, relire le ticket de caisse, modifier la fiche,
      relire à nouveau ; vus rouges d'abord
- [ ] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées
