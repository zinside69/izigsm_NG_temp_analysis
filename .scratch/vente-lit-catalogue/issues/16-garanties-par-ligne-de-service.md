# 16 — Garanties par ligne de service

**What to build:** le responsable de boutique fixe la **durée de garantie de chaque service** de son
catalogue (par exemple écran 6 mois, autres réparations 3 mois). Quand un ticket est terminé, chaque
ligne de service ouvre **sa propre garantie**, à la durée de son service : sur un même ticket, l'écran
reste couvert 6 mois et la batterie 3. Les garanties déjà émises restent valables telles quelles.
L'écran de décision du parcours IMEI détaille désormais la couverture ligne par ligne, et rappelle
les exclusions (casse, oxydation).
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 74 à 77 ; décision « Garanties ») ;
vocabulaire `CONTEXT.md` (Garantie, Nouvelle panne hors garantie).

**Blocked by:** 08 — Parcours IMEI (écran de décision) ; 11 — Lignes de ticket.

**Status:** ready-for-agent

- [ ] La durée de garantie d'un service se saisit dans le catalogue (la colonne existe déjà, jamais
      lue jusqu'ici)
- [ ] Fonction pure de résolution : durée du service, sinon durée par défaut de la boutique ; tests
      vus rouges
- [ ] Garanties rattachées à une ligne de service : l'unicité « une garantie active par ticket » est
      remplacée par une unicité par ligne — migration testée contre un vrai SQLite, garanties
      existantes intactes
- [ ] Ticket terminé : une garantie par ligne de service, à la durée résolue ; les lignes de pièce
      et les lignes libres n'en ouvrent pas ; un ticket sans ligne garde le comportement actuel
- [ ] Écran de décision (ticket 08) : couverture par ligne, dates de fin, rappel « hors casse, hors
      oxydation »
- [ ] L'email de fin de réparation annonce les durées réelles
- [ ] E2E : régler écran 180 jours et batterie 90 ; terminer un ticket portant les deux ; relire les
      deux garanties ; scanner l'IMEI et voir la couverture détaillée ; vus rouges d'abord
- [ ] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées
