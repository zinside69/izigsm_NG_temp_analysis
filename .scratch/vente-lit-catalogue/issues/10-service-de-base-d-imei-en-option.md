# 10 — Service de base d'IMEI en option

**What to build:** une boutique qui le souhaite configure un service de base d'IMEI (clé conservée
chiffrée) ; dès lors, un IMEI inconnu scanné au comptoir voit son **modèle résolu** et la prise en
charge proposée arrive préremplie. Sans configuration, rien ne change : le modèle se saisit à la
main (ticket 09).
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 43, 45 ; décision « Parcours IMEI »).

**Blocked by:** 09 — Prise en charge depuis un IMEI inconnu.

**Status:** ready-for-human — le **prestataire** n'est pas choisi (coût, couverture des modèles
récents, disponibilité) et il faut **une clé de test**. Ces deux décisions reviennent à
l'exploitant ; une fois prises, le ticket passe `ready-for-agent`. Le lot 1 fonctionne sans lui.

- [ ] Prestataire choisi et clé de test fournie par l'exploitant (préalable)
- [ ] Réponse du prestataire **mesurée** sur de vrais IMEI avant d'écrire la normalisation — y
      compris l'absence de champ (mémoire « absence d'un champ d'API »)
- [ ] Configuration par boutique sur le patron du fournisseur connecté : plateforme déclarée, clé
      **chiffrée au repos**, jamais renvoyée par aucune route (test sur la réponse entière)
- [ ] Un seul service lit la réponse brute du prestataire ; tout sort normalisé
- [ ] IMEI invalide par la clé de Luhn → aucun appel ; quota ou panne → message, repli sur la saisie
      manuelle, jamais de nouvelle tentative à l'aveugle
- [ ] Modèle résolu → prise en charge préremplie ; le vendeur peut le corriger
- [ ] Le secret de chiffrement et la configuration sont documentés comme ceux du fournisseur
      connecté
- [ ] Si ce ticket est le dernier d'écran du lot 1 : incrémenter `CACHE_VERSION`
- [ ] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées
