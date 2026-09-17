# 17 — Lignes de SAV et coût des garanties

**What to build:** un technicien ajoute des lignes à un **dossier SAV**, comme à un ticket, mais
facturées **0 €** : la pièce reprise sous garantie sort du stock à la pose et son **coût** est
conservé. Le responsable de boutique voit enfin **combien lui coûtent ses garanties**.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 78, 79 ; décisions « Lignes de ticket »,
« Garanties »).

**Blocked by:** 12 — Pose d'une pièce ; 16 — Garanties par ligne de service.

**Status:** ready-for-agent

- [ ] Un dossier SAV porte des lignes (service, pièce, libre), ajoutées avec le même sélecteur ;
      leur prix facturé est 0 €
- [ ] Le coût unitaire de chaque ligne est conservé (prix d'achat ou coût moyen de la pièce au
      moment de l'ajout)
- [ ] La pose d'une pièce sur un SAV sort la pièce du stock une seule fois, comme sur un ticket
- [ ] Une vue du coût des garanties sur une période, par boutique, lit ces coûts — prouvée sur la
      vraie base locale
- [ ] Routes gardées par l'appartenance à la boutique (garde-fou statique vert)
- [ ] E2E : ouvrir un SAV, poser une pièce, relire le stock et le coût des garanties ; vus rouges
      d'abord
- [ ] **Dernier ticket d'écran du lot 2** : incrémenter `CACHE_VERSION`
- [ ] Balayage du menu de gauche vert ; `npx vitest run` vert (hors les 2 échecs permanents) ;
      erreurs tsc inchangées
- [ ] Rappel de déploiement du lot 2 : toutes ses migrations appliquées à distance **avant** le code,
      `d1_migrations` distant relu entre les deux commandes
