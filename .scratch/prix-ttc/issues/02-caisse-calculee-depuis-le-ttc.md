---
id: 02
titre: Caisse calculée depuis le TTC — calculLignes() en mode TTC
statut: done
bloque-par: [01]
migration: 0063
---

## Contexte
Spec stories 18-23, 25-26, 28. Une ligne se calcule **à partir du TTC** (Q2) : le client paie exactement
prix affiché × quantité. Remise sur le TTC (Q11). Facturation et NF525 : se code ici avec l'exploitant,
pas au socle.

## Critères d'acceptation
- [x] Migration `0063` : prix unitaire TTC et mode de calcul (`ttc` | `ht`) sur les lignes de document ; colonnes de totaux inchangées
- [x] `calculLignes()` en mode TTC : TTC ligne = arrondi(PU TTC × qté) ; HT = arrondi(TTC ÷ (1 + taux)) ; TVA = TTC − HT ; mode HT = comportement actuel
- [x] Remise : PU TTC remisé = arrondi(PU TTC × (1 − remise %)), puis calcul TTC
- [x] Caisse : prix proposé = TTC de la fiche ; ligne libre saisie en TTC ; « dernier prix vendu » en TTC ; colonne « P.U. TTC »
- [x] `calculerTotauxCommeLeServeur()` rend les mêmes centimes que `calculLignes()` sur les mêmes cas
- [x] 19,99 € × 3 = 59,97 € facturés ; paiement mixte accepté sur ce total
- [x] Journal NF525 : format inchangé, `verifierIntegriteChaine()` sans anomalie ; facture émise avant la bascule inchangée
- [x] Clôture : totaux HT / TVA / TTC = ceux des factures du jour
- [x] vitest vert, tsc ≤ 32, E2E caisse verts

## Coutures à tester
- `calculLignes()` (pure) : modes TTC et HT, quantités > 1 sur prix non ronds, remise, plusieurs taux
- Même jeu de cas contre le calcul de la caisse à l'écran
- Route de vente en caisse sur vrai SQLite : total facturé = Σ prix × quantité, chaîne NF525 vérifiée
- E2E caisse : ligne catalogue, ligne libre, remise, mixte

## Notes
`ventilerPaiements()` compare en centimes au total : il suit le nouveau total. `SQL_VERROU` et les
`INSERT` de lignes figés par des mocks : colonnes en fin de liste. Rien sur devis / factures manuelles
(ticket 03).

## Revue du 2026-10-05 — corrigé / reporté
Corrigé : remise arrondie en centimes entiers (4,35 € − 10 % = 3,92 €, la virgule flottante donnait
3,91 €) ; remise hors 0-100 % ou illisible refusée avant tout numéro ; test du mixte rendu discriminant
(3 × 0,05 € remisés de 10 % = 0,15 €).

Reporté :
- **Impression** (ticket 03) : une ligne TTC garde `prix_unitaire_ht` = HT unitaire arrondi ; la facture
  imprimée affiche PU HT × qté qui ne retombe pas sur le total TTC (3 × 9,99 € : 8,33 × 3 × 1,2 = 29,99
  ≠ 29,97). Afficher le PU TTC (`prix_unitaire_ttc`) quand `mode_calcul = 'ttc'`.
- **Seed local** (suite du 01) : `seed.sql` crée des produits en HT seul, joué après `0062` → TTC à 0,
  produits de démo « prix à saisir » en caisse. Production non concernée (reprise faite par `0062`).
- Ménage : sous-requête `dernier_prix_vendu_ht` plus lue par l'écran ; `prixTtcDepuisHt()` copiée dans
  `stock.js` et `caisse.js` (une copie dans `app.js` suffirait).
- E2E instable sous charge (sans lien) : « A : la quantité n'affiche que des entiers » lit parfois 198
  au lieu de 98 en série longue ; vert seul.
