# 08 — Parcours IMEI : ticket en cours, SAV ou nouveau ticket

**What to build:** le vendeur scanne ou saisit l'IMEI d'un appareil qui n'est pas un produit en
vente. Un IMEI dont la clé de contrôle est fausse est refusé tout de suite. Si l'appareil a un ticket
**non rendu**, ce ticket s'ouvre. S'il a une **garantie active**, l'écran montre ce qui est couvert
et jusqu'à quand, et demande « même panne ? » : oui ouvre un dossier SAV, non exige un **motif**
(autre panne, casse, oxydation, garantie expirée) et ouvre un nouveau ticket qui le conserve. Un
technicien peut ensuite **requalifier** cette décision, trace à l'appui. La recherche générale et la
prise en charge suivent le même parcours.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 15, 37 à 42 ; décision « Parcours IMEI ») ;
vocabulaire `CONTEXT.md` (Garantie, Nouvelle panne hors garantie).

**Blocked by:** 03 — Services et SAV dans la recherche ; 07 — IMEI du produit.

**Status:** ready-for-agent

- [ ] Fonction pure de contrôle de Luhn ; un IMEI faux est refusé **avant** toute recherche —
      tests unitaires vus rouges
- [ ] La recherche unifiée trouve tickets et dossiers SAV par IMEI **ou numéro de série** de
      l'appareil (chemin appareil → ticket), boutique du jeton seulement
- [ ] Ordre de résolution respecté : ticket non rendu → ouvert ; sinon garantie active → écran de
      décision ; sinon → « aucun dossier » (la prise en charge viendra au ticket 09)
- [ ] Écran de décision : réparations garanties et dates de fin (garanties actuelles, par ticket,
      en attendant le ticket 16) ; « même panne » crée un dossier SAV lié à la garantie
- [ ] « Autre panne » : motif obligatoire dans la liste fermée, conservé sur le nouveau ticket
      (migration testée) ; les tickets précédents restent dans l'historique de l'appareil
- [ ] Requalification SAV ↔ ticket payant par un technicien, tracée ; routes gardées par
      l'appartenance à la boutique
- [ ] Le même parcours s'applique au scan dans la recherche générale et à la prise en charge
- [ ] E2E sur la vraie base locale : IMEI faux, ticket en cours, garantie active (oui, puis non +
      motif), requalification ; vus rouges d'abord
- [ ] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées
