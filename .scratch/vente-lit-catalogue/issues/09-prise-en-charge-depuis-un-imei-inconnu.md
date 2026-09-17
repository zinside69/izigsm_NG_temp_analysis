# 09 — Prise en charge depuis un IMEI inconnu

**What to build:** quand un IMEI valide ne correspond à aucun dossier, l'écran propose de créer une
prise en charge, IMEI déjà rempli, le modèle se saisissant à la main. La prise en charge est créée
**complète au comptoir** — le client repart avec son document signé — puis un technicien la
**valide** plus tard, sans que cette validation retienne quiconque. Une prise en charge peut aussi
naître sans IMEI ni numéro de série, pour un appareil hors d'usage.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 44, 46, 47, 62 ; décision « Parcours
IMEI ») ; vocabulaire `CONTEXT.md` (Appareil, Prise en charge).

**Blocked by:** 08 — Parcours IMEI.

**Status:** ready-for-agent

- [ ] IMEI valide sans dossier → proposition de prise en charge, IMEI prérempli dans la fiche
      appareil, modèle saisi à la main
- [ ] La prise en charge se crée et s'imprime immédiatement, signature comprise, comme aujourd'hui
- [ ] Nouvel état de validation technique sur le ticket (migration testée) : « à valider » à la
      création, « validé » par un technicien, avec son auteur et sa date
- [ ] Les tickets à valider sont visibles des techniciens ; la validation ne bloque ni l'impression
      ni la suite du parcours au comptoir
- [ ] Un ticket peut être créé sans IMEI ni numéro de série (aucune garde à la création)
- [ ] Route de validation gardée par l'appartenance à la boutique (garde-fou d'isolation vert)
- [ ] E2E : scanner un IMEI inconnu, créer la prise en charge, la valider en technicien ; créer un
      ticket sans identifiant ; vus rouges d'abord
- [ ] **Dernier ticket d'écran du lot 1 fait par un agent** : incrémenter `CACHE_VERSION` si le
      lot part en production sans le ticket 10
- [ ] Balayage du menu de gauche vert ; `npx vitest run` vert (hors les 2 échecs permanents) ;
      erreurs tsc inchangées
