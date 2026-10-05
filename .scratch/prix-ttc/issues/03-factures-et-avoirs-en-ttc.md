---
id: 03
titre: Factures et avoirs en TTC — création, conversion, impression
statut: done
bloque-par: [02]
migration: aucune
---

## Contexte
Spec stories 15-16, 24-25, 27. Les documents comptables suivent le calcul TTC du ticket 02. Les factures
émises et les brouillons existants ne bougent pas (Q19).

## Critères d'acceptation
- [x] Création manuelle d'une facture : lignes saisies en prix unitaire TTC, calcul en mode TTC
- [x] Conversion devis → facture : chaque ligne garde son mode et son prix unitaire
- [x] Avoir sur une facture en mode TTC : rend exactement les montants de ses lignes
- [x] Brouillon antérieur à la bascule : montants inchangés ; une ligne ajoutée suit le mode TTC
- [x] Facture imprimée : prix unitaire TTC sur les lignes, récapitulatif HT / TVA par taux / TTC, 1 page A4
- [x] Facture émise avant la bascule : réimprimée à l'identique
- [x] vitest vert, tsc ≤ 32, E2E factures verts

## Coutures à tester
- `calculLignes()` : document mêlant lignes anciennes (HT) et nouvelles (TTC)
- Routes facture et avoir sur vrai SQLite : émission, journal NF525, avoir à l'identique
- E2E factures : création, émission, impression (récapitulatif)

## Notes
L'avoir réserve son numéro avant tout calcul : la validation des lignes reste dans la route
(`quantiteLigneInvalide()`). `_triggerPrint()` garde la garantie A4.

## Réalisation et revue du 2026-10-05
Fait : `createFacture()` et `createAvoir()` acceptent `prix_unitaire_ttc` (fait foi ; HT seul encore
accepté), calcul par `calculLigne()` ; `prixDeLaLigne()` et `ligneEnTtc()` (`lib/db.ts`) seuls points
« colonnes de prix » / « ligne en TTC » (la caisse les partage) ; `convertirDevis()` recopie PU TTC et
mode ; écran : facture et avoir saisis en TTC, taux choisi par ligne d'avoir ; impression « P.U. TTC » dès
qu'une ligne est en TTC, document tout en HT réimprimé à l'identique. « Brouillon antérieur + ligne
ajoutée » : aucune route n'ajoute de ligne à un brouillon (`PUT /factures/:id` → 405) ; la couture est
couverte par le document mixte HT + TTC (`tests/factures-ttc-sqlite.test.ts`).

Revue — corrigé : taux de TVA d'un avoir non contrôlé (texte concaténé, −100 % → division par zéro)
refusé avant tout numéro ; avoir figé à 20 % (faux à 0 / 5,5 / 10 %) → taux par ligne ; double définition
de « ligne en TTC » ; blocs `AVANT` résumés recopiés en entier.

Reporté :
- Impression d'une vente de caisse remisée : PU TTC avant remise × qté ≠ total (déjà le cas en HT) —
  colonne remise à ajouter au document.
- `lignes_avoir` sans `prix_unitaire_ttc` / `mode_calcul` (le ticket excluait toute migration) : PU HT
  déduit stocké, totaux exacts ; le PU TTC saisi n'est pas réimprimable.
- `checkFromDevis()` (`factures.js`) préremplit un PU HT dans le champ TTC — code mort, aucun écrivain
  de `izigsm_devis_to_facture`.
- Copies des calculs TTC côté navigateur (`caisse.js`, `factures.js`, `stock.js`) — `todo.md`.
