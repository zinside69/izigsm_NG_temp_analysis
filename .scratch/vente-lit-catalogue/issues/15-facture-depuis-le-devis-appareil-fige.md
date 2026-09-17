# 15 — Facture depuis le devis, identité de l'appareil figée

**What to build:** le vendeur convertit le devis accepté d'un ticket en **facture**, lignes
comprises, sans rien retaper. La facture porte la marque, le modèle et l'IMEI ou le numéro de série
de l'appareil, **figés à l'émission** : corriger ensuite la fiche appareil ne change jamais une
facture émise. La conversion ne sort **aucune** pièce du stock une seconde fois — c'est la pose qui
l'a fait.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 58, 69, 70, 71 ; décision « Devis et facture
depuis le ticket »).

**Blocked by:** 07 — IMEI du produit (colonne d'instantané de l'appareil) ; 12 — Pose d'une pièce ;
13 — Devis depuis le ticket.

**Status:** ready-for-agent

- [ ] Conversion devis → facture : lignes recopiées avec produit et service ; **aucun** mouvement de
      stock — prouvé sur la vraie base locale avec une pièce déjà posée
- [ ] Garde d'identifiant aussi à la création d'une facture liée à un ticket
- [ ] L'identité de l'appareil est figée **à l'émission**, au site de figeage existant de
      l'émission, **après** l'écriture au journal NF525 ; aucun troisième site de figeage
- [ ] Une facture en brouillon lit la fiche appareil vivante ; une facture émise lit son instantané
- [ ] La facture imprimée affiche l'identité de l'appareil, dans le budget d'une page A4
- [ ] Tests NF525 et d'immuabilité des factures verts ; numérotation inchangée
- [ ] E2E : ticket → pose → devis → acceptation → facture émise ; modifier l'IMEI de l'appareil ;
      relire la facture inchangée et le stock décrémenté une seule fois ; vus rouges d'abord
- [ ] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées
