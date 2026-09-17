# 14 — Acceptation et refus du devis

**What to build:** le client accepte le devis d'un ticket **au comptoir**, en signant sur l'écran,
ou **en ligne**, par le lien qu'il reçoit quand le prix n'est connu qu'après diagnostic. S'il refuse,
le ticket se clôt en « devis refusé » et le vendeur décide au cas par cas de facturer un **forfait
de diagnostic** pris dans le catalogue de services. Un refus ne fait rien bouger dans le stock.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 61, 67, 68, 72, 73 ; décision « Devis et
facture depuis le ticket »).

**Blocked by:** 13 — Devis depuis le ticket.

**Status:** ready-for-agent

- [ ] Signature au comptoir sur le devis d'un ticket, enregistrée avec sa date ; le devis passe
      « accepté »
- [ ] Le lien public existant permet l'acceptation ou le refus en ligne pour un devis issu d'un
      ticket
- [ ] La signature n'est jamais présentée comme une signature électronique qualifiée (le schéma la
      dit « simulée »)
- [ ] Devis refusé → le ticket se clôt dans l'état « devis refusé »
- [ ] Forfait de diagnostic facultatif : le vendeur choisit un service du catalogue, facturé seul,
      au cas par cas
- [ ] Aucun mouvement de stock sur un refus (les pièces non posées restent en stock)
- [ ] Transitions de statut du devis respectées ; routes gardées par l'appartenance à la boutique
- [ ] E2E : accepter au comptoir ; refuser en ligne et clore le ticket ; facturer un diagnostic ;
      relire le stock inchangé ; vus rouges d'abord
- [ ] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées
