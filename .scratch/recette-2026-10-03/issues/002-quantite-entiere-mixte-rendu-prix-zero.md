---
id: 002
titre: Recette du 2026-10-03 — quantité en entiers, mixte ventilé (2 parts), rendu conservé, prix à 0 → dernier prix vendu
statut: ready-for-human
bloque-par: []
migration: 0061
---

# 002 — Retours de recette du 2026-10-03 (production v3.23, manager `telnet@bbox.fr`)

**Codé dans `izigsm/webapp` avec l'exploitant** (caisse / NF525). Quatre parties, chacune vue rouge
d'abord. Décisions de l'exploitant du 2026-10-03 (AskUserQuestion puis réponses libres).

## A — Quantité : n'afficher que des entiers

**Constat** : le champ Qté de la caisse accepte `0.98` à la frappe (`step="1"` ne bloque pas le
clavier) ; le refus n'arrive qu'au clic « Valider la vente » — à l'écran, « ça ne marche pas ».
**Décision** : « plus simple : afficher que des entiers ». Le champ n'accepte **que des chiffres**
(virgule, point, signe ignorés à la frappe et au collage) et affiche toujours un entier ≥ 1 (vide ou
0 en quittant le champ → 1). Même règle sur les champs quantité des devis, factures, avoirs. Le
serveur garde `quantiteLigneInvalide()` (recette 001 B). **E2E** : taper `0,98` → le champ montre
`98` ; taper `0` puis quitter → `1` ; vu rouge sur v3.23.

## B — Mixte : combinaison de deux modes, ventilée

**Constat** : « Mixte » écrit **un** paiement `mixte` pour tout le total, sans ventilation (`bugs.md`
🟠 2026-10-02) ; le « montant remis » y est lu comme des espèces, rendu sans objet.
**Décision** : Mixte = **deux parts au plus**, chacune dans n'importe quel mode (espèces, CB, chèque,
virement), modes distincts. Écran : deux lignes « mode + montant », la seconde calculée (total −
première), « Valider » bloqué tant que la somme ≠ total TTC (au centime). **Serveur** :
`createVente()` reçoit `paiements: [{ mode_paiement, montant }]` (1 ou 2), refusé **avant toute
écriture** si somme ≠ total en centimes, montant ≤ 0, mode inconnu ou en double ; écrit **une ligne
`paiements` par part**, mode en minuscules (règle aussi le `CB`/`cb` à l'écriture). Le mode `mixte`
n'est plus écrit. Journal NF525 inchangé (le mode n'est pas hashé). Export comptable : les parts se
rangent dans leurs colonnes, « Mixte * » ne sert plus qu'à l'historique.

## C — Montant remis et rendu conservés

**Décision** : conservés sur la vente et imprimés sur le ticket ; le paiement enregistré reste le
montant de la part (le total vendu hors mixte). **Migration `0061`** (réservée) :
`paiements.montant_remis REAL NULL`, `paiements.rendu_monnaie REAL NULL`, posés sur la part
**espèces** seulement (remis ≥ part espèces, sinon refus). Hors données hashées. Ticket de caisse :
« Espèces remis … / Rendu … ». Vitest sur SQLite réel (schéma `0061`).

## D — Fiche à 0,00 € → dernier prix vendu

**Constat** : favoris et résultats à 0,00 € pour les pièces importées sans prix de vente (vendues
220 € HT) ; la ligne part en rouge, vente bloquée. **Décision** : si la fiche est à 0, tuile et ligne
prennent le **dernier prix HT vendu** de ce produit dans la boutique (lignes des factures émises non
annulées, la plus récente) ; sans vente passée, prix à saisir comme aujourd'hui. Champ
`dernier_prix_vendu_ht` (ou `null`) ajouté aux résultats produit de `rechercherCatalogue()`,
`rechercherParCode()`, `rechercherParImei()`, `lireFavorisVente()` ; l'écran choisit (fiche > 0
sinon dernier prix). Tuile marquée « (dern.) ». La fiche produit n'est **pas** modifiée.

## Coutures à tester

- A : collage d'un texte « 1,5 » dans le champ ; flèches du champ nombre ; ligne libre.
- B : 2 parts même mode refusées ; somme à 1 centime près refusée ; une seule part en mixte = paiement
  simple ; clôture du soir et export comptable sur une vente mixte ventilée.
- C : rendu sur une vente mixte espèces + CB ; remis < part espèces refusé ; réimpression du ticket.
- D : produit vendu à deux prix → le plus récent ; produit d'une autre boutique jamais lu ; facture
  annulée ignorée.
