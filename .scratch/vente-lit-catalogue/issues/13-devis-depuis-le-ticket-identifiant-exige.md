# 13 — Devis depuis le ticket, identifiant de l'appareil exigé

**What to build:** le vendeur génère le **devis d'un ticket** en un geste, à partir de ses lignes,
sans rien retaper. Tant que l'appareil n'a **ni IMEI ni numéro de série**, le devis est refusé avec
un message qui dit quoi faire ; le technicien peut saisir l'identifiant au moment de la réparation,
quand l'appareil redevient lisible. Le devis affiche l'identité de l'appareil.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 62 à 66 ; décision « Devis et facture depuis
le ticket ») ; vocabulaire `CONTEXT.md` (Appareil).

**Blocked by:** 11 — Lignes de ticket.

**Status:** ready-for-agent

- [ ] Génération du devis **côté serveur** depuis les lignes du ticket, identifiants de produit et
      de service recopiés ; le passage par le stockage du navigateur (une seule ligne reprise) est
      retiré
- [ ] Garde : refus explicite de la génération tant que l'appareil n'a ni IMEI ni numéro de série ;
      l'un des deux suffit
- [ ] L'identifiant se saisit depuis le ticket en cours de réparation ; la garde se lève aussitôt
- [ ] Le devis affiche marque, modèle, IMEI ou numéro de série (lecture vivante : un devis reste
      modifiable)
- [ ] Générer un devis ne touche pas au stock
- [ ] Route gardée par l'appartenance à la boutique ; le devis est créé pour la boutique du ticket
      (le corps porte la boutique, comme l'exigent les routes de devis)
- [ ] E2E sur la vraie base locale : devis refusé sans identifiant, saisie, devis généré avec toutes
      les lignes ; vus rouges d'abord
- [ ] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées
