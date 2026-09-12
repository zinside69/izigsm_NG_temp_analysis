# 04 — Quota, panne du fournisseur et reprise

**What to build:** pendant un import par génération, si le quota du fournisseur est atteint,
l'import se met en pause avec un compte à rebours (« quota fournisseur atteint — reprise dans
34 s ») puis reprend l'article en cours tout seul. Si le fournisseur ne répond plus, l'import
s'arrête et affiche son bilan. Relancer la même génération n'importe que ce qui manque.
Spec : stories 15-17, 19.

**Blocked by:** 03 — Importer la génération : boucle, progression, bilan

**Status:** ready-for-agent

- [ ] Quota atteint : pause, compte à rebours du délai rendu par le serveur (`ratelimit-reset`),
      reprise de l'article interrompu — jamais de nouvelle tentative sans délai connu
- [ ] Fournisseur indisponible : arrêt, bilan partiel (importés jusque-là, restants)
- [ ] Relance de la même génération : l'aperçu compte les produits déjà importés « déjà en stock »,
      seul le reste est importé (anti-doublon `0046`)
- [ ] E2E écran avec l'API d'iziGSM simulée et l'horloge simulée : pause + compte à rebours +
      reprise, arrêt sur indisponibilité, relance qui n'importe que le manquant — vus rouges
- [ ] `CACHE_VERSION` incrémenté (dernière tâche d'écran du chantier)
- [ ] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert

⚠ Même dépendance de déploiement que le ticket 03 (ticket 05 de `reglages-stock-boutique`).
