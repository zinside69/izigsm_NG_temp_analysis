---
id: 02
titre: Caisse calculée depuis le TTC — calculLignes() en mode TTC
statut: ready-for-agent
bloque-par: [01]
migration: 0063
---

## Contexte
Spec stories 18-23, 25-26, 28. Une ligne se calcule **à partir du TTC** (Q2) : le client paie exactement
prix affiché × quantité. Remise sur le TTC (Q11). Facturation et NF525 : se code ici avec l'exploitant,
pas au socle.

## Critères d'acceptation
- [ ] Migration `0063` : prix unitaire TTC et mode de calcul (`ttc` | `ht`) sur les lignes de document ; colonnes de totaux inchangées
- [ ] `calculLignes()` en mode TTC : TTC ligne = arrondi(PU TTC × qté) ; HT = arrondi(TTC ÷ (1 + taux)) ; TVA = TTC − HT ; mode HT = comportement actuel
- [ ] Remise : PU TTC remisé = arrondi(PU TTC × (1 − remise %)), puis calcul TTC
- [ ] Caisse : prix proposé = TTC de la fiche ; ligne libre saisie en TTC ; « dernier prix vendu » en TTC ; colonne « P.U. TTC »
- [ ] `calculerTotauxCommeLeServeur()` rend les mêmes centimes que `calculLignes()` sur les mêmes cas
- [ ] 19,99 € × 3 = 59,97 € facturés ; paiement mixte accepté sur ce total
- [ ] Journal NF525 : format inchangé, `verifierIntegriteChaine()` sans anomalie ; facture émise avant la bascule inchangée
- [ ] Clôture : totaux HT / TVA / TTC = ceux des factures du jour
- [ ] vitest vert, tsc ≤ 32, E2E caisse verts

## Coutures à tester
- `calculLignes()` (pure) : modes TTC et HT, quantités > 1 sur prix non ronds, remise, plusieurs taux
- Même jeu de cas contre le calcul de la caisse à l'écran
- Route de vente en caisse sur vrai SQLite : total facturé = Σ prix × quantité, chaîne NF525 vérifiée
- E2E caisse : ligne catalogue, ligne libre, remise, mixte

## Notes
`ventilerPaiements()` compare en centimes au total : il suit le nouveau total. `SQL_VERROU` et les
`INSERT` de lignes figés par des mocks : colonnes en fin de liste. Rien sur devis / factures manuelles
(ticket 03).
