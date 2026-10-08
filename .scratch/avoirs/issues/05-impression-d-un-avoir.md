---
id: 05
titre: Impression d'un avoir
statut: ready-for-agent
bloque-par: [04]
migration: aucune
qui-code: socle possible (après 04 : fichiers partagés)
---

## Contexte
Spec stories 11, 34-41. Aucun avoir ne peut être imprimé aujourd'hui. Décisions Q10, Q18.

## Critères d'acceptation
- [ ] Bouton « Imprimer » sur le détail d'un avoir (tous les rôles de la boutique)
- [ ] Document sur le gabarit de la facture : titre « AVOIR » et numéro ; « relatif à la facture FAC-… du
      jj/mm/aaaa » ; motif ; type ; expiration d'un bon d'achat
- [ ] Identités vendeur et acheteur lues sur les **instantanés de la facture d'origine**, jamais sur les fiches
      du jour
- [ ] Montants en positif ; ventilation de la TVA par taux
- [ ] « P.U. TTC » dès qu'une ligne est en TTC ; avoir d'avant ce chantier → « P.U. HT », à l'identique
- [ ] Même mécanisme d'impression que la facture (feuille de style résolue par le manifeste, garde-fou une
      page A4) ; aucune référence statique en dur
- [ ] Données échappées ; vitest vert, tsc ≤ 32 ; E2E vu rouge puis vert

## Coutures à tester
- **E2E** : document **généré** vérifié sans boîte d'impression (titre, facture d'origine, « P.U. TTC »,
  identités figées, ventilation TVA) ; ancien avoir en « P.U. HT »

## Notes
- **Fichiers partagés** : écran des factures — après 04.
- Précédent : impression d'une facture (« P.U. TTC » / « P.U. HT », ticket 03 prix TTC).
